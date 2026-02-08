#!/usr/bin/env node

/**
 * Bankr Leaderboard CLI
 *
 * Usage:
 *   node bankr-leaderboard.mjs --action rankings
 *   node bankr-leaderboard.mjs --action rankings --count 50 --timeframe 24h --type pnl
 *   node bankr-leaderboard.mjs --action profile --user 1204220275543433217
 *   node bankr-leaderboard.mjs --action profile --user @thatdudeboz
 *   node bankr-leaderboard.mjs --action wallets --count 200 --output csv --out-file ./wallets.csv
 *   node bankr-leaderboard.mjs --action scores --user 1204220275543433217 --timeframe 24h
 *   node bankr-leaderboard.mjs --action treemap --timeframe 24h --count 10
 */

const API_BASE = 'https://api.bankr.bot/leaderboard';
const PAGE_SIZE = 20;
const RATE_LIMIT_MS = 80;

// --- Arg parsing ---

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

const args = parseArgs(process.argv.slice(2));
const action = args.action;
const count = parseInt(args.count || '100', 10);
const timeframe = args.timeframe || 'total';
const type = args.type || 'total';
const output = args.output || 'json';
const outFile = args['out-file'];
const user = args.user;

// --- Helpers ---

function log(msg) {
  process.stderr.write(`${msg}\n`);
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function apiFetch(path) {
  const url = `${API_BASE}${path}`;
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`API ${res.status}: ${res.statusText} — ${url}\n${text}`);
  }
  return res.json();
}

// --- API calls ---

async function fetchRankings(timeframe, type, limit, cursor = 0) {
  return apiFetch(`/rankings?timeframe=${timeframe}&limit=${limit}&type=${type}&cursor=${cursor}`);
}

async function fetchProfile(accountId) {
  return apiFetch(`/users/${accountId}/profile`);
}

async function fetchScores(accountId, timeframe) {
  return apiFetch(`/users/${accountId}/scores?timeframe=${timeframe}`);
}

async function fetchTreeMap(timeframe, limit) {
  return apiFetch(`/tree-map?timeframe=${timeframe}&limit=${limit}`);
}

// --- Paginated fetch ---

async function fetchAllRankings(timeframe, type, total) {
  const results = [];
  let cursor = 0;

  while (results.length < total) {
    log(`Fetching rankings cursor=${cursor} (have ${results.length}/${total})...`);

    const resp = await fetchRankings(timeframe, type, PAGE_SIZE, cursor);
    const data = resp.data || resp;

    if (!Array.isArray(data) || data.length === 0) break;

    results.push(...data);
    cursor += PAGE_SIZE;

    if (data.length < PAGE_SIZE) break;
    await sleep(RATE_LIMIT_MS);
  }

  return results.slice(0, total);
}

// --- Resolve username to accountId ---

async function resolveUser(userArg) {
  // If it starts with @, we need to search rankings for the username
  if (userArg.startsWith('@')) {
    const username = userArg.slice(1).toLowerCase();
    log(`Searching for username "${username}" in rankings...`);

    let cursor = 0;
    const maxPages = 50; // search up to 1000 users

    for (let page = 0; page < maxPages; page++) {
      const resp = await fetchRankings('total', 'total', PAGE_SIZE, cursor);
      const data = resp.data || resp;

      if (!Array.isArray(data) || data.length === 0) break;

      const match = data.find(u => u.username?.toLowerCase() === username);
      if (match) return match.accountId;

      cursor += PAGE_SIZE;
      await sleep(RATE_LIMIT_MS);
    }

    throw new Error(`Username "@${username}" not found in top 1000 rankings`);
  }

  // Otherwise treat as accountId directly
  return userArg;
}

// --- Wallet export ---

async function fetchWallets(rankings) {
  const seen = new Set();
  const results = [];

  for (let i = 0; i < rankings.length; i++) {
    const r = rankings[i];

    if (seen.has(r.accountId)) {
      log(`  [${i + 1}/${rankings.length}] SKIP duplicate ${r.username}`);
      continue;
    }
    seen.add(r.accountId);

    log(`  [${i + 1}/${rankings.length}] Fetching wallet for ${r.username || r.accountId}...`);

    try {
      const profile = await fetchProfile(r.accountId);
      results.push({
        rank: r.rank,
        username: r.username || profile.username || '',
        wallet_address: profile.walletAddress || '',
        account_id: r.accountId,
        total_score: r.totalScore || 0,
      });
    } catch (err) {
      log(`  ⚠ Failed for ${r.accountId}: ${err.message}`);
      results.push({
        rank: r.rank,
        username: r.username || '',
        wallet_address: '',
        account_id: r.accountId,
        total_score: r.totalScore || 0,
      });
    }

    await sleep(RATE_LIMIT_MS);
  }

  return results;
}

// --- Formatters ---

function formatRankingsTable(rankings) {
  const lines = ['rank | username | score | accountId'];
  lines.push('-----|----------|-------|----------');
  for (const r of rankings) {
    lines.push(`${String(r.rank).padStart(4)} | ${(r.username || '').padEnd(20)} | ${r.totalScore?.toFixed(6) || 'N/A'} | ${r.accountId}`);
  }
  return lines.join('\n');
}

function formatCsv(rows, columns) {
  const header = columns.join(',');
  const body = rows.map(r => columns.map(c => {
    const val = r[c] ?? '';
    return String(val).includes(',') ? `"${val}"` : val;
  }).join(','));
  return [header, ...body].join('\n');
}

async function writeOutput(data) {
  const text = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  if (outFile) {
    const fs = await import('node:fs');
    fs.writeFileSync(outFile, text + '\n');
    log(`Wrote to ${outFile}`);
  } else {
    process.stdout.write(text + '\n');
  }
}

// --- Main ---

async function main() {
  if (!action) {
    log(`Usage: node bankr-leaderboard.mjs --action <rankings|profile|wallets|scores|treemap> [options]

Actions:
  rankings   Fetch leaderboard rankings
  profile    Fetch a user's profile (--user <accountId or @username>)
  wallets    Export wallet addresses for top users
  scores     Fetch detailed score breakdown (--user <accountId or @username>)
  treemap    Fetch tree-map data for top traders

Options:
  --count <n>        Number of users to fetch (default: 100)
  --timeframe <t>    24h | 7d | 30d | total (default: total)
  --type <t>         total | staking | bnkr | earn | pnl | referral | nft | booster (default: total)
  --output <fmt>     json | csv (default: json)
  --out-file <path>  Save output to file instead of stdout
  --user <id|@name>  User account ID or @username`);
    process.exit(1);
  }

  switch (action) {
    case 'rankings': {
      const rankings = await fetchAllRankings(timeframe, type, count);
      log(`Fetched ${rankings.length} rankings`);

      if (output === 'csv') {
        const csv = formatCsv(rankings.map(r => ({
          rank: r.rank,
          username: r.username,
          total_score: r.totalScore,
          account_id: r.accountId,
          platform: r.platform,
        })), ['rank', 'username', 'total_score', 'account_id', 'platform']);
        await writeOutput(csv);
      } else {
        await writeOutput(rankings);
      }
      break;
    }

    case 'profile': {
      if (!user) {
        log('Error: --user required for profile action');
        process.exit(1);
      }
      const accountId = await resolveUser(user);
      const profile = await fetchProfile(accountId);
      await writeOutput(profile);
      break;
    }

    case 'scores': {
      if (!user) {
        log('Error: --user required for scores action');
        process.exit(1);
      }
      const accountId = await resolveUser(user);
      const scores = await fetchScores(accountId, timeframe);
      await writeOutput(scores);
      break;
    }

    case 'wallets': {
      const rankings = await fetchAllRankings(timeframe, type, count);
      log(`Fetched ${rankings.length} rankings, now resolving wallets...`);

      const wallets = await fetchWallets(rankings);
      const unique = wallets.filter(w => w.wallet_address);
      log(`Resolved ${unique.length} wallets (${wallets.length - unique.length} missing)`);

      if (output === 'csv') {
        const csv = formatCsv(wallets, ['rank', 'username', 'wallet_address', 'account_id', 'total_score']);
        await writeOutput(csv);
      } else {
        await writeOutput(wallets);
      }
      break;
    }

    case 'treemap': {
      const data = await fetchTreeMap(timeframe, count);
      await writeOutput(data);
      break;
    }

    default:
      log(`Unknown action: ${action}`);
      process.exit(1);
  }
}

main().catch(err => {
  log(`Error: ${err.message}`);
  process.exit(1);
});
