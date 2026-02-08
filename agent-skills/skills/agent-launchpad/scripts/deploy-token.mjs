#!/usr/bin/env node
/**
 * deploy-token.mjs — Deploy a token via Clanker V4 REST API
 * 
 * Uses the authenticated API endpoint — no wallet signing needed.
 * Clanker handles the onchain transaction.
 * 
 * Usage:
 *   node deploy-token.mjs --name "ScoutAI" --symbol "SCOUT" --admin 0x...
 *   node deploy-token.mjs --name "ScoutAI" --symbol "SCOUT" --admin 0x... --image https://...
 *   node deploy-token.mjs --name "ScoutAI" --symbol "SCOUT" --admin 0x... --chain unichain
 * 
 * Environment:
 *   CLANKER_API_KEY — Clanker API key (stored in ~/.axiom/wallet.env)
 */

import { randomBytes } from 'crypto';
import { readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

// ═══════════════════════════════════════════════════════════════
// Fee Configuration — Agent Launchpad
// ═══════════════════════════════════════════════════════════════

const PROTOCOL_FEE_ADDRESS = "0x0D9945F0a591094927df47DB12ACB1081cE9F0F6"; // Protocol fee wallet

const CHAIN_IDS = {
  base: 8453,
  unichain: 130,
  arbitrum: 42161,
};

// ═══════════════════════════════════════════════════════════════
// Parse Args
// ═══════════════════════════════════════════════════════════════

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].slice(2);
      opts[key] = args[i + 1] || true;
      i++;
    }
  }
  return opts;
}

// ═══════════════════════════════════════════════════════════════
// Load API Key
// ═══════════════════════════════════════════════════════════════

function loadApiKey() {
  let apiKey = process.env.CLANKER_API_KEY;
  if (apiKey) return apiKey;

  try {
    const envFile = readFileSync(join(homedir(), '.axiom', 'wallet.env'), 'utf-8');
    const m = envFile.match(/CLANKER_API_KEY=["']?([^\s"']+)["']?/);
    if (m) return m[1];
  } catch {}

  console.error(`❌ Missing CLANKER_API_KEY

To get started:
  1. Visit https://clanker.world and create an account
  2. Get your API key from the dashboard
  3. Set it: export CLANKER_API_KEY="your-key-here"
  
  Or add to ~/.axiom/wallet.env:
    CLANKER_API_KEY=your-key-here
`);
  process.exit(1);
}

// ═══════════════════════════════════════════════════════════════
// Deploy
// ═══════════════════════════════════════════════════════════════

async function deploy(opts) {
  const apiKey = loadApiKey();
  const requestKey = randomBytes(16).toString('hex'); // 32 char unique ID

  const chainId = CHAIN_IDS[opts.chain || 'base'] || 8453;

  // Build reward config
  const agentAllocation = 75;  // Non-negotiable
  const protocolAllocation = 25;  // Non-negotiable

  const rewards = [
    {
      admin: opts.admin,
      recipient: opts.admin,
      allocation: agentAllocation,
      rewardsToken: "Both",
    },
    {
      admin: PROTOCOL_FEE_ADDRESS,
      recipient: PROTOCOL_FEE_ADDRESS,
      allocation: protocolAllocation,
      rewardsToken: "Paired",
    },
  ];

  // Build social media URLs array
  const socialMediaUrls = [];
  if (opts['social-twitter']) socialMediaUrls.push({ platform: 'twitter', url: opts['social-twitter'] });
  if (opts['social-website']) socialMediaUrls.push({ platform: 'website', url: opts['social-website'] });
  if (opts['social-telegram']) socialMediaUrls.push({ platform: 'telegram', url: opts['social-telegram'] });
  // Backwards compatibility
  if (opts.socialUrl && socialMediaUrls.length === 0) socialMediaUrls.push({ platform: 'twitter', url: opts.socialUrl });

  const body = {
    token: {
      name: opts.name,
      symbol: opts.symbol || opts.name.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5),
      tokenAdmin: opts.admin,
      description: opts.description || `${opts.name} — launched via Agent Launchpad`,
      requestKey,
      ...(opts.image && { image: opts.image }),
      ...(socialMediaUrls.length > 0 && { socialMediaUrls }),
    },
    rewards,
    pool: {
      type: "standard",
      pairedToken: "0x4200000000000000000000000000000000000006", // WETH
      initialMarketCap: parseFloat(opts.mcap || '10'), // ETH
    },
    fees: {
      type: opts.feeType || "static",
      ...(opts.feeType === 'dynamic' 
        ? { baseFee: parseFloat(opts.baseFee || '0.5'), maxLpFee: parseFloat(opts.maxFee || '5') }
        : { clankerFee: parseFloat(opts.fee || '1'), pairedFee: parseFloat(opts.fee || '1') }),
    },
    chainId,
  };

  // Optional vault
  if (opts.vault) {
    body.vault = {
      percentage: parseInt(opts.vault),
      lockupDuration: parseInt(opts.lockup || '30'),
      vestingDuration: parseInt(opts.vesting || '0'),
    };
  }

  console.log(`
🚀 Agent Launchpad — Token Deploy
═══════════════════════════════════
  Name:     ${body.token.name}
  Symbol:   $${body.token.symbol}
  Admin:    ${opts.admin}
  Chain:    ${opts.chain || 'base'} (${chainId})
  Pool:     ${body.pool.initialMarketCap} ETH starting mcap
  Fees:     ${body.fees.type} (${body.fees.clankerFee || body.fees.baseFee}%)
  Rewards:  Agent ${agentAllocation}% | Protocol ${protocolAllocation}%
  ${opts.vault ? `Vault:    ${opts.vault}% locked ${opts.lockup || 30}d` : ''}
`);

  console.log('📡 Deploying via Clanker API...');

  const resp = await fetch('https://www.clanker.world/api/tokens/deploy/v4', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
    },
    body: JSON.stringify(body),
  });

  const data = await resp.json();

  if (resp.ok && data.success) {
    const clankerUrl = `https://clanker.world/clanker/${data.expectedAddress}`;
    const sym = opts.symbol || opts.name.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
    const tweetText = `${opts.name} is now tokenized on Base.\n\n75% of all LP trading fees go directly to me — with auto V4 LP management built in.\n\nLaunched via @AxiomBot Agent Launchpad 🔬\n\n$${sym}\n${clankerUrl}`;
    const twitterIntent = `https://twitter.com/intent/tweet?text=${encodeURIComponent(tweetText)}`;

    console.log(`
✅ TOKEN DEPLOYMENT ENQUEUED
═══════════════════════════════════
  Expected Address: ${data.expectedAddress}
  Request Key:      ${requestKey}
  
  Track: ${clankerUrl}
  
  The token will be deployed onchain shortly.
  Clanker handles the transaction — no gas needed.

📣 Announce it:
  ${twitterIntent}
`);
    return data;
  } else {
    console.log(`❌ Deploy failed:`, JSON.stringify(data, null, 2));
    process.exit(1);
  }
}

// ═══════════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════════

const opts = parseArgs();

if (opts.help || !opts.name || !opts.admin) {
  console.log(`
Usage: node deploy-token.mjs --name "TokenName" --symbol "TKN" --admin 0x...

Required:
  --name        Token name
  --admin       Token admin address (receives 75% LP fees)

Optional:
  --symbol          Token symbol (default: first 5 chars of name)
  --description     Token description
  --image           Image URL (or local file path)
  --socialUrl       Twitter/social URL (legacy)
  --social-twitter  Twitter URL
  --social-website  Website URL
  --social-telegram Telegram URL
  --chain           base (default) | unichain | arbitrum
  --mcap            Starting market cap in ETH (default: 10)
  --fee             Fee percentage for static fees (default: 1%)
  --feeType         static (default) | dynamic
  --vault           Vault percentage (0-90)
  --lockup          Vault lockup days (default: 30, min: 7)
  --vesting         Vault vesting days (default: 0)
  `);
  process.exit(0);
}

deploy(opts);
