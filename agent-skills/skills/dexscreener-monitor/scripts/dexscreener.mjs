#!/usr/bin/env node
/**
 * dexscreener.mjs — Query Dexscreener for token/pair data
 * Zero npm dependencies. Pure Node.js fetch.
 *
 * Usage:
 *   node dexscreener.mjs --search AXIOM
 *   node dexscreener.mjs --token 0xf3Ce5dDAAb6C133F9875a4a46C55cf0b58111B07
 *   node dexscreener.mjs --pair base 0xSomePairAddress
 *   node dexscreener.mjs --trending --chain base
 *   node dexscreener.mjs --token 0x... --json
 */

const BASE_URL = 'https://api.dexscreener.com';

const CHAIN_NAMES = {
  ethereum: 'Ethereum',
  base: 'Base',
  solana: 'Solana',
  arbitrum: 'Arbitrum',
  polygon: 'Polygon',
  bsc: 'BSC',
  optimism: 'Optimism',
  avalanche: 'Avalanche',
};

async function fetch_json(url) {
  const res = await fetch(url, {
    headers: { 'Accept': 'application/json' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  return res.json();
}

function fmt_usd(n) {
  if (!n) return '$0';
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(2)}K`;
  return `$${n.toFixed(4)}`;
}

function fmt_price(p) {
  if (!p) return '$0';
  const n = parseFloat(p);
  if (n >= 1) return `$${n.toFixed(4)}`;
  if (n >= 0.0001) return `$${n.toFixed(6)}`;
  return `$${n.toExponential(4)}`;
}

function fmt_pct(p) {
  if (!p) return '0%';
  const n = parseFloat(p);
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toFixed(2)}%`;
}

function fmt_age(created_at) {
  if (!created_at) return 'unknown';
  const ms = Date.now() - created_at;
  const h = Math.floor(ms / 3600000);
  const d = Math.floor(h / 24);
  if (d > 0) return `${d}d ago`;
  if (h > 0) return `${h}h ago`;
  return `${Math.floor(ms / 60000)}m ago`;
}

function print_pair(pair, idx) {
  const change = pair.priceChange || {};
  const vol = pair.volume || {};
  const liq = pair.liquidity || {};
  const txns = pair.txns?.h24 || {};

  const change_h1 = fmt_pct(change.h1);
  const change_h24 = fmt_pct(change.h24);
  const buys = txns.buys ?? 0;
  const sells = txns.sells ?? 0;

  const label = idx !== undefined ? `[${idx + 1}] ` : '';
  console.log(`${label}${pair.baseToken?.symbol}/${pair.quoteToken?.symbol} on ${pair.chainId?.toUpperCase()} (${pair.dexId})`);
  console.log(`  Price:     ${fmt_price(pair.priceUsd)}  (1h: ${change_h1}  24h: ${change_h24})`);
  console.log(`  Volume:    1h: ${fmt_usd(vol.h1)}  24h: ${fmt_usd(vol.h24)}`);
  console.log(`  Liquidity: ${fmt_usd(liq.usd)}  (base: ${fmt_usd(liq.base)}  quote: ${fmt_usd(liq.quote)})`);
  console.log(`  Txns 24h:  ${buys} buys / ${sells} sells`);
  console.log(`  FDV:       ${fmt_usd(pair.fdv)}  MCap: ${fmt_usd(pair.marketCap)}`);
  console.log(`  Pair age:  ${fmt_age(pair.pairCreatedAt)}`);
  console.log(`  Pair addr: ${pair.pairAddress}`);
  console.log(`  Token:     ${pair.baseToken?.address}`);
  console.log();
}

async function cmd_search(query, opts) {
  const data = await fetch_json(`${BASE_URL}/latest/dex/search?q=${encodeURIComponent(query)}`);
  let pairs = data.pairs || [];

  if (opts.chain) {
    pairs = pairs.filter(p => p.chainId === opts.chain.toLowerCase());
  }
  if (opts.limit) {
    pairs = pairs.slice(0, parseInt(opts.limit));
  }

  if (opts.json) {
    console.log(JSON.stringify(pairs, null, 2));
    return;
  }

  if (pairs.length === 0) {
    console.log(`No pairs found for "${query}"`);
    return;
  }

  console.log(`\nSearch: "${query}" — ${pairs.length} pair(s)\n`);
  pairs.forEach((p, i) => print_pair(p, i));
}

async function cmd_token(address, opts) {
  const data = await fetch_json(`${BASE_URL}/latest/dex/tokens/${address}`);
  let pairs = data.pairs || [];

  if (opts.chain) {
    pairs = pairs.filter(p => p.chainId === opts.chain.toLowerCase());
  }

  if (opts.json) {
    console.log(JSON.stringify(pairs, null, 2));
    return;
  }

  if (pairs.length === 0) {
    console.log(`No pairs found for token ${address}`);
    return;
  }

  const sym = pairs[0]?.baseToken?.symbol || address.slice(0, 8);
  console.log(`\nToken: ${sym} (${address})\n`);

  // Sort by liquidity desc
  pairs.sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0));
  pairs.slice(0, opts.limit ? parseInt(opts.limit) : 5).forEach((p, i) => print_pair(p, i));
}

async function cmd_pair(chain, pair_address, opts) {
  const data = await fetch_json(`${BASE_URL}/latest/dex/pairs/${chain}/${pair_address}`);
  const pairs = data.pairs || (data.pair ? [data.pair] : []);

  if (opts.json) {
    console.log(JSON.stringify(pairs, null, 2));
    return;
  }

  if (pairs.length === 0) {
    console.log(`Pair not found: ${chain}/${pair_address}`);
    return;
  }
  pairs.forEach(p => print_pair(p));
}

async function cmd_trending(opts) {
  // Dexscreener trending/boosted endpoint
  const data = await fetch_json(`${BASE_URL}/token-boosts/top/v1`);
  let tokens = Array.isArray(data) ? data : (data.pairs || []);

  if (opts.chain) {
    tokens = tokens.filter(t => t.chainId === opts.chain.toLowerCase());
  }

  const limit = opts.limit ? parseInt(opts.limit) : 10;
  tokens = tokens.slice(0, limit);

  if (opts.json) {
    console.log(JSON.stringify(tokens, null, 2));
    return;
  }

  if (tokens.length === 0) {
    console.log('No trending tokens found');
    return;
  }

  console.log(`\nTrending tokens${opts.chain ? ` on ${opts.chain}` : ''}:\n`);
  tokens.forEach((t, i) => {
    const chain = t.chainId?.toUpperCase() || '?';
    const sym = t.tokenAddress?.slice(0, 8) || '?';
    console.log(`[${i + 1}] ${chain} — ${t.tokenAddress}`);
    if (t.description) console.log(`     ${t.description.slice(0, 80)}`);
    if (t.amount) console.log(`     Boost amount: ${t.amount}`);
    console.log();
  });
}

function parse_args(argv) {
  const args = argv.slice(2);
  const opts = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--json') opts.json = true;
    else if (a === '--chain' && args[i + 1]) opts.chain = args[++i];
    else if (a === '--limit' && args[i + 1]) opts.limit = args[++i];
    else if (a === '--search' && args[i + 1]) { opts.cmd = 'search'; opts.query = args[++i]; }
    else if (a === '--token' && args[i + 1]) { opts.cmd = 'token'; opts.address = args[++i]; }
    else if (a === '--pair' && args[i + 1] && args[i + 2]) { opts.cmd = 'pair'; opts.chain_arg = args[++i]; opts.pair_addr = args[++i]; }
    else if (a === '--trending') opts.cmd = 'trending';
  }
  return opts;
}

async function main() {
  const opts = parse_args(process.argv);

  switch (opts.cmd) {
    case 'search': await cmd_search(opts.query, opts); break;
    case 'token': await cmd_token(opts.address, opts); break;
    case 'pair': await cmd_pair(opts.chain_arg, opts.pair_addr, opts); break;
    case 'trending': await cmd_trending(opts); break;
    default:
      console.log(`Usage:
  node dexscreener.mjs --search <query>           Search tokens by name/symbol
  node dexscreener.mjs --token <address>          All pairs for a token address
  node dexscreener.mjs --pair <chain> <address>   Specific pair data
  node dexscreener.mjs --trending                 Top boosted/trending tokens

Options:
  --chain <chain>   Filter by chain (base, ethereum, solana, arbitrum...)
  --limit <n>       Max results (default: 5)
  --json            Raw JSON output`);
  }
}

main().catch(e => { console.error(e.message); process.exit(1); });
