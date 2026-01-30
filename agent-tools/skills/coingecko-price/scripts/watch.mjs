#!/usr/bin/env node

/**
 * CoinGecko Price Watcher with Alerts
 * 
 * Usage:
 *   node watch.mjs --token ethereum --interval 300 --alert-above 4000 --alert-below 3000
 *   node watch.mjs --contract 0x... --chain base --interval 60
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

function timestamp() {
  return new Date().toLocaleTimeString('en-US', { hour12: false });
}

async function fetchPrice(token, contract, chain, currency) {
  let url, key;
  
  if (contract) {
    url = `${BASE_URL}/simple/token_price/${chain}?contract_addresses=${contract}&vs_currencies=${currency}&include_24hr_change=true&include_market_cap=true&include_24hr_vol=true`;
    key = contract.toLowerCase();
  } else {
    url = `${BASE_URL}/simple/price?ids=${token}&vs_currencies=${currency}&include_24hr_change=true&include_market_cap=true&include_24hr_vol=true`;
    key = token;
  }
  
  const res = await fetch(url);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  const data = await res.json();
  
  if (!data[key]) throw new Error(`Token not found`);
  
  const d = data[key];
  return {
    price: d[currency],
    change24h: d[`${currency}_24h_change`],
    marketCap: d[`${currency}_market_cap`],
    volume24h: d[`${currency}_24h_vol`],
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  
  if (!args.token && !args.contract) {
    console.error('Usage:');
    console.error('  node watch.mjs --token ethereum --interval 300 --alert-above 4000 --alert-below 3000');
    console.error('  node watch.mjs --contract 0x... --chain base --interval 60');
    console.error('');
    console.error('Options:');
    console.error('  --token        CoinGecko token ID');
    console.error('  --contract     Token contract address');
    console.error('  --chain        Chain platform ID (default: ethereum)');
    console.error('  --interval     Check interval in seconds (default: 300)');
    console.error('  --alert-above  Alert when price exceeds this value');
    console.error('  --alert-below  Alert when price drops below this value');
    console.error('  --currency     Quote currency (default: usd)');
    process.exit(1);
  }
  
  const token = args.token;
  const contract = args.contract;
  const chain = args.chain || 'ethereum';
  const currency = args.currency || 'usd';
  const interval = parseInt(args.interval || '300', 10);
  const alertAbove = args['alert-above'] ? parseFloat(args['alert-above']) : null;
  const alertBelow = args['alert-below'] ? parseFloat(args['alert-below']) : null;
  
  const label = contract ? `${contract.slice(0, 10)}... (${chain})` : token;
  
  console.log(`\n📊 Watching ${label}`);
  console.log(`   Interval: ${interval}s`);
  if (alertAbove) console.log(`   🔺 Alert above: ${formatNumber(alertAbove)}`);
  if (alertBelow) console.log(`   🔻 Alert below: ${formatNumber(alertBelow)}`);
  console.log(`   Press Ctrl+C to stop\n`);
  console.log(`${'Time'.padEnd(10)} ${'Price'.padEnd(15)} ${'24h'.padEnd(10)} ${'Market Cap'.padEnd(14)} Volume`);
  console.log('─'.repeat(65));
  
  let lastAlertAbove = false;
  let lastAlertBelow = false;
  
  async function check() {
    try {
      const data = await fetchPrice(token, contract, chain, currency);
      const price = data.price;
      
      let alerts = [];
      
      if (alertAbove && price >= alertAbove && !lastAlertAbove) {
        alerts.push(`🚨 ABOVE ${formatNumber(alertAbove)}!`);
        lastAlertAbove = true;
      } else if (alertAbove && price < alertAbove) {
        lastAlertAbove = false;
      }
      
      if (alertBelow && price <= alertBelow && !lastAlertBelow) {
        alerts.push(`🚨 BELOW ${formatNumber(alertBelow)}!`);
        lastAlertBelow = true;
      } else if (alertBelow && price > alertBelow) {
        lastAlertBelow = false;
      }
      
      const line = `${timestamp().padEnd(10)} ${formatNumber(price).padEnd(15)} ${formatChange(data.change24h).padEnd(10)} ${formatNumber(data.marketCap).padEnd(14)} ${formatNumber(data.volume24h)}`;
      
      if (alerts.length) {
        console.log(`${line}  ${alerts.join(' ')}`);
      } else {
        console.log(line);
      }
    } catch (err) {
      console.error(`${timestamp()} Error: ${err.message}`);
    }
  }
  
  // First check immediately
  await check();
  
  // Then on interval
  setInterval(check, interval * 1000);
}

main();
