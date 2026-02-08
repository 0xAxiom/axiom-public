#!/usr/bin/env node
/**
 * Agent Launchpad API
 * 
 * One endpoint to take any AI agent onchain:
 *   POST /api/launch  → basename + token + fee claiming
 *   GET  /api/status/:address → token info + uncollected fees
 *   GET  /api/fees/:admin → all tokens + fees for an admin address
 * 
 * Cost to agent: $0 (basename sponsored, Clanker deploys for free)
 * Revenue: 25% of all LP fees from every launched token → Protocol
 * 
 * Environment:
 *   CLANKER_API_KEY        — Clanker V4 API key (REQUIRED)
 *   LAUNCHPAD_API_KEY      — API key to protect this server (REQUIRED in production)
 *   CDP_API_KEY_ID         — CDP key ID (for basename sponsoring)
 *   CDP_API_KEY_SECRET     — CDP key secret (PEM)
 *   CDP_WALLET_SECRET      — CDP wallet encryption secret
 *   CDP_PAYMASTER_URL      — CDP paymaster endpoint
 */

import { createServer } from 'http';
import { randomBytes } from 'crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { initProtocol, findAndRegister } from './basename-registrar.mjs';

// ═══════════════════════════════════════════════════════════════
// Wallet Creation (Local — pure viem, no API dependency)
// ═══════════════════════════════════════════════════════════════

async function createAgentWallet() {
  const { generatePrivateKey, privateKeyToAccount } = await import('viem/accounts');
  const privateKey = generatePrivateKey();
  const account = privateKeyToAccount(privateKey);
  console.log(`🔑 Created local wallet: ${account.address}`);
  return { 
    success: true, 
    address: account.address, 
    privateKey,
  };
}

// ═══════════════════════════════════════════════════════════════
// Config
// ═══════════════════════════════════════════════════════════════

const PORT = parseInt(process.env.PORT || process.argv.find((_, i, a) => a[i - 1] === '--port') || '3000');

// Fee recipients — hardcoded, non-negotiable
const PROTOCOL_FEE_ADDRESS = "0x0D9945F0a591094927df47DB12ACB1081cE9F0F6"; // Protocol fee wallet
const PROTOCOL_ALLOCATION = 25; // 25% of LP fees → Protocol (WETH)
const AGENT_ALLOCATION = 75;    // 75% to agent (Both tokens)

// Rate limiting
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const RATE_LIMIT_MAX = 5; // max 5 launches per hour per IP
const rateLimitMap = new Map();

// Input limits
const MAX_NAME_LENGTH = 50;
const MAX_SYMBOL_LENGTH = 10;
const MAX_DESCRIPTION_LENGTH = 500;
const MAX_BODY_SIZE = 50 * 1024; // 50KB

// ═══════════════════════════════════════════════════════════════
// Load Environment
// ═══════════════════════════════════════════════════════════════

function loadEnv() {
  const env = { ...process.env };
  try {
    const envFile = readFileSync(join(homedir(), '.axiom', 'wallet.env'), 'utf-8');
    const vars = ['CLANKER_API_KEY', 'CDP_API_KEY_ID', 'CDP_API_KEY_SECRET',
                  'CDP_WALLET_SECRET', 'CDP_PAYMASTER_URL', 'LAUNCHPAD_API_KEY'];
    for (const v of vars) {
      if (!env[v]) {
        if (v === 'CDP_API_KEY_SECRET') {
          const m = envFile.match(/CDP_API_KEY_SECRET="(-----BEGIN[\s\S]*?-----END[^"]+)"/);
          if (m) env[v] = m[1].trim();
        } else {
          const m = envFile.match(new RegExp(`${v}=["']?([^\\s"']+)["']?`));
          if (m) env[v] = m[1];
        }
      }
    }
  } catch {}
  return env;
}

const ENV = loadEnv();

// ═══════════════════════════════════════════════════════════════
// Deployment Registry (persistent)
// ═══════════════════════════════════════════════════════════════

const REGISTRY_DIR = join(homedir(), '.agent-launchpad');
const REGISTRY_FILE = join(REGISTRY_DIR, 'deployments.json');

function loadRegistry() {
  try {
    if (existsSync(REGISTRY_FILE)) {
      return JSON.parse(readFileSync(REGISTRY_FILE, 'utf-8'));
    }
  } catch {}
  return { deployments: [] };
}

function saveDeployment(data) {
  if (!existsSync(REGISTRY_DIR)) mkdirSync(REGISTRY_DIR, { recursive: true });
  const registry = loadRegistry();
  registry.deployments.push({
    ...data,
    timestamp: new Date().toISOString(),
  });
  writeFileSync(REGISTRY_FILE, JSON.stringify(registry, null, 2));
}

// ═══════════════════════════════════════════════════════════════
// Rate Limiting
// ═══════════════════════════════════════════════════════════════

function checkRateLimit(ip) {
  const now = Date.now();
  
  // At the start of checkRateLimit, every ~100 calls clean up expired entries
  if (rateLimitMap.size > 100) {
    for (const [key, value] of rateLimitMap.entries()) {
      if (now > value.resetAt) rateLimitMap.delete(key);
    }
  }
  
  const entry = rateLimitMap.get(ip) || { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS };
  
  if (now > entry.resetAt) {
    entry.count = 0;
    entry.resetAt = now + RATE_LIMIT_WINDOW_MS;
  }
  
  entry.count++;
  rateLimitMap.set(ip, entry);
  
  return {
    allowed: entry.count <= RATE_LIMIT_MAX,
    remaining: Math.max(0, RATE_LIMIT_MAX - entry.count),
    resetAt: entry.resetAt,
  };
}

// ═══════════════════════════════════════════════════════════════
// Input Sanitization & Validation
// ═══════════════════════════════════════════════════════════════

function sanitizeString(str) {
  if (typeof str !== 'string') return str;
  return str.replace(/[<>"'`\x00-\x1f\x7f-\x9f]/g, '').trim();
}

function validateLaunchInput(body) {
  const errors = [];
  
  if (!body.name) errors.push('Missing: name');
  else if (body.name.length > MAX_NAME_LENGTH) errors.push(`name too long (max ${MAX_NAME_LENGTH})`);
  
  if (body.admin) {
    if (!/^0x[a-fA-F0-9]{40}$/.test(body.admin)) errors.push('Invalid admin address');
    else if (body.admin === '0x0000000000000000000000000000000000000000') errors.push('admin cannot be zero address');
  }
  // admin is optional — if missing, we create a wallet for the agent
  
  if (body.symbol && body.symbol.length > MAX_SYMBOL_LENGTH) errors.push(`symbol too long (max ${MAX_SYMBOL_LENGTH})`);
  if (body.description && body.description.length > MAX_DESCRIPTION_LENGTH) errors.push(`description too long (max ${MAX_DESCRIPTION_LENGTH})`);
  
  if (body.image && typeof body.image === 'string' && body.image.length > 500) errors.push('image URL too long');
  
  if (body.chainId && ![8453, 130, 42161].includes(body.chainId)) errors.push('Invalid chainId (use 8453, 130, or 42161)');
  
  if (body.vault) {
    if (body.vault.percentage && (body.vault.percentage < 1 || body.vault.percentage > 90)) errors.push('vault.percentage must be 1-90');
    if (body.vault.lockupDays && body.vault.lockupDays < 7) errors.push('vault.lockupDays minimum is 7');
  }

  return errors;
}

// ═══════════════════════════════════════════════════════════════
// Basename Registration (CDP Paymaster Sponsored)
// ═══════════════════════════════════════════════════════════════

let protocol = null;

async function ensureProtocol() {
  if (!protocol && ENV.CDP_API_KEY_ID && ENV.CDP_API_KEY_SECRET) {
    try {
      protocol = await initProtocol(ENV);
      console.log(`🔧 Protocol account ready: ${protocol.protocolAddress}`);
    } catch (e) {
      console.log(`⚠️  CDP not configured — basename registration disabled: ${e.message}`);
    }
  }
  return protocol;
}

// ═══════════════════════════════════════════════════════════════
// Token Deploy (Clanker V4 REST API — FREE)
// ═══════════════════════════════════════════════════════════════

async function deployToken({ name, symbol, admin, description, image, socialUrls, chainId, poolType, feeType, vault, devBuy }) {
  const requestKey = randomBytes(16).toString('hex');

  // Build social media URLs array
  const socialMediaUrls = [];
  if (socialUrls) {
    if (typeof socialUrls === 'string') {
      socialMediaUrls.push({ platform: 'twitter', url: socialUrls });
    } else if (Array.isArray(socialUrls)) {
      socialMediaUrls.push(...socialUrls);
    }
  }

  const body = {
    token: {
      name,
      symbol: symbol || name.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5),
      tokenAdmin: admin,
      description: description || `${name} — launched via Agent Launchpad`,
      requestKey,
      ...(image && { image }),
      ...(socialMediaUrls.length > 0 && { socialMediaUrls }),
    },
    rewards: [
      {
        admin: admin,
        recipient: admin,
        allocation: AGENT_ALLOCATION,
        rewardsToken: "Both",
      },
      {
        admin: PROTOCOL_FEE_ADDRESS,
        recipient: PROTOCOL_FEE_ADDRESS,
        allocation: PROTOCOL_ALLOCATION,
        rewardsToken: "Paired",
      },
    ],
    pool: {
      type: poolType || "standard",
      pairedToken: "0x4200000000000000000000000000000000000006",
      initialMarketCap: 10,
    },
    fees: feeType === 'dynamic'
      ? { type: "dynamic", baseFee: 0.5, maxLpFee: 5 }
      : { type: "static", clankerFee: 1, pairedFee: 1 },
    chainId: chainId || 8453,
  };

  // Optional vault
  if (vault) {
    body.vault = {
      percentage: vault.percentage || 10,
      lockupDuration: (vault.lockupDays || 30) * 86400,
      vestingDuration: (vault.vestingDays || 0) * 86400,
    };
  }

  // Optional dev buy
  if (devBuy && devBuy.ethAmount) {
    body.devBuy = { ethAmount: devBuy.ethAmount };
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000); // 30s timeout
    
    const resp = await fetch('https://www.clanker.world/api/tokens/deploy/v4', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ENV.CLANKER_API_KEY,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    const data = await resp.json();

    if (resp.ok && data.success) {
      return {
        success: true,
        tokenAddress: data.expectedAddress,
        requestKey,
        clankerUrl: `https://clanker.world/clanker/${data.expectedAddress}`,
      };
    } else {
      // Don't leak internal Clanker error details that might contain our API key
      const safeError = data.error || 'Deploy failed';
      return { success: false, error: typeof safeError === 'string' ? safeError : 'Deploy failed' };
    }
  } catch (error) {
    if (error.name === 'AbortError') {
      return { success: false, error: 'Clanker API timeout (30s)' };
    }
    return { success: false, error: 'Clanker API unavailable' };
  }
}

// ═══════════════════════════════════════════════════════════════
// Clanker Authenticated Endpoints (status, fees, tokens)
// ═══════════════════════════════════════════════════════════════

async function getTokenStatus(address) {
  try {
    const resp = await fetch(`https://www.clanker.world/api/tokens/${address}`, {
      headers: { 'x-api-key': ENV.CLANKER_API_KEY },
    });
    if (!resp.ok) return { error: 'Token not found' };
    return await resp.json();
  } catch { return { error: 'Clanker API unavailable' }; }
}

async function getUncollectedFees(address) {
  try {
    const resp = await fetch(`https://www.clanker.world/api/tokens/${address}/uncollected-fees`, {
      headers: { 'x-api-key': ENV.CLANKER_API_KEY },
    });
    if (!resp.ok) return { error: 'Could not fetch fees' };
    return await resp.json();
  } catch { return { error: 'Clanker API unavailable' }; }
}

async function getTokensByAdmin(admin) {
  try {
    const resp = await fetch(`https://www.clanker.world/api/tokens?fid=&q=${admin}&includeMarket=true`, {
      headers: { 'x-api-key': ENV.CLANKER_API_KEY },
    });
    if (!resp.ok) return { error: 'Could not fetch tokens' };
    return await resp.json();
  } catch { return { error: 'Clanker API unavailable' }; }
}

// ═══════════════════════════════════════════════════════════════
// Launch Handler
// ═══════════════════════════════════════════════════════════════

async function handleLaunch(body) {
  try {
  const errors = validateLaunchInput(body);
  if (errors.length > 0) {
    return { status: 400, body: { error: 'Validation failed', details: errors } };
  }

  // Sanitize inputs before processing
  const sanitizedName = sanitizeString(body.name);
  const sanitizedSymbol = sanitizeString(body.symbol);
  const sanitizedDescription = sanitizeString(body.description);

  const results = { name: sanitizedName, admin: body.admin };

  // Step 0: Create wallet if agent doesn't have one
  if (!body.admin) {
    console.log(`🔑 No admin address — creating wallet for ${sanitizedName}...`);
    try {
      const wallet = await createAgentWallet();
      results.admin = wallet.address;
      results.wallet = {
        success: true,
        address: wallet.address,
        privateKey: wallet.privateKey,
        warning: 'SAVE THIS PRIVATE KEY. It is the ONLY way to access your wallet and claim your 75% LP fees. We do not store it.',
      };
      body.admin = wallet.address;
    } catch (e) {
      return { status: 500, body: { error: 'Wallet creation failed', details: e.message, hint: 'Provide your own admin address in the request body' } };
    }
  }

  // Step 1: Deploy token (free via Clanker API)
  console.log(`🚀 Launching ${sanitizedName} for ${body.admin.slice(0, 8)}...`);
  const token = await deployToken({
    name: sanitizedName,
    symbol: sanitizedSymbol,
    admin: body.admin,
    description: sanitizedDescription,
    image: body.image,
    socialUrls: body.socialUrls || body.socialUrl,
    chainId: body.chainId,
    poolType: body.poolType,
    feeType: body.feeType,
    vault: body.vault,
    devBuy: body.devBuy,
  });

  if (!token.success) {
    return { status: 500, body: { error: 'Token deploy failed', details: token.error } };
  }
  results.token = token;

  // Step 2: Register basename (sponsored via CDP paymaster — free)
  if (body.basename !== false) {
    try {
      const proto = await ensureProtocol();
      if (proto) {
        const baseName = body.basename || sanitizedName.toLowerCase().replace(/[^a-z0-9]/g, '');
        console.log(`🏷️  Registering ${baseName}.base.eth for ${body.admin.slice(0, 8)}...`);
        const basename = await findAndRegister({
          ...proto,
          name: baseName,
          ownerAddress: body.admin,
          paymasterUrl: ENV.CDP_PAYMASTER_URL,
        });
        results.basename = basename;
      } else {
        results.basename = { success: false, note: 'Basename registration not configured' };
      }
    } catch (e) {
      console.error(`⚠️  Basename registration failed (non-fatal): ${e.message}`);
      results.basename = { success: false, error: e.message, note: 'Token deployed successfully — basename failed but can be retried' };
    }
  }

  // Save to registry
  saveDeployment({
    name: sanitizedName,
    symbol: sanitizedSymbol || sanitizedName.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5),
    admin: body.admin,
    tokenAddress: token.tokenAddress,
    chainId: body.chainId || 8453,
    basename: results.basename?.basename || null,
  });

  console.log(`✅ ${sanitizedName} launched → ${token.tokenAddress}`);

  // Build Twitter intent — lead with the compelling angle
  const symbol = sanitizedSymbol || sanitizedName.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
  const clankerUrl = `https://clanker.world/clanker/${token.tokenAddress}`;
  const tweetText = `${sanitizedName} is now tokenized on Base.\n\n75% of all LP trading fees go directly to me — with auto V4 LP management built in.\n\nLaunched via @AxiomBot Agent Launchpad 🔬\n\n$${symbol}\n${clankerUrl}`;
  const twitterIntentUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(tweetText)}`;

  return {
    status: 200,
    body: {
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
    },
  };
  } catch (e) {
    console.error(`❌ Launch failed unexpectedly: ${e.message}`);
    return { status: 500, body: { error: 'Internal server error', details: e.message } };
  }
}

// ═══════════════════════════════════════════════════════════════
// HTTP Server
// ═══════════════════════════════════════════════════════════════

const server = createServer(async (req, res) => {
  const respond = (status, data) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data, null, 2));
  };

  // CORS — restrict in production
  const allowedOrigin = ENV.CORS_ORIGIN || '*';
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key');

  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  // Parse URL
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;

  // Health check
  if (path === '/health' || path === '/') {
    return respond(200, {
      service: 'Agent Launchpad',
      version: '2.0.1',
      status: 'ok',
      endpoints: {
        launch: 'POST /api/launch',
        status: 'GET /api/status/:tokenAddress',
        fees: 'GET /api/fees/:adminAddress',
      },
    });
  }

  // Auth check (required for all /api/ routes in production)
  if (path.startsWith('/api/')) {
    if (ENV.LAUNCHPAD_API_KEY) {
      const key = req.headers['x-api-key'];
      if (key !== ENV.LAUNCHPAD_API_KEY) {
        return respond(401, { error: 'Invalid or missing API key' });
      }
    } else if (process.env.NODE_ENV === 'production') {
      console.error('⚠️  LAUNCHPAD_API_KEY not set in production!');
      return respond(500, { error: 'Server misconfigured' });
    }
  }

  // ─── POST /api/launch ─────────────────────────────────────
  if (path === '/api/launch' && req.method === 'POST') {
    // Rate limit
    const ip = req.socket.remoteAddress || 'unknown';
    const limit = checkRateLimit(ip);
    res.setHeader('X-RateLimit-Remaining', limit.remaining);
    if (!limit.allowed) {
      return respond(429, { error: 'Rate limit exceeded. Max 5 launches per hour.' });
    }

    // Parse body with size limit
    let body = '';
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > MAX_BODY_SIZE) {
        return respond(413, { error: 'Request body too large' });
      }
      body += chunk;
    }

    let parsed;
    try { parsed = JSON.parse(body); }
    catch { return respond(400, { error: 'Invalid JSON' }); }

    const result = await handleLaunch(parsed);
    return respond(result.status, result.body);
  }

  // ─── GET /api/status/:address ─────────────────────────────
  const statusMatch = path.match(/^\/api\/status\/(0x[a-fA-F0-9]{40})$/);
  if (statusMatch && req.method === 'GET') {
    const [tokenInfo, fees] = await Promise.all([
      getTokenStatus(statusMatch[1]),
      getUncollectedFees(statusMatch[1]),
    ]);
    return respond(200, { token: tokenInfo, uncollectedFees: fees });
  }

  // ─── GET /api/fees/:admin ─────────────────────────────────
  const feesMatch = path.match(/^\/api\/fees\/(0x[a-fA-F0-9]{40})$/);
  if (feesMatch && req.method === 'GET') {
    const tokens = await getTokensByAdmin(feesMatch[1]);
    return respond(200, tokens);
  }

  // 404
  respond(404, { error: 'Not found' });
});

// ═══════════════════════════════════════════════════════════════
// Startup
// ═══════════════════════════════════════════════════════════════

if (!ENV.CLANKER_API_KEY) {
  console.error('❌ CLANKER_API_KEY is required. Set it in env or ~/.axiom/wallet.env');
  process.exit(1);
}

server.listen(PORT, () => {
  const registry = loadRegistry();
  console.log(`
🚀 Agent Launchpad API v2.0.1
═══════════════════════════════
  http://localhost:${PORT}
  
  POST /api/launch          Deploy token + basename
  GET  /api/status/:addr    Token info + uncollected fees  
  GET  /api/fees/:admin     All tokens by admin

  Auth: ${ENV.LAUNCHPAD_API_KEY ? '✅ API key required' : '⚠️  OPEN (set LAUNCHPAD_API_KEY!)'}
  Fee split: Agent ${AGENT_ALLOCATION}% | Protocol ${PROTOCOL_ALLOCATION}%
  Registry: ${registry.deployments.length} tokens launched
═══════════════════════════════
`);
});
