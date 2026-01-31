#!/usr/bin/env node

/**
 * Bankr Wallet Exporter
 *
 * Convenience wrapper around bankr-leaderboard.mjs for wallet exports.
 *
 * Usage:
 *   node export-wallets.mjs --count 200 --out ./bankr-top200.csv
 *   node export-wallets.mjs --count 50 --format json --out ./bankr-top50.json
 *   node export-wallets.mjs --count 100 --timeframe 24h --type pnl
 */

const API_BASE = 'https://api.bankr.bot/leaderboard';
const PAGE_SIZE = 20;
const RATE_LIMIT_MS = 80;

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

function log(msg) { process.stderr.write(`${msg}\n`); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function apiFetch(path) {
  const url = `${API_BASE}${path}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`API ${res.status}: ${url}`);
  return res.json();
}

function progressBar(current, total, width = 30) {
  const pct = Math.round((current / total) * 100);
  const filled = Math.round((current / total) * width);
  const bar = '█'.repeat(filled) + '░'.repeat(width - filled);
  return `[${bar}] ${pct}% (${current}/${total})`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const count = parseInt(args.count || '100', 10);
  const timeframe = args.timeframe || 'total';
  const type = args.type || 'total';
  const format = args.format || 'csv';
  const outPath = args.out;

  if (!outPath && format === 'csv') {
    log('Tip: Use --out <file> to save to disk. Printing to stdout.\n');
  }

  // Step 1: Fetch rankings
  log(`📊 Fetching top ${count} rankings (timeframe=${timeframe}, type=${type})...`);

  const rankings = [];
  let cursor = 0;

  while (rankings.length < count) {
    const resp = await apiFetch(`/rankings?timeframe=${timeframe}&limit=${PAGE_SIZE}&type=${type}&cursor=${cursor}`);
    const data = resp.data || resp;

    if (!Array.isArray(data) || data.length === 0) break;
    rankings.push(...data);
    cursor += PAGE_SIZE;

    log(`  ${progressBar(Math.min(rankings.length, count), count)}`);
    if (data.length < PAGE_SIZE) break;
    await sleep(RATE_LIMIT_MS);
  }

  const total = Math.min(rankings.length, count);
  log(`\n🔍 Resolving wallets for ${total} users...\n`);

  // Step 2: Resolve wallets
  const seen = new Set();
  const results = [];

  for (let i = 0; i < total; i++) {
    const r = rankings[i];

    if (seen.has(r.accountId)) continue;
    seen.add(r.accountId);

    try {
      const profile = await apiFetch(`/users/${r.accountId}/profile`);
      results.push({
        rank: r.rank,
        username: r.username || profile.username || '',
        wallet_address: profile.walletAddress || '',
        account_id: r.accountId,
      });
    } catch {
      results.push({
        rank: r.rank,
        username: r.username || '',
        wallet_address: '',
        account_id: r.accountId,
      });
    }

    if ((i + 1) % 5 === 0 || i === total - 1) {
      log(`  ${progressBar(i + 1, total)}`);
    }
    await sleep(RATE_LIMIT_MS);
  }

  const withWallet = results.filter(r => r.wallet_address);
  log(`\n✅ Done! ${withWallet.length}/${results.length} wallets resolved.\n`);

  // Step 3: Output
  let output;

  if (format === 'json') {
    output = JSON.stringify(results, null, 2);
  } else {
    const header = 'rank,username,wallet_address,account_id';
    const rows = results.map(r =>
      `${r.rank},${r.username},${r.wallet_address},${r.account_id}`
    );
    output = [header, ...rows].join('\n');
  }

  if (outPath) {
    const fs = await import('node:fs');
    fs.writeFileSync(outPath, output + '\n');
    log(`💾 Saved to ${outPath}`);
  } else {
    process.stdout.write(output + '\n');
  }
}

main().catch(err => {
  log(`❌ Error: ${err.message}`);
  process.exit(1);
});
