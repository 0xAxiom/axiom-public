#!/usr/bin/env node

/**
 * CoinGecko Price Fetcher
 * 
 * Usage:
 *   node price.mjs --token ethereum
 *   node price.mjs --contract 0x... --chain base
 *   node price.mjs --token bitcoin --currency eur --json
 */

const BASE_URL = 'https://api.coingecko.com/api/v3';

function parseArgs(args) {
  const parsed = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].slice(2);
      const val = args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true;
      parsed[key] = val;
      if (val !== true) i++;
    }
  }
  return parsed;
}

function formatNumber(n) {
  if (n == null) return 'N/A';
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
  if (n >= 1) return `$${n.toFixed(2)}`;
  if (n >= 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(8)}`;
}

function formatChange(change) {
  if (change == null) return 'N/A';
  const sign = change >= 0 ? '+' : '';
  return `${sign}${change.toFixed(2)}%`;
}

async function fetchByToken(token, currency) {
  const url = `${BASE_URL}/simple/price?ids=${token}&vs_currencies=${currency}&include_24hr_change=true&include_market_cap=true&include_24hr_vol=true`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`API error: ${res.status} ${res.statusText}`);
  const data = await res.json();
  
  if (!data[token]) {
    throw new Error(`Token "${token}" not found. Check the CoinGecko ID.`);
  }
  
  const d = data[token];
  return {
    id: token,
    price: d[currency],
    change24h: d[`${currency}_24h_change`],
    marketCap: d[`${currency}_market_cap`],
    volume24h: d[`${currency}_24h_vol`],
    currency: currency.toUpperCase(),
  };
}

async function fetchByContract(contract, chain, currency) {
  const url = `${BASE_URL}/simple/token_price/${chain}?contract_addresses=${contract}&vs_currencies=${currency}&include_24hr_change=true&include_market_cap=true&include_24hr_vol=true`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`API error: ${res.status} ${res.statusText}`);
  const data = await res.json();
  
  const addr = contract.toLowerCase();
  if (!data[addr]) {
    throw new Error(`Contract "${contract}" not found on chain "${chain}".`);
  }
  
  const d = data[addr];
  return {
    id: `${contract.slice(0, 10)}...`,
    contract,
    chain,
    price: d[currency],
    change24h: d[`${currency}_24h_change`],
    marketCap: d[`${currency}_market_cap`],
    volume24h: d[`${currency}_24h_vol`],
    currency: currency.toUpperCase(),
  };
}

function printResult(result) {
  const label = result.contract
    ? `${result.contract.slice(0, 10)}... (${result.chain})`
    : result.id;
  
  console.log(`\n${label}`);
  console.log(`  Price:      ${formatNumber(result.price)}`);
  console.log(`  24h Change: ${formatChange(result.change24h)}`);
  console.log(`  Market Cap: ${formatNumber(result.marketCap)}`);
  console.log(`  24h Volume: ${formatNumber(result.volume24h)}`);
  console.log();
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  
  if (!args.token && !args.contract) {
    console.error('Usage:');
    console.error('  node price.mjs --token ethereum');
    console.error('  node price.mjs --contract 0x... --chain base');
    console.error('');
    console.error('Options:');
    console.error('  --token      CoinGecko token ID');
    console.error('  --contract   Token contract address');
    console.error('  --chain      Chain platform ID (default: ethereum)');
    console.error('  --currency   Quote currency (default: usd)');
    console.error('  --json       Output raw JSON');
    process.exit(1);
  }
  
  const currency = args.currency || 'usd';
  
  try {
    let result;
    if (args.contract) {
      const chain = args.chain || 'ethereum';
      result = await fetchByContract(args.contract, chain, currency);
    } else {
      result = await fetchByToken(args.token, currency);
    }
    
    if (args.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      printResult(result);
    }
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

main();
