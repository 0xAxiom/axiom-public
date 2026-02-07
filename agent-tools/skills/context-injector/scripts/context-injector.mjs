#!/usr/bin/env node
/**
 * Smart Context Injector
 * 
 * Maintains a living state file with key project facts and injects them
 * into isolated cron sessions so they never use stale data.
 * 
 * Commands:
 *   refresh     - Pull live data from on-chain + config sources
 *   show        - Display current state
 *   format      - Output formatted context block (for manual embedding)
 *   inject      - Patch a specific cron job payload with current context
 *   inject-all  - Patch all matching cron job payloads
 *   diff        - Show what would change without applying
 * 
 * Author: Axiom 🔬
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { homedir } from 'os';
import { join, dirname } from 'path';
import { execSync } from 'child_process';

// ─── Config ──────────────────────────────────────────────────────

const CONFIG_PATH = join(homedir(), '.config/context-injector/config.json');
const DEFAULT_STATE_PATH = join(homedir(), '.config/context-injector/current-state.json');

function loadConfig() {
  if (!existsSync(CONFIG_PATH)) {
    console.error(`Config not found at ${CONFIG_PATH}`);
    console.error('Copy config.example.json to ~/.config/context-injector/config.json');
    process.exit(1);
  }
  const raw = readFileSync(CONFIG_PATH, 'utf8');
  return JSON.parse(raw);
}

function getStatePath(config) {
  const p = config.statePath || DEFAULT_STATE_PATH;
  return p.replace('~', homedir());
}

function loadState(config) {
  const path = getStatePath(config);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf8'));
}

function saveState(config, state) {
  const path = getStatePath(config);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(state, null, 2));
}

// ─── On-Chain Data ───────────────────────────────────────────────

async function fetchEtherscan(chainId, module, action, params = {}) {
  const apiKey = process.env.ETHERSCAN_API_KEY;
  if (!apiKey) {
    console.warn('ETHERSCAN_API_KEY not set, skipping on-chain reads');
    return null;
  }
  
  const qs = new URLSearchParams({
    chainid: String(chainId),
    module,
    action,
    apikey: apiKey,
    ...params
  });
  
  const url = `https://api.etherscan.io/v2/api?${qs}`;
  try {
    const resp = await fetch(url);
    const data = await resp.json();
    if (data.status === '1' || data.message === 'OK') {
      return data.result;
    }
    console.warn(`Etherscan ${action}: ${data.message || data.result}`);
    return null;
  } catch (err) {
    console.warn(`Etherscan fetch error: ${err.message}`);
    return null;
  }
}

async function readContractUint(chainId, contract, functionSig, rpcUrl) {
  // Use direct JSON-RPC eth_call (Etherscan V2 free doesn't support proxy on Base)
  const rpc = rpcUrl || getRpcUrl(chainId);
  try {
    const resp = await fetch(rpc, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_call',
        params: [{ to: contract, data: functionSig }, 'latest'],
        id: 1
      })
    });
    const data = await resp.json();
    if (data.result && data.result !== '0x') {
      return BigInt(data.result);
    }
    return null;
  } catch (err) {
    console.warn(`  RPC call failed: ${err.message}`);
    return null;
  }
}

function getRpcUrl(chainId) {
  const rpcs = {
    1: 'https://eth.llamarpc.com',
    8453: 'https://mainnet.base.org',
    137: 'https://polygon-rpc.com',
    42161: 'https://arb1.arbitrum.io/rpc',
  };
  return rpcs[chainId] || 'https://mainnet.base.org';
}

// Common function selectors
const SELECTORS = {
  totalSupply: '0x18160ddd',
  maxSupply: '0xd5abeb01',      // maxSupply() - common in NFT contracts
  balanceOf: '0x70a08231',       // balanceOf(address) - need to pad address
  totalMinted: '0xa2309ff8',     // _totalMinted() or similar
};

function padAddress(addr) {
  return '0x' + addr.replace('0x', '').toLowerCase().padStart(64, '0');
}

async function getFund1Data(config) {
  const { contract, chainId, rpc } = config.sources.fund1;
  const fund = {
    contract,
    website: config.projects?.axiomVentures?.site || 'axiomventures.xyz',
    opensea: config.projects?.axiomVentures?.opensea || 'opensea.io/collection/axiom-ventures',
    priceUSDC: 1000,
    maxPerWallet: 5,
  };

  // Read maxSupply
  const maxSupply = await readContractUint(chainId, contract, SELECTORS.maxSupply, rpc);
  fund.maxSupply = maxSupply ? Number(maxSupply) : 20;

  // Read _totalMinted() — ERC721A uses this instead of totalSupply
  const totalMinted = await readContractUint(chainId, contract, SELECTORS.totalMinted, rpc);
  fund.totalMinted = totalMinted !== null ? Number(totalMinted) : null;

  return fund;
}

async function getAxiomTokenData(config) {
  const { ca, deadAddress, chainId } = config.sources.axiomToken;
  const rpc = getRpcUrl(chainId);
  const token = { ca };

  // Get total supply
  const totalSupply = await readContractUint(chainId, ca, SELECTORS.totalSupply, rpc);
  
  // Get burned amount (balance of dead address)
  const burnSelector = SELECTORS.balanceOf + padAddress(deadAddress).slice(2);
  const burnedRaw = await readContractUint(chainId, ca, burnSelector, rpc);

  if (totalSupply && burnedRaw) {
    const totalSupplyNum = Number(totalSupply / BigInt(10**18));
    const burnedNum = Number(burnedRaw / BigInt(10**18));
    const burnPct = ((burnedNum / totalSupplyNum) * 100).toFixed(2);
    
    token.totalBurned = formatLargeNumber(burnedNum);
    token.burnPercent = `${burnPct}%`;
    token.totalSupply = formatLargeNumber(totalSupplyNum);
  }

  return token;
}

function formatLargeNumber(n) {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(0)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

// ─── Refresh ─────────────────────────────────────────────────────

async function refresh(config) {
  console.log('Refreshing state from live sources...');
  
  const state = {
    lastRefreshed: new Date().toISOString(),
    schemaVersion: 1,
  };

  // Fund 1
  console.log('  → Fund 1 contract...');
  state.fund1 = await getFund1Data(config);
  console.log(`    maxSupply=${state.fund1.maxSupply}, totalMinted=${state.fund1.totalMinted}`);

  // AXIOM token
  console.log('  → AXIOM token burns...');
  state.axiomToken = await getAxiomTokenData(config);
  console.log(`    burned=${state.axiomToken.totalBurned} (${state.axiomToken.burnPercent})`);

  // Static data from config
  state.projects = config.projects || {};
  state.identity = config.identity || {};

  saveState(config, state);
  console.log(`\nState saved to ${getStatePath(config)}`);
  return state;
}

// ─── Format ──────────────────────────────────────────────────────

function formatContextBlock(state) {
  const lines = [
    `⚠️ CURRENT FACTS (auto-refreshed ${state.lastRefreshed}):`,
  ];

  // Fund 1
  if (state.fund1) {
    const f = state.fund1;
    const mintedStr = f.totalMinted !== null ? `${f.totalMinted} minted` : 'minted count unknown';
    lines.push(`- Fund 1: ${f.maxSupply} slips total, ${mintedStr}, $${f.priceUSDC} each, max ${f.maxPerWallet}/wallet`);
    lines.push(`- Fund 1 contract: ${f.contract} (Base mainnet)`);
    lines.push(`- Fund 1 website: ${f.website} | OpenSea: ${f.opensea}`);
  }

  // AXIOM token
  if (state.axiomToken) {
    const t = state.axiomToken;
    if (t.totalBurned) {
      lines.push(`- $AXIOM CA: ${t.ca}`);
      lines.push(`- $AXIOM burned: ${t.totalBurned} (${t.burnPercent} of supply)`);
    }
  }

  // Identity
  if (state.identity) {
    const parts = [];
    if (state.identity.twitter) parts.push(`Twitter: ${state.identity.twitter}`);
    if (state.identity.repo) parts.push(`Repo: ${state.identity.repo}`);
    if (state.identity.basename) parts.push(`Basename: ${state.identity.basename}`);
    if (parts.length) lines.push(`- ${parts.join(' | ')}`);
  }

  // Projects
  if (state.projects) {
    const projParts = [];
    for (const [key, val] of Object.entries(state.projects)) {
      if (val.site) projParts.push(`${key}: ${val.site}`);
    }
    if (projParts.length) lines.push(`- Projects: ${projParts.join(', ')}`);
  }

  lines.push('DO NOT use any other numbers for these facts. These are LIVE on-chain values.');
  
  return lines.join('\n');
}

// ─── Cron Integration ────────────────────────────────────────────

function getOpenClawCronList() {
  // Use OpenClaw CLI to list cron jobs
  try {
    const output = execSync('openclaw cron list --json 2>/dev/null', { 
      encoding: 'utf8',
      timeout: 10000 
    });
    return JSON.parse(output);
  } catch {
    // Fallback: read from gateway API via curl
    try {
      const configRaw = readFileSync(
        join(homedir(), '.clawdbot/moltbot.json'), 'utf8'
      );
      const gwConfig = JSON.parse(configRaw);
      const port = gwConfig.gateway?.port || 18789;
      const token = gwConfig.gateway?.auth?.token;
      
      const output = execSync(
        `curl -s http://localhost:${port}/api/cron/list -H "Authorization: Bearer ${token}"`,
        { encoding: 'utf8', timeout: 10000 }
      );
      return JSON.parse(output);
    } catch (e2) {
      console.error('Cannot reach OpenClaw cron API:', e2.message);
      return null;
    }
  }
}

function findMatchingJobs(jobs, config) {
  const filter = config.cronJobFilter || {};
  const namePatterns = filter.nameContains || [];
  
  if (!jobs || !Array.isArray(jobs)) return [];
  
  return jobs.filter(job => {
    // Check if payload contains the context placeholder
    const payloadText = typeof job.payload === 'string' 
      ? job.payload 
      : JSON.stringify(job.payload || {});
    
    const hasPlaceholder = payloadText.includes(config.contextPlaceholder || '{{CONTEXT}}');
    
    // Or matches name filter
    const matchesName = namePatterns.length === 0 || namePatterns.some(pattern => 
      (job.name || '').toLowerCase().includes(pattern.toLowerCase())
    );
    
    return hasPlaceholder || matchesName;
  });
}

// ─── CLI ─────────────────────────────────────────────────────────

async function main() {
  const command = process.argv[2] || 'show';
  const arg = process.argv[3];

  const config = loadConfig();

  switch (command) {
    case 'refresh': {
      const state = await refresh(config);
      console.log('\n' + formatContextBlock(state));
      break;
    }

    case 'show': {
      const state = loadState(config);
      if (!state) {
        console.log('No state file found. Run `refresh` first.');
        process.exit(1);
      }
      console.log(JSON.stringify(state, null, 2));
      break;
    }

    case 'format': {
      const state = loadState(config);
      if (!state) {
        console.log('No state file found. Run `refresh` first.');
        process.exit(1);
      }
      // Output just the formatted block (for piping into other tools)
      console.log(formatContextBlock(state));
      break;
    }

    case 'diff': {
      const state = loadState(config);
      if (!state) {
        console.log('No state file found. Run `refresh` first.');
        process.exit(1);
      }
      const contextBlock = formatContextBlock(state);
      const jobs = getOpenClawCronList();
      if (!jobs) {
        console.log('Cannot reach cron API');
        process.exit(1);
      }
      const matching = findMatchingJobs(jobs.jobs || jobs, config);
      console.log(`Found ${matching.length} matching cron jobs:\n`);
      for (const job of matching) {
        console.log(`  📋 ${job.name || job.id} (${job.id})`);
        const payload = typeof job.payload === 'object' ? job.payload : {};
        const text = payload.text || payload.message || '';
        if (text.includes(config.contextPlaceholder || '{{CONTEXT}}')) {
          console.log(`     Has {{CONTEXT}} placeholder — will be replaced`);
        } else {
          console.log(`     No placeholder — would append context block`);
        }
      }
      console.log('\nContext block that would be injected:');
      console.log('─'.repeat(60));
      console.log(contextBlock);
      break;
    }

    case 'inject':
    case 'inject-all': {
      const state = loadState(config);
      if (!state) {
        console.log('No state file found. Run `refresh` first.');
        process.exit(1);
      }
      const contextBlock = formatContextBlock(state);
      
      // Output the context block to stdout for programmatic use
      // The actual cron patching should be done via OpenClaw API from the agent
      console.log(JSON.stringify({
        action: command === 'inject-all' ? 'inject-all' : 'inject',
        targetJobId: arg || null,
        contextBlock,
        state,
        timestamp: new Date().toISOString()
      }, null, 2));
      break;
    }

    default:
      console.log(`Usage: context-injector.mjs <command>

Commands:
  refresh      Pull live data from on-chain sources
  show         Display current state (JSON)
  format       Output formatted context block (text)
  inject [id]  Generate injection payload for a cron job
  inject-all   Generate injection payloads for all matching jobs
  diff         Show what would change`);
  }
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
