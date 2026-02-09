#!/usr/bin/env node

/**
 * Social Inbox — Aggregate, score, and prioritize X/Twitter mentions.
 * 
 * Usage:
 *   node social-inbox.mjs                    # Full scan
 *   node social-inbox.mjs --mentions-only    # Skip brand search
 *   node social-inbox.mjs --json             # JSON output only
 *   node social-inbox.mjs --search "term1,term2"  # Custom search
 *   node social-inbox.mjs --limit 20         # Max items per source
 */

import { execSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const TWITTER_API = join(homedir(), 'Github/axiom-public/agent-skills/scripts/twitter-api.py');
const DEDUP_PATH = join(homedir(), 'clawd/data/twitter-replied.json');
const INBOX_PATH = join(homedir(), 'clawd/data/social-inbox.json');
const OUR_HANDLE = 'AxiomBot';

const DEFAULT_SEARCHES = [
  'AxiomBot',
  '"axiom ventures"',
  '"axiom fund"',
  '@AxiomBot -from:AxiomBot',
];

// --- CLI Args ---
const args = process.argv.slice(2);
const mentionsOnly = args.includes('--mentions-only');
const jsonOnly = args.includes('--json');
const limitIdx = args.indexOf('--limit');
const limit = limitIdx !== -1 ? parseInt(args[limitIdx + 1]) || 15 : 15;
const searchIdx = args.indexOf('--search');
const customSearches = searchIdx !== -1 ? args[searchIdx + 1].split(',') : null;

// --- Helpers ---
function runTwitterApi(command) {
  try {
    const out = execSync(`python3 ${TWITTER_API} ${command}`, {
      encoding: 'utf8',
      timeout: 30000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return out.trim();
  } catch (e) {
    console.error(`[social-inbox] API error for "${command}": ${e.message}`);
    return '';
  }
}

function parseTweets(raw) {
  if (!raw) return [];
  const tweets = [];
  const lines = raw.split('\n');
  let current = null;

  for (const line of lines) {
    // Line format: @handle [id] timestamp
    const headerMatch = line.match(/^@(\S+)\s+\[(\d+)\]\s+(\S+)/);
    if (headerMatch) {
      if (current) tweets.push(current);
      current = {
        author: headerMatch[1],
        id: headerMatch[2],
        timestamp: headerMatch[3],
        text: '',
        url: '',
      };
      continue;
    }

    if (!current) continue;

    // URL line
    const urlMatch = line.match(/^\s+(https:\/\/x\.com\/\S+)/);
    if (urlMatch) {
      current.url = urlMatch[1];
      continue;
    }

    // Text line
    const textMatch = line.match(/^\s+(.+)/);
    if (textMatch && !current.url) {
      current.text += (current.text ? ' ' : '') + textMatch[1].trim();
    }
  }
  if (current) tweets.push(current);
  return tweets;
}

function loadDedup() {
  try {
    if (existsSync(DEDUP_PATH)) {
      return JSON.parse(readFileSync(DEDUP_PATH, 'utf8'));
    }
  } catch {}
  return {};
}

function scoreTweet(tweet) {
  const breakdown = {};
  let score = 0;
  const text = tweet.text.toLowerCase();

  // Direct mention
  if (text.includes('@axiombot') || tweet.source === 'mentions') {
    breakdown.directMention = 2;
    score += 2;
  }

  // Question
  if (text.includes('?')) {
    breakdown.question = 2;
    score += 2;
  }

  // Keyword relevance
  const keywords = ['fund', 'invest', 'agent', 'build', 'lp', 'token', 'venture', 'apply', 'application'];
  let keywordScore = 0;
  const matched = [];
  for (const kw of keywords) {
    if (text.includes(kw)) {
      keywordScore++;
      matched.push(kw);
      if (keywordScore >= 3) break;
    }
  }
  if (keywordScore > 0) {
    breakdown.keywords = { score: keywordScore, matched };
    score += keywordScore;
  }

  // Recency
  const age = Date.now() - new Date(tweet.timestamp).getTime();
  const hours = age / (1000 * 60 * 60);
  if (hours < 1) {
    breakdown.recency = 2;
    score += 2;
  } else if (hours < 6) {
    breakdown.recency = 1.5;
    score += 1.5;
  } else if (hours < 24) {
    breakdown.recency = 1;
    score += 1;
  } else {
    breakdown.recency = 0;
  }

  // Spam detection (negative signal)
  const spamPatterns = [/airdrop/i, /free.*token/i, /dm me/i, /follow.*back/i, /🚀{3,}/];
  const isSpam = spamPatterns.some(p => p.test(tweet.text));
  if (isSpam) {
    breakdown.spam = -2;
    score -= 2;
  } else {
    breakdown.notSpam = 1;
    score += 1;
  }

  return { score: Math.max(0, Math.min(10, score)), breakdown };
}

// --- Main ---
async function main() {
  console.error('[social-inbox] Starting scan...');

  const dedup = loadDedup();
  const allTweets = new Map(); // id -> tweet

  // 1. Fetch mentions
  console.error('[social-inbox] Fetching mentions...');
  const mentionsRaw = runTwitterApi(`mentions ${limit}`);
  const mentions = parseTweets(mentionsRaw);
  for (const t of mentions) {
    t.source = 'mentions';
    allTweets.set(t.id, t);
  }
  console.error(`[social-inbox] Found ${mentions.length} mentions`);

  // 2. Fetch brand searches
  if (!mentionsOnly) {
    const searches = customSearches || DEFAULT_SEARCHES;
    for (const query of searches) {
      console.error(`[social-inbox] Searching: ${query}`);
      const raw = runTwitterApi(`search ${JSON.stringify(query)} ${Math.min(limit, 10)}`);
      const results = parseTweets(raw);
      for (const t of results) {
        if (!allTweets.has(t.id)) {
          t.source = 'search';
          allTweets.set(t.id, t);
        }
      }
      console.error(`[social-inbox] Found ${results.length} results`);
    }
  }

  // 3. Filter: remove own tweets, already-replied, duplicates
  const filtered = [];
  for (const tweet of allTweets.values()) {
    if (tweet.author === OUR_HANDLE) continue;
    if (dedup[tweet.id]) continue;
    filtered.push(tweet);
  }
  console.error(`[social-inbox] ${filtered.length} unique items after dedup`);

  // 4. Score
  const scored = filtered.map(tweet => {
    const { score, breakdown } = scoreTweet(tweet);
    return {
      id: tweet.id,
      author: `@${tweet.author}`,
      text: tweet.text,
      url: tweet.url || `https://x.com/${tweet.author}/status/${tweet.id}`,
      timestamp: tweet.timestamp,
      score,
      scoreBreakdown: breakdown,
      status: 'pending',
      source: tweet.source,
    };
  });

  // 5. Sort by score descending, filter out low-value
  scored.sort((a, b) => b.score - a.score);
  const inbox = scored.filter(item => item.score >= 3);

  // 6. Save
  const output = {
    lastScan: new Date().toISOString(),
    totalScanned: allTweets.size,
    afterDedup: filtered.length,
    itemCount: inbox.length,
    items: inbox,
  };

  writeFileSync(INBOX_PATH, JSON.stringify(output, null, 2));

  // 7. Output
  if (jsonOnly) {
    console.log(JSON.stringify(output, null, 2));
  } else {
    console.log(`\n📥 Social Inbox — ${new Date().toLocaleString()}`);
    console.log(`   Scanned: ${allTweets.size} | After dedup: ${filtered.length} | Actionable: ${inbox.length}\n`);

    if (inbox.length === 0) {
      console.log('   No high-priority items. Inbox clear. ✅');
    } else {
      for (const item of inbox.slice(0, 10)) {
        const scoreBar = '█'.repeat(Math.round(item.score)) + '░'.repeat(10 - Math.round(item.score));
        console.log(`   [${item.score.toFixed(1)}] ${scoreBar}  ${item.author}`);
        console.log(`   ${item.text.substring(0, 120)}${item.text.length > 120 ? '...' : ''}`);
        console.log(`   ${item.url}`);
        console.log(`   Source: ${item.source} | ${item.timestamp}`);
        console.log('');
      }
    }
  }

  return output;
}

main().catch(e => {
  console.error(`[social-inbox] Fatal: ${e.message}`);
  process.exit(1);
});
