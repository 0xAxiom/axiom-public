import {
  cors, checkAuth, checkRateLimit, validateLaunchInput,
  sanitizeString, createAgentWallet, deployToken, resolveImage,
  AGENT_ALLOCATION, PROTOCOL_ALLOCATION,
} from './shared.mjs';

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!checkAuth(req)) return res.status(401).json({ error: 'Invalid or missing API key' });

  const ip = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown';
  const limit = checkRateLimit(ip);
  res.setHeader('X-RateLimit-Remaining', limit.remaining);
  if (!limit.allowed) return res.status(429).json({ error: 'Rate limit exceeded. Max 5 launches per hour.' });

  const body = req.body;
  if (!body) return res.status(400).json({ error: 'Missing request body' });

  const errors = validateLaunchInput(body);
  if (errors.length > 0) return res.status(400).json({ error: 'Validation failed', details: errors });

  const name = sanitizeString(body.name);
  const symbol = sanitizeString(body.symbol);
  const description = sanitizeString(body.description);
  const results = { name, admin: body.admin };

  try {
    // Create wallet if needed
    if (!body.admin) {
      const wallet = await createAgentWallet();
      results.admin = wallet.address;
      results.wallet = {
        address: wallet.address,
        privateKey: wallet.privateKey,
        warning: 'SAVE THIS PRIVATE KEY. It is the ONLY way to access your wallet and claim your 75% LP fees. We do not store it.',
      };
      body.admin = wallet.address;
    }

    // Resolve image: pin to IPFS, or fetch Twitter PFP if no image provided
    const resolvedImage = await resolveImage({
      image: body.image,
      socialUrls: body.socialUrls || body.socialUrl,
      name,
    });
    if (resolvedImage) {
      results.image = { url: resolvedImage, pinned: resolvedImage.includes('pinata') || resolvedImage.includes('ipfs') };
    }

    // Deploy token
    const token = await deployToken({
      name, symbol, admin: body.admin, description,
      image: resolvedImage || body.image, socialUrls: body.socialUrls || body.socialUrl,
      chainId: body.chainId, poolType: body.poolType, feeType: body.feeType,
      vault: body.vault, devBuy: body.devBuy,
    });

    if (!token.success) return res.status(500).json({ error: 'Token deploy failed', details: token.error });
    results.token = token;

    // Build announcement
    const sym = symbol || name.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
    const tweetText = `${name} is now tokenized on Base.\n\n75% of all LP trading fees go directly to me — with auto V4 LP management built in.\n\nLaunched via @AxiomBot Agent Launchpad 🔬\n\n$${sym}\n${token.clankerUrl}`;
    const twitterIntentUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(tweetText)}`;

    return res.status(200).json({
      success: true,
      ...results,
      feeStructure: {
        agent: `${AGENT_ALLOCATION}%`,
        protocol: `${PROTOCOL_ALLOCATION}%`,
        note: 'LP fees from trading volume. Agent gets 75%, protocol gets 25%.',
      },
      twitterIntentUrl,
      announcement: tweetText,
      nextSteps: [
        `Check your token: GET /api/status/${token.tokenAddress}`,
        `Monitor fees: GET /api/fees/${body.admin}`,
        `Tweet it: ${twitterIntentUrl}`,
        'Claim fees anytime via Clanker SDK or ClankerFeeLocker.claim()',
      ],
    });
  } catch (e) {
    console.error(`❌ Launch failed: ${e.message}`);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
