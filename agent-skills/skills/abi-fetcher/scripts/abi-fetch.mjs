#!/usr/bin/env node
/**
 * abi-fetch.mjs — Fetch verified contract ABIs from Sourcify or Etherscan-family explorers.
 *
 * Usage:
 *   node abi-fetch.mjs <address> [options]
 *
 * Options:
 *   --chain <id>        Chain ID (default: 1 = Ethereum mainnet)
 *   --no-cache          Skip cache, always fetch fresh
 *   --cache-dir <path>  Cache directory (default: ~/.abi-cache)
 *   --etherscan-key <k> Etherscan API key (optional, increases rate limits)
 *   --json              Output raw JSON ABI array only
 *   --functions         List function signatures only
 *   --events            List event signatures only
 *
 * Zero dependencies — uses Node.js built-in fetch (Node 18+).
 *
 * Exit codes:
 *   0 = success
 *   1 = not found / not verified
 *   2 = bad input
 */

import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { homedir } from 'os';

// ─── Chain registry ───────────────────────────────────────────────────────────

const CHAINS = {
  1:       { name: 'Ethereum',       explorer: 'https://api.etherscan.io/api' },
  8453:    { name: 'Base',           explorer: 'https://api.basescan.org/api' },
  84532:   { name: 'Base Sepolia',   explorer: 'https://api-sepolia.basescan.org/api' },
  137:     { name: 'Polygon',        explorer: 'https://api.polygonscan.com/api' },
  42161:   { name: 'Arbitrum One',   explorer: 'https://api.arbiscan.io/api' },
  10:      { name: 'Optimism',       explorer: 'https://api-optimistic.etherscan.io/api' },
  56:      { name: 'BSC',            explorer: 'https://api.bscscan.com/api' },
  43114:   { name: 'Avalanche',      explorer: 'https://api.snowtrace.io/api' },
  250:     { name: 'Fantom',         explorer: 'https://api.ftmscan.com/api' },
  100:     { name: 'Gnosis',         explorer: 'https://api.gnosisscan.io/api' },
  534352:  { name: 'Scroll',         explorer: 'https://api.scrollscan.com/api' },
  59144:   { name: 'Linea',          explorer: 'https://api.lineascan.build/api' },
  7777777: { name: 'Zora',           explorer: 'https://explorer.zora.energy/api' },
  11155111:{ name: 'Sepolia',        explorer: 'https://api-sepolia.etherscan.io/api' },
};

// Known ERC-20 proxy patterns (implementation slot)
const IMPL_SLOTS = [
  '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc', // ERC-1967
  '0x7050c9e0f4ca769c69bd3a8ef740bc37934f8e2c036e5a723fd8ee048ed3f8c3', // UUPS alt
  '0xc5f16f0fcc639fa48a6947836d9850f504798523bf8c9a3a87d5876cf622bcf7', // Compound
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    address: null,
    chain: 1,
    noCache: false,
    cacheDir: join(homedir(), '.abi-cache'),
    etherscanKey: process.env.ETHERSCAN_API_KEY || '',
    json: false,
    functions: false,
    events: false,
  };

  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('0x') || /^[0-9a-fA-F]{40}$/.test(args[i])) {
      opts.address = args[i].toLowerCase();
      if (!opts.address.startsWith('0x')) opts.address = '0x' + opts.address;
    } else if (args[i] === '--chain' && args[i+1]) {
      opts.chain = parseInt(args[++i]);
    } else if (args[i] === '--no-cache') {
      opts.noCache = true;
    } else if (args[i] === '--cache-dir' && args[i+1]) {
      opts.cacheDir = resolve(args[++i]);
    } else if (args[i] === '--etherscan-key' && args[i+1]) {
      opts.etherscanKey = args[++i];
    } else if (args[i] === '--json') {
      opts.json = true;
    } else if (args[i] === '--functions') {
      opts.functions = true;
    } else if (args[i] === '--events') {
      opts.events = true;
    }
  }

  return opts;
}

function isValidAddress(addr) {
  return /^0x[0-9a-fA-F]{40}$/.test(addr);
}

function ensureDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function cacheGet(dir, chainId, address) {
  const file = join(dir, String(chainId), `${address}.json`);
  if (existsSync(file)) {
    try { return JSON.parse(readFileSync(file, 'utf8')); } catch {}
  }
  return null;
}

function cacheSet(dir, chainId, address, data) {
  const chainDir = join(dir, String(chainId));
  ensureDir(chainDir);
  writeFileSync(join(chainDir, `${address}.json`), JSON.stringify(data, null, 2));
}

async function fetchJSON(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'abi-fetch/1.0 (github.com/0xAxiom/axiom-public)' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  return res.json();
}

// ─── Sourcify ─────────────────────────────────────────────────────────────────

async function fetchFromSourceify(chainId, address) {
  // Try full_match first, then partial_match
  for (const matchType of ['full_match', 'partial_match']) {
    try {
      const url = `https://repo.sourcify.dev/contracts/${matchType}/${chainId}/${address}/metadata.json`;
      const meta = await fetchJSON(url);
      if (meta?.output?.abi) {
        return { abi: meta.output.abi, source: `Sourcify (${matchType})`, name: meta.settings?.compilationTarget
          ? Object.values(meta.settings.compilationTarget)[0]
          : 'Unknown' };
      }
    } catch {}
  }

  // Try Sourcify server API
  try {
    const url = `https://sourcify.dev/server/v1/files/any/${chainId}/${address}`;
    const data = await fetchJSON(url);
    const metaFile = data?.files?.find(f => f.name === 'metadata.json');
    if (metaFile?.content) {
      const meta = JSON.parse(metaFile.content);
      if (meta?.output?.abi) {
        return { abi: meta.output.abi, source: 'Sourcify (server)', name: 'Unknown' };
      }
    }
  } catch {}

  return null;
}

// ─── Etherscan-family ─────────────────────────────────────────────────────────

async function fetchFromEtherscan(chainId, address, apiKey) {
  const chain = CHAINS[chainId];
  if (!chain?.explorer) return null;

  const keyParam = apiKey ? `&apikey=${apiKey}` : '';
  const url = `${chain.explorer}?module=contract&action=getabi&address=${address}${keyParam}`;

  try {
    const data = await fetchJSON(url);
    if (data.status === '1' && data.result && data.result !== 'Contract source code not verified') {
      const abi = JSON.parse(data.result);
      return { abi, source: 'Etherscan', name: 'Unknown' };
    }
  } catch {}

  return null;
}

// ─── Proxy detection ─────────────────────────────────────────────────────────

async function resolveProxy(chainId, address) {
  // Use a public RPC to read implementation slot
  const rpcs = {
    1:       'https://eth.llamarpc.com',
    8453:    'https://mainnet.base.org',
    137:     'https://polygon-rpc.com',
    42161:   'https://arb1.arbitrum.io/rpc',
    10:      'https://mainnet.optimism.io',
    56:      'https://bsc-dataseed.binance.org',
  };

  const rpc = rpcs[chainId];
  if (!rpc) return null;

  for (const slot of IMPL_SLOTS) {
    try {
      const res = await fetch(rpc, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0', id: 1,
          method: 'eth_getStorageAt',
          params: [address, slot, 'latest'],
        }),
        signal: AbortSignal.timeout(8_000),
      });
      const data = await res.json();
      const raw = data?.result;
      if (raw && raw !== '0x' + '0'.repeat(64)) {
        // Last 20 bytes = address
        const impl = '0x' + raw.slice(-40).toLowerCase();
        if (impl !== '0x' + '0'.repeat(40)) {
          return impl;
        }
      }
    } catch {}
  }
  return null;
}

// ─── Display helpers ─────────────────────────────────────────────────────────

function humanizeAbi(abi, opts) {
  if (opts.json) {
    console.log(JSON.stringify(abi, null, 2));
    return;
  }

  const functions = abi.filter(x => x.type === 'function');
  const events = abi.filter(x => x.type === 'event');
  const errors = abi.filter(x => x.type === 'error');
  const constructor = abi.find(x => x.type === 'constructor');

  if (opts.functions) {
    functions.forEach(f => console.log(buildSig(f)));
    return;
  }
  if (opts.events) {
    events.forEach(e => console.log(buildSig(e)));
    return;
  }

  // Full summary
  if (constructor) {
    console.log(`\nconstructor(${(constructor.inputs||[]).map(i => `${i.type} ${i.name}`).join(', ')})`);
  }

  if (functions.length) {
    console.log(`\n📋 Functions (${functions.length}):`);
    const view = functions.filter(f => f.stateMutability === 'view' || f.stateMutability === 'pure');
    const write = functions.filter(f => f.stateMutability !== 'view' && f.stateMutability !== 'pure');
    if (view.length) {
      console.log('  Read:');
      view.forEach(f => console.log(`    ${buildSig(f)}`));
    }
    if (write.length) {
      console.log('  Write:');
      write.forEach(f => console.log(`    ${buildSig(f)}`));
    }
  }

  if (events.length) {
    console.log(`\n📢 Events (${events.length}):`);
    events.forEach(e => console.log(`  ${buildSig(e)}`));
  }

  if (errors.length) {
    console.log(`\n❌ Errors (${errors.length}):`);
    errors.forEach(e => console.log(`  ${e.name}(${(e.inputs||[]).map(i => i.type).join(', ')})`));
  }
}

function buildSig(item) {
  const inputs = (item.inputs || []).map(i => {
    const indexed = i.indexed ? ' indexed' : '';
    return `${i.type}${indexed} ${i.name}`;
  }).join(', ');
  const outputs = (item.outputs || []).map(o => o.type).join(', ');
  const mut = item.stateMutability ? ` [${item.stateMutability}]` : '';
  const ret = outputs ? ` → (${outputs})` : '';
  return `${item.name}(${inputs})${mut}${ret}`;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs();

  if (!opts.address) {
    console.error('Usage: node abi-fetch.mjs <address> [--chain <id>] [--json] [--functions] [--events] [--no-cache]');
    console.error('\nAvailable chains: ' + Object.entries(CHAINS).map(([id, c]) => `${c.name} (${id})`).join(', '));
    process.exit(2);
  }

  if (!isValidAddress(opts.address)) {
    console.error(`Invalid address: ${opts.address}`);
    process.exit(2);
  }

  const chainInfo = CHAINS[opts.chain] || { name: `Chain ${opts.chain}` };

  if (!opts.json) {
    console.log(`\n🔍 Fetching ABI for ${opts.address}`);
    console.log(`   Chain: ${chainInfo.name} (${opts.chain})`);
  }

  // Check cache
  if (!opts.noCache) {
    const cached = cacheGet(opts.cacheDir, opts.chain, opts.address);
    if (cached) {
      if (!opts.json) {
        console.log(`   Source: Cache (${opts.cacheDir})`);
        if (cached.proxy) console.log(`   Proxy → impl: ${cached.proxy}`);
        if (cached.name) console.log(`   Contract: ${cached.name}`);
        console.log(`   ABI: ${cached.abi.length} entries\n`);
      }
      humanizeAbi(cached.abi, opts);
      return;
    }
  }

  // Check for proxy
  let resolvedAddress = opts.address;
  let proxyImpl = null;

  if (!opts.json) process.stdout.write('   Checking proxy... ');
  proxyImpl = await resolveProxy(opts.chain, opts.address);
  if (proxyImpl) {
    resolvedAddress = proxyImpl;
    if (!opts.json) console.log(`proxy → ${proxyImpl}`);
  } else {
    if (!opts.json) console.log('not a proxy');
  }

  // Try Sourcify first (free, no key needed)
  if (!opts.json) process.stdout.write('   Trying Sourcify... ');
  let result = await fetchFromSourceify(opts.chain, resolvedAddress);
  if (!opts.json) console.log(result ? `found (${result.source})` : 'not found');

  // Fall back to Etherscan
  if (!result) {
    if (!opts.json) process.stdout.write('   Trying Etherscan... ');
    result = await fetchFromEtherscan(opts.chain, resolvedAddress, opts.etherscanKey);
    if (!opts.json) console.log(result ? 'found' : 'not found');
  }

  // If proxy impl not found, try original address on Etherscan
  if (!result && proxyImpl) {
    if (!opts.json) process.stdout.write('   Trying original address on Etherscan... ');
    result = await fetchFromEtherscan(opts.chain, opts.address, opts.etherscanKey);
    if (!opts.json) console.log(result ? 'found' : 'not found');
  }

  if (!result) {
    console.error(`\n❌ ABI not found for ${opts.address} on ${chainInfo.name}`);
    console.error('   Contract may not be verified on Sourcify or Etherscan.');
    console.error('   Try: https://sourcify.dev/#/lookup/' + opts.address);
    process.exit(1);
  }

  // Cache result
  if (!opts.noCache) {
    const toCache = { ...result, proxy: proxyImpl, cachedAt: new Date().toISOString() };
    cacheSet(opts.cacheDir, opts.chain, opts.address, toCache);
    if (!opts.json) console.log(`   Cached to: ${opts.cacheDir}/${opts.chain}/${opts.address}.json`);
  }

  if (!opts.json) {
    if (proxyImpl) console.log(`   Proxy impl: ${proxyImpl}`);
    if (result.name) console.log(`   Contract: ${result.name}`);
    console.log(`   ABI: ${result.abi.length} entries\n`);
  }

  humanizeAbi(result.abi, opts);
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
