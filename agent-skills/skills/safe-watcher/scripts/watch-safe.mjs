#!/usr/bin/env node
// watch-safe.mjs — polling watcher for Safe multisig proposals
// Emits alerts on new proposals and threshold crossings. Cron-friendly.
// Usage: node watch-safe.mjs <safe-address> [--chain base] [--interval 60] [--state ./safe-state.json] [--once]
// No dependencies. Pure Node.js.

import { readFileSync, writeFileSync, existsSync } from 'fs';

const SAFE_APIS = {
  mainnet: 'https://safe-transaction-mainnet.safe.global',
  base: 'https://safe-transaction-base.safe.global',
  arbitrum: 'https://safe-transaction-arbitrum.safe.global',
  optimism: 'https://safe-transaction-optimism.safe.global',
  polygon: 'https://safe-transaction-polygon.safe.global',
  sepolia: 'https://safe-transaction-sepolia.safe.global',
  'base-sepolia': 'https://safe-transaction-base-sepolia.safe.global',
};

const args = process.argv.slice(2);
const safeAddress = args.find(a => a.startsWith('0x'));
const chainIdx = args.indexOf('--chain');
const chain = chainIdx !== -1 ? args[chainIdx + 1] : 'mainnet';
const intervalIdx = args.indexOf('--interval');
const intervalMs = intervalIdx !== -1 ? parseInt(args[intervalIdx + 1]) * 1000 : 60_000;
const stateIdx = args.indexOf('--state');
const stateFile = stateIdx !== -1 ? args[stateIdx + 1] : './safe-watch-state.json';
const once = args.includes('--once');

if (!safeAddress) {
  console.error('Usage: node watch-safe.mjs <safe-address> [--chain mainnet|base|...] [--interval 60] [--state ./state.json] [--once]');
  process.exit(1);
}

const BASE_URL = SAFE_APIS[chain];
if (!BASE_URL) {
  console.error(`Unknown chain: ${chain}. Supported: ${Object.keys(SAFE_APIS).join(', ')}`);
  process.exit(1);
}

function loadState() {
  if (!existsSync(stateFile)) return { seen: {}, readyHashes: [] };
  try { return JSON.parse(readFileSync(stateFile, 'utf8')); }
  catch { return { seen: {}, readyHashes: [] }; }
}

function saveState(s) {
  writeFileSync(stateFile, JSON.stringify(s, null, 2));
}

async function fetchJSON(url) {
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function ts() { return new Date().toISOString(); }

async function poll() {
  const state = loadState();
  const readySet = new Set(state.readyHashes || []);

  const [safeInfo, pending] = await Promise.all([
    fetchJSON(`${BASE_URL}/api/v1/safes/${safeAddress}/`),
    fetchJSON(`${BASE_URL}/api/v1/safes/${safeAddress}/multisig-transactions/?executed=false&limit=20`),
  ]);

  const { threshold, owners, nonce } = safeInfo;
  const txs = (pending.results || []).filter(tx => !tx.isExecuted);

  const events = [];
  const newReadyHashes = [];

  for (const tx of txs) {
    const sigs = tx.confirmations?.length ?? 0;
    const ready = sigs >= threshold;
    const isNew = !(tx.safeTxHash in (state.seen || {}));
    const wasReady = readySet.has(tx.safeTxHash);

    const label = tx.dataDecoded?.method
      ? `${tx.dataDecoded.method}()`
      : BigInt(tx.value || '0') > 0n
      ? `send ${Number(BigInt(tx.value)) / 1e18} ETH`
      : 'raw tx';

    if (isNew) {
      events.push({ type: 'NEW_PROPOSAL', hash: tx.safeTxHash, nonce: tx.nonce, to: tx.to, sigs, threshold, label });
    }

    if (ready) {
      newReadyHashes.push(tx.safeTxHash);
      if (!wasReady) {
        events.push({ type: 'READY_TO_EXECUTE', hash: tx.safeTxHash, nonce: tx.nonce, to: tx.to, sigs, threshold, label });
      }
    }

    state.seen = state.seen || {};
    state.seen[tx.safeTxHash] = { nonce: tx.nonce, sigs, label };
  }

  state.readyHashes = newReadyHashes;
  state.lastCheck = ts();
  state.threshold = threshold;
  state.nonce = nonce;
  saveState(state);

  if (events.length === 0) {
    console.log(`[${ts()}] OK | safe=${safeAddress.slice(0, 10)}... | pending=${txs.length} | threshold=${threshold}/${owners.length} | nonce=${nonce}`);
    return;
  }

  let hasAlert = false;
  for (const e of events) {
    const level = e.type === 'READY_TO_EXECUTE' ? 'ALERT' : 'INFO';
    if (level === 'ALERT') hasAlert = true;
    console.log(`[${ts()}] ${level} | ${e.type} | nonce=${e.nonce} | ${e.label} | to=${e.to?.slice(0, 10)}... | sigs=${e.sigs}/${e.threshold} | hash=${e.hash.slice(0, 14)}...`);
  }

  if (hasAlert) process.exitCode = 2;
}

async function run() {
  if (once) {
    await poll();
    return;
  }

  console.log(`[${ts()}] Watching ${safeAddress} on ${chain} every ${intervalMs / 1000}s`);
  while (true) {
    try { await poll(); }
    catch (err) { console.error(`[${ts()}] ERROR: ${err.message}`); }
    await new Promise(r => setTimeout(r, intervalMs));
  }
}

run().catch(err => { console.error(err.message); process.exit(1); });
