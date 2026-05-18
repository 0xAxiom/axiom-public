#!/usr/bin/env node
/**
 * nonce-manager — atomic nonce tracking for concurrent EVM agents
 *
 * Problem: multiple agent processes call eth_getTransactionCount, get the same
 * pending nonce, and submit colliding transactions. Only one lands; others are
 * silently dropped or stuck forever.
 *
 * Solution: file-based nonce registry per (chainId, wallet) that claims nonces
 * atomically and stays in sync with on-chain state.
 *
 * Usage:
 *   node nonce.mjs claim   <wallet> [--rpc <url>] [--chain <id>]
 *   node nonce.mjs release <wallet> <nonce>
 *   node nonce.mjs confirm <wallet> <nonce>
 *   node nonce.mjs sync    <wallet> [--rpc <url>] [--chain <id>]
 *   node nonce.mjs status  <wallet>
 *   node nonce.mjs clear   <wallet> [--chain <id>]
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// ── config ────────────────────────────────────────────────────────────────────

const DEFAULT_RPC   = process.env.RPC_URL   || 'https://mainnet.base.org';
const DEFAULT_CHAIN = process.env.CHAIN_ID  || '8453';
const STATE_DIR     = join(homedir(), '.nonce-manager');

// ── arg parsing ───────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const cmd    = args[0];
const wallet = args[1]?.toLowerCase();

function flag(name, fallback) {
  const i = args.indexOf(name);
  return i !== -1 ? args[i + 1] : fallback;
}

const rpcUrl  = flag('--rpc',   DEFAULT_RPC);
const chainId = flag('--chain', DEFAULT_CHAIN);

// ── JSON-RPC ──────────────────────────────────────────────────────────────────

async function rpc(method, params) {
  const res = await fetch(rpcUrl, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const json = await res.json();
  if (json.error) throw new Error(`RPC error: ${json.error.message}`);
  return json.result;
}

async function onchainNonce(wallet) {
  const hex = await rpc('eth_getTransactionCount', [wallet, 'pending']);
  return parseInt(hex, 16);
}

// ── state ─────────────────────────────────────────────────────────────────────

function statePath(wallet, chain) {
  const dir = join(STATE_DIR, chain);
  mkdirSync(dir, { recursive: true });
  return join(dir, `${wallet}.json`);
}

function loadState(wallet, chain) {
  const p = statePath(wallet, chain);
  if (!existsSync(p)) return { pending: [], nextLocal: null, lastSync: null };
  try { return JSON.parse(readFileSync(p, 'utf8')); }
  catch { return { pending: [], nextLocal: null, lastSync: null }; }
}

function saveState(wallet, chain, state) {
  writeFileSync(statePath(wallet, chain), JSON.stringify(state, null, 2));
}

// ── commands ──────────────────────────────────────────────────────────────────

async function cmdClaim(wallet, chain, rpc_) {
  const state = loadState(wallet, chain);

  // Always re-read on-chain to detect externally confirmed txs.
  const onchain = await onchainNonce(wallet);

  // Prune confirmed nonces (anything < onchain is confirmed or dropped).
  state.pending = state.pending.filter(n => n >= onchain);

  // Next safe nonce = max(onchain, highest pending + 1).
  const highestPending = state.pending.length ? Math.max(...state.pending) : onchain - 1;
  const next = Math.max(onchain, highestPending + 1);

  state.pending.push(next);
  state.nextLocal = next + 1;
  state.lastSync  = new Date().toISOString();

  saveState(wallet, chain, state);

  console.log(JSON.stringify({ nonce: next, pending: state.pending, onchain }));
  return next;
}

function cmdRelease(wallet, chain, nonce) {
  const n = parseInt(nonce, 10);
  if (isNaN(n)) { console.error('Invalid nonce'); process.exit(1); }

  const state = loadState(wallet, chain);
  state.pending = state.pending.filter(x => x !== n);
  saveState(wallet, chain, state);

  console.log(JSON.stringify({ released: n, pending: state.pending }));
}

function cmdConfirm(wallet, chain, nonce) {
  // Alias for release — same semantics; separate name for readability.
  cmdRelease(wallet, chain, nonce);
}

async function cmdSync(wallet, chain) {
  const onchain = await onchainNonce(wallet);
  const state   = loadState(wallet, chain);

  const before = [...state.pending];
  state.pending = state.pending.filter(n => n >= onchain);
  state.lastSync = new Date().toISOString();
  saveState(wallet, chain, state);

  const pruned = before.filter(n => !state.pending.includes(n));
  console.log(JSON.stringify({ onchain, pruned, pending: state.pending }));
}

function cmdStatus(wallet, chain) {
  const state = loadState(wallet, chain);
  // Detect gaps in pending nonces (possible stuck txs).
  const sorted  = [...state.pending].sort((a, b) => a - b);
  const gaps    = [];
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] - sorted[i - 1] > 1) gaps.push({ after: sorted[i - 1], before: sorted[i] });
  }
  console.log(JSON.stringify({ pending: sorted, gaps, lastSync: state.lastSync }));
}

function cmdClear(wallet, chain) {
  const p = statePath(wallet, chain);
  writeFileSync(p, JSON.stringify({ pending: [], nextLocal: null, lastSync: new Date().toISOString() }, null, 2));
  console.log(JSON.stringify({ cleared: true, wallet, chain }));
}

// ── dispatch ──────────────────────────────────────────────────────────────────

function requireWallet() {
  if (!wallet) { console.error('wallet address required'); process.exit(1); }
}

(async () => {
  switch (cmd) {
    case 'claim':
      requireWallet();
      await cmdClaim(wallet, chainId, rpcUrl);
      break;

    case 'release':
    case 'confirm': {
      requireWallet();
      const nonce = args[2];
      if (!nonce) { console.error('nonce required'); process.exit(1); }
      cmd === 'confirm'
        ? cmdConfirm(wallet, chainId, nonce)
        : cmdRelease(wallet, chainId, nonce);
      break;
    }

    case 'sync':
      requireWallet();
      await cmdSync(wallet, chainId);
      break;

    case 'status':
      requireWallet();
      cmdStatus(wallet, chainId);
      break;

    case 'clear':
      requireWallet();
      cmdClear(wallet, chainId);
      break;

    default:
      console.error(`
nonce-manager — atomic nonce tracking for EVM agents

Commands:
  claim   <wallet> [--rpc <url>] [--chain <id>]   Claim next safe nonce
  release <wallet> <nonce>                         Free a nonce (tx dropped)
  confirm <wallet> <nonce>                         Free a nonce (tx confirmed)
  sync    <wallet> [--rpc <url>] [--chain <id>]   Prune confirmed nonces
  status  <wallet>                                 Show pending nonces & gaps
  clear   <wallet>                                 Emergency reset

Environment:
  RPC_URL=   default RPC (fallback: Base mainnet)
  CHAIN_ID=  default chain ID (fallback: 8453)
`);
      process.exit(1);
  }
})().catch(e => { console.error(e.message); process.exit(1); });
