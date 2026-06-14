#!/usr/bin/env node
/**
 * block-time-analyzer — Measure actual block production timing on any EVM chain.
 *
 * Usage:
 *   node analyze.mjs                     — analyze last 100 blocks on Base
 *   node analyze.mjs --blocks 500        — analyze last 500 blocks
 *   node analyze.mjs --rpc <url>         — use a custom RPC endpoint
 *   node analyze.mjs --target 2          — set expected block time (seconds)
 *   node analyze.mjs --percentiles       — show detailed percentile breakdown
 *   node analyze.mjs --json              — output as JSON
 *
 * Detects congestion, empty-block runs, and timing anomalies.
 * Zero dependencies. Uses public RPC directly.
 */

const DEFAULT_RPC = "https://mainnet.base.org";
const DEFAULT_BLOCKS = 100;
const DEFAULT_TARGET = 2; // Base targets 2s blocks

// --- CLI parsing ---

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { rpc: DEFAULT_RPC, blocks: DEFAULT_BLOCKS, target: DEFAULT_TARGET, percentiles: false, json: false };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--rpc":       opts.rpc = args[++i]; break;
      case "--blocks":    opts.blocks = parseInt(args[++i], 10); break;
      case "--target":    opts.target = parseFloat(args[++i]); break;
      case "--percentiles": opts.percentiles = true; break;
      case "--json":      opts.json = true; break;
      case "--help": case "-h":
        console.log(`block-time-analyzer — Measure block production timing on any EVM chain.

Usage:
  node analyze.mjs                     Analyze last 100 blocks on Base
  node analyze.mjs --blocks 500        Analyze last 500 blocks
  node analyze.mjs --rpc <url>         Use a custom RPC endpoint
  node analyze.mjs --target 2          Set expected block time in seconds
  node analyze.mjs --percentiles       Show detailed percentile breakdown
  node analyze.mjs --json              Output as JSON`);
        process.exit(0);
    }
  }
  return opts;
}

// --- RPC helpers ---

async function rpc(url, method, params = []) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const json = await res.json();
  if (json.error) throw new Error(`RPC error: ${json.error.message}`);
  return json.result;
}

async function getBlockNumber(url) {
  const hex = await rpc(url, "eth_blockNumber");
  return parseInt(hex, 16);
}

async function getBlock(url, num) {
  const hex = "0x" + num.toString(16);
  const block = await rpc(url, "eth_getBlockByNumber", [hex, false]);
  return {
    number: parseInt(block.number, 16),
    timestamp: parseInt(block.timestamp, 16),
    gasUsed: parseInt(block.gasUsed, 16),
    gasLimit: parseInt(block.gasLimit, 16),
    txCount: block.transactions.length,
    hash: block.hash,
  };
}

// --- Fetch blocks in batches ---

async function fetchBlocks(url, start, count) {
  const blocks = [];
  const BATCH = 20;

  for (let i = 0; i < count; i += BATCH) {
    const batch = [];
    const end = Math.min(i + BATCH, count);
    for (let j = i; j < end; j++) {
      batch.push(getBlock(url, start - count + 1 + j));
    }
    const results = await Promise.all(batch);
    blocks.push(...results);

    if (!process.stdout.isTTY) continue;
    const pct = Math.round(((i + end - i) / count) * 100);
    process.stderr.write(`\r  Fetching blocks... ${blocks.length}/${count} (${pct}%)`);
  }
  if (process.stdout.isTTY) process.stderr.write("\r" + " ".repeat(60) + "\r");

  return blocks.sort((a, b) => a.number - b.number);
}

// --- Analysis ---

function analyzeBlockTimes(blocks, targetSec) {
  const intervals = [];
  for (let i = 1; i < blocks.length; i++) {
    intervals.push(blocks[i].timestamp - blocks[i - 1].timestamp);
  }

  intervals.sort((a, b) => a - b);
  const n = intervals.length;

  const sum = intervals.reduce((a, b) => a + b, 0);
  const mean = sum / n;
  const variance = intervals.reduce((a, v) => a + (v - mean) ** 2, 0) / n;
  const stddev = Math.sqrt(variance);

  const percentile = (p) => {
    const idx = Math.ceil((p / 100) * n) - 1;
    return intervals[Math.max(0, idx)];
  };

  // Count anomalies
  const fastBlocks = intervals.filter((t) => t === 0).length;
  const slowBlocks = intervals.filter((t) => t > targetSec * 3).length;
  const onTarget = intervals.filter((t) => t === targetSec).length;

  // Find longest gap
  let maxGap = 0;
  let maxGapAt = 0;
  for (let i = 1; i < blocks.length; i++) {
    const gap = blocks[i].timestamp - blocks[i - 1].timestamp;
    if (gap > maxGap) {
      maxGap = gap;
      maxGapAt = blocks[i].number;
    }
  }

  // Gas utilization
  const gasUtils = blocks.map((b) => (b.gasLimit > 0 ? b.gasUsed / b.gasLimit : 0));
  const avgGasUtil = gasUtils.reduce((a, b) => a + b, 0) / gasUtils.length;
  const emptyBlocks = blocks.filter((b) => b.txCount === 0).length;

  // Consecutive empty block runs
  let maxEmptyRun = 0;
  let currentRun = 0;
  for (const b of blocks) {
    if (b.txCount === 0) {
      currentRun++;
      maxEmptyRun = Math.max(maxEmptyRun, currentRun);
    } else {
      currentRun = 0;
    }
  }

  // Total tx count
  const totalTxs = blocks.reduce((a, b) => a + b.txCount, 0);

  return {
    blockRange: { from: blocks[0].number, to: blocks[blocks.length - 1].number },
    blockCount: blocks.length,
    intervalCount: n,
    timespan: blocks[blocks.length - 1].timestamp - blocks[0].timestamp,
    timing: {
      mean: mean,
      median: percentile(50),
      stddev: stddev,
      min: intervals[0],
      max: intervals[n - 1],
      p5: percentile(5),
      p25: percentile(25),
      p75: percentile(75),
      p95: percentile(95),
      p99: percentile(99),
    },
    target: {
      expectedSec: targetSec,
      onTarget: onTarget,
      onTargetPct: ((onTarget / n) * 100).toFixed(1),
      drift: mean - targetSec,
    },
    anomalies: {
      fastBlocks: fastBlocks,
      fastBlocksPct: ((fastBlocks / n) * 100).toFixed(1),
      slowBlocks: slowBlocks,
      slowBlocksPct: ((slowBlocks / n) * 100).toFixed(1),
      longestGap: maxGap,
      longestGapBlock: maxGapAt,
    },
    throughput: {
      totalTransactions: totalTxs,
      avgTxPerBlock: (totalTxs / blocks.length).toFixed(1),
      avgGasUtilization: (avgGasUtil * 100).toFixed(1) + "%",
      emptyBlocks: emptyBlocks,
      emptyBlocksPct: ((emptyBlocks / blocks.length) * 100).toFixed(1),
      maxEmptyRun: maxEmptyRun,
    },
    histogram: buildHistogram(intervals),
  };
}

function buildHistogram(intervals) {
  const buckets = {};
  for (const t of intervals) {
    const key = t <= 5 ? `${t}s` : t <= 10 ? "6-10s" : t <= 30 ? "11-30s" : ">30s";
    buckets[key] = (buckets[key] || 0) + 1;
  }
  return buckets;
}

// --- Output ---

function printReport(analysis, showPercentiles) {
  const { blockRange, timing, target, anomalies, throughput, histogram, timespan } = analysis;

  console.log(`\n  Block Time Analysis`);
  console.log(`  ${"─".repeat(50)}`);
  console.log(`  Range:     #${blockRange.from.toLocaleString()} → #${blockRange.to.toLocaleString()}`);
  console.log(`  Span:      ${formatDuration(timespan)}`);
  console.log(`  Blocks:    ${analysis.blockCount.toLocaleString()}`);

  console.log(`\n  Timing`);
  console.log(`  ${"─".repeat(50)}`);
  console.log(`  Mean:      ${timing.mean.toFixed(3)}s`);
  console.log(`  Median:    ${timing.median}s`);
  console.log(`  Std dev:   ${timing.stddev.toFixed(3)}s`);
  console.log(`  Min / Max: ${timing.min}s / ${timing.max}s`);

  if (showPercentiles) {
    console.log(`\n  Percentiles`);
    console.log(`  ${"─".repeat(50)}`);
    console.log(`  p5:        ${timing.p5}s`);
    console.log(`  p25:       ${timing.p25}s`);
    console.log(`  p50:       ${timing.median}s`);
    console.log(`  p75:       ${timing.p75}s`);
    console.log(`  p95:       ${timing.p95}s`);
    console.log(`  p99:       ${timing.p99}s`);
  }

  console.log(`\n  Target: ${target.expectedSec}s`);
  console.log(`  ${"─".repeat(50)}`);
  console.log(`  On target: ${target.onTarget} (${target.onTargetPct}%)`);
  console.log(`  Drift:     ${target.drift > 0 ? "+" : ""}${target.drift.toFixed(3)}s`);

  // Health indicator
  const health = Math.abs(target.drift) < 0.1 && anomalies.slowBlocks === 0 ? "HEALTHY"
    : Math.abs(target.drift) < 0.5 && parseFloat(anomalies.slowBlocksPct) < 5 ? "OK"
    : "DEGRADED";
  console.log(`  Health:    ${health}`);

  console.log(`\n  Anomalies`);
  console.log(`  ${"─".repeat(50)}`);
  console.log(`  Instant (0s): ${anomalies.fastBlocks} (${anomalies.fastBlocksPct}%)`);
  console.log(`  Slow (>3x):   ${anomalies.slowBlocks} (${anomalies.slowBlocksPct}%)`);
  if (anomalies.longestGap > 0) {
    console.log(`  Longest gap:  ${anomalies.longestGap}s at block #${anomalies.longestGapBlock.toLocaleString()}`);
  }

  console.log(`\n  Throughput`);
  console.log(`  ${"─".repeat(50)}`);
  console.log(`  Total txs:     ${throughput.totalTransactions.toLocaleString()}`);
  console.log(`  Avg tx/block:  ${throughput.avgTxPerBlock}`);
  console.log(`  Gas util:      ${throughput.avgGasUtilization}`);
  console.log(`  Empty blocks:  ${throughput.emptyBlocks} (${throughput.emptyBlocksPct}%)`);
  if (throughput.maxEmptyRun > 0) {
    console.log(`  Max empty run: ${throughput.maxEmptyRun} consecutive`);
  }

  console.log(`\n  Distribution`);
  console.log(`  ${"─".repeat(50)}`);
  const maxCount = Math.max(...Object.values(histogram));
  const barWidth = 30;
  for (const [bucket, count] of Object.entries(histogram)) {
    const bar = "█".repeat(Math.round((count / maxCount) * barWidth));
    console.log(`  ${bucket.padEnd(8)} ${bar} ${count}`);
  }
  console.log();
}

function formatDuration(seconds) {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

// --- Main ---

async function main() {
  const opts = parseArgs();

  if (!opts.json) {
    process.stderr.write(`  Fetching ${opts.blocks} blocks from ${opts.rpc}...\n`);
  }

  const latest = await getBlockNumber(opts.rpc);
  const blocks = await fetchBlocks(opts.rpc, latest, opts.blocks);
  const analysis = analyzeBlockTimes(blocks, opts.target);

  if (opts.json) {
    console.log(JSON.stringify(analysis, null, 2));
  } else {
    printReport(analysis, opts.percentiles);
  }
}

main().catch((err) => {
  console.error(`  Error: ${err.message}`);
  process.exit(1);
});
