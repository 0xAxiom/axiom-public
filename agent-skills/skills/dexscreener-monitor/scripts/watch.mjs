#!/usr/bin/env node
/**
 * watch.mjs — Alert on price/liquidity changes for a Dexscreener token
 * Zero dependencies. Polls Dexscreener API on interval.
 *
 * Usage:
 *   node watch.mjs --token 0x... --alert-pump 20 --alert-dump 15
 *   node watch.mjs --token 0x... --alert-liquidity 5000 --interval 60
 *   node watch.mjs --token 0x... --chain base --top-pair
 */

const BASE_URL = 'https://api.dexscreener.com';

async function fetch_pair(address, chain) {
  const res = await fetch(`${BASE_URL}/latest/dex/tokens/${address}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  let pairs = data.pairs || [];
  if (chain) pairs = pairs.filter(p => p.chainId === chain.toLowerCase());
  if (pairs.length === 0) return null;
  // Return highest-liquidity pair
  pairs.sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0));
  return pairs[0];
}

function fmt_price(p) {
  if (!p) return '$0';
  const n = parseFloat(p);
  if (n >= 1) return `$${n.toFixed(4)}`;
  if (n >= 0.0001) return `$${n.toFixed(6)}`;
  return `$${n.toExponential(4)}`;
}

function fmt_usd(n) {
  if (!n) return '$0';
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(2)}K`;
  return `$${n.toFixed(0)}`;
}

function pct_change(old_val, new_val) {
  if (!old_val || old_val === 0) return 0;
  return ((new_val - old_val) / old_val) * 100;
}

function alert(level, msg) {
  const ts = new Date().toISOString().slice(11, 19);
  const prefix = level === 'CRITICAL' ? '[!!!]' : level === 'WARN' ? '[!]' : '[i]';
  console.log(`${ts} ${prefix} ${msg}`);
}

function parse_args(argv) {
  const args = argv.slice(2);
  const opts = {
    interval: 60,
    alert_pump: null,
    alert_dump: null,
    alert_liquidity: null,
    chain: null,
    json_alerts: false,
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--token' && args[i + 1]) opts.token = args[++i];
    else if (a === '--chain' && args[i + 1]) opts.chain = args[++i];
    else if (a === '--interval' && args[i + 1]) opts.interval = parseInt(args[++i]);
    else if (a === '--alert-pump' && args[i + 1]) opts.alert_pump = parseFloat(args[++i]);
    else if (a === '--alert-dump' && args[i + 1]) opts.alert_dump = parseFloat(args[++i]);
    else if (a === '--alert-liquidity' && args[i + 1]) opts.alert_liquidity = parseFloat(args[++i]);
    else if (a === '--json-alerts') opts.json_alerts = true;
  }
  return opts;
}

async function main() {
  const opts = parse_args(process.argv);

  if (!opts.token) {
    console.log(`Usage:
  node watch.mjs --token <address> [options]

Options:
  --chain <chain>           Filter to specific chain (base, ethereum, solana...)
  --interval <seconds>      Poll interval in seconds (default: 60)
  --alert-pump <pct>        Alert if price pumps by X% since last check
  --alert-dump <pct>        Alert if price dumps by X% since last check
  --alert-liquidity <usd>   Alert if liquidity drops below $X
  --json-alerts             Output alerts as JSON (for piping to other tools)

Examples:
  node watch.mjs --token 0xf3Ce5dDAAb6C133F9875a4a46C55cf0b58111B07 --chain base --alert-pump 20 --alert-dump 15
  node watch.mjs --token 0xf3Ce5d... --alert-liquidity 5000 --interval 120`);
    process.exit(0);
  }

  console.log(`Watching ${opts.token}${opts.chain ? ` on ${opts.chain}` : ''}`);
  console.log(`Interval: ${opts.interval}s | Alerts: pump>${opts.alert_pump ?? 'off'}% dump>${opts.alert_dump ?? 'off'}% liq<${opts.alert_liquidity ? '$' + opts.alert_liquidity : 'off'}`);
  console.log();

  let prev_price = null;
  let prev_liq = null;
  let check_count = 0;

  async function check() {
    check_count++;
    try {
      const pair = await fetch_pair(opts.token, opts.chain);
      if (!pair) {
        console.log(`[${new Date().toISOString().slice(11, 19)}] No pair found`);
        return;
      }

      const price = parseFloat(pair.priceUsd || 0);
      const liq = pair.liquidity?.usd || 0;
      const sym = `${pair.baseToken?.symbol}/${pair.quoteToken?.symbol}`;
      const chain = pair.chainId?.toUpperCase();
      const change_h24 = pair.priceChange?.h24 || 0;
      const vol_h24 = pair.volume?.h24 || 0;

      const ts = new Date().toISOString().slice(11, 19);
      console.log(`${ts} [#${check_count}] ${sym} ${chain} | ${fmt_price(pair.priceUsd)} | Liq: ${fmt_usd(liq)} | Vol 24h: ${fmt_usd(vol_h24)} | 24h: ${change_h24 > 0 ? '+' : ''}${change_h24.toFixed(1)}%`);

      const fired_alerts = [];

      if (prev_price !== null && opts.alert_pump) {
        const chg = pct_change(prev_price, price);
        if (chg >= opts.alert_pump) {
          const msg = `PUMP ALERT: ${sym} +${chg.toFixed(1)}% (${fmt_price(prev_price)} -> ${fmt_price(price)})`;
          alert('CRITICAL', msg);
          fired_alerts.push({ type: 'pump', pct: chg, from: prev_price, to: price });
        }
      }

      if (prev_price !== null && opts.alert_dump) {
        const chg = pct_change(prev_price, price);
        if (chg <= -opts.alert_dump) {
          const msg = `DUMP ALERT: ${sym} ${chg.toFixed(1)}% (${fmt_price(prev_price)} -> ${fmt_price(price)})`;
          alert('CRITICAL', msg);
          fired_alerts.push({ type: 'dump', pct: chg, from: prev_price, to: price });
        }
      }

      if (opts.alert_liquidity && liq < opts.alert_liquidity) {
        const msg = `LOW LIQUIDITY: ${sym} ${fmt_usd(liq)} (threshold: ${fmt_usd(opts.alert_liquidity)})`;
        alert('WARN', msg);
        fired_alerts.push({ type: 'liquidity', current: liq, threshold: opts.alert_liquidity });
      }

      if (opts.json_alerts && fired_alerts.length > 0) {
        const payload = {
          ts: new Date().toISOString(),
          token: opts.token,
          pair: pair.pairAddress,
          chain: pair.chainId,
          symbol: sym,
          price_usd: price,
          liquidity_usd: liq,
          alerts: fired_alerts,
        };
        process.stdout.write('\nALERT_JSON:' + JSON.stringify(payload) + '\n');
      }

      prev_price = price;
      prev_liq = liq;

    } catch (err) {
      console.error(`[${new Date().toISOString().slice(11, 19)}] Error: ${err.message}`);
    }
  }

  await check();
  setInterval(check, opts.interval * 1000);
}

main().catch(e => { console.error(e.message); process.exit(1); });
