#!/usr/bin/env node
// Resolve Basenames (.base.eth) ↔ addresses on Base. Zero deps.

const BASE_RPC = process.env.BASE_RPC_URL || 'https://mainnet.base.org';
const RESOLVER = '0xC6d566A56A1aFf6508b41f6c90ff131615583BCD';

async function rpc(method, params) {
  const res = await fetch(BASE_RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error.message);
  return json.result;
}

async function keccak256(hexData) {
  return rpc('web3_sha3', [hexData]);
}

async function namehash(name) {
  let node = '0x' + '00'.repeat(32);
  if (!name) return node;
  const labels = name.split('.');
  for (let i = labels.length - 1; i >= 0; i--) {
    const labelHex = '0x' + Buffer.from(labels[i], 'utf8').toString('hex');
    const labelHash = await keccak256(labelHex);
    node = await keccak256(node + labelHash.slice(2));
  }
  return node;
}

async function ethCall(to, data) {
  return rpc('eth_call', [{ to, data }, 'latest']);
}

function decodeAddress(hex) {
  if (!hex || hex === '0x' || hex.length < 66) return null;
  const addr = '0x' + hex.slice(26, 66);
  if (addr === '0x' + '0'.repeat(40)) return null;
  return addr;
}

function decodeString(hex) {
  if (!hex || hex === '0x' || hex.length < 130) return null;
  try {
    const raw = hex.slice(2);
    const offset = parseInt(raw.slice(0, 64), 16) * 2;
    const len = parseInt(raw.slice(offset, offset + 64), 16);
    if (len === 0) return null;
    const strHex = raw.slice(offset + 64, offset + 64 + len * 2);
    return Buffer.from(strHex, 'hex').toString('utf8');
  } catch { return null; }
}

// addr(bytes32 node) → address
async function resolveName(name) {
  if (!name.endsWith('.base.eth')) name += '.base.eth';
  const node = await namehash(name);
  // 0x3b3b57de = addr(bytes32)
  const data = '0x3b3b57de' + node.slice(2);
  const result = await ethCall(RESOLVER, data);
  return decodeAddress(result);
}

// name(bytes32 node) → string
async function reverseResolve(address) {
  const addr = address.toLowerCase().replace('0x', '');
  const reverseName = `${addr}.addr.reverse`;
  const node = await namehash(reverseName);
  // 0x691f3431 = name(bytes32)
  const data = '0x691f3431' + node.slice(2);
  const result = await ethCall(RESOLVER, data);
  return decodeString(result);
}

// text(bytes32 node, string key) → string
async function resolveText(name, key) {
  if (!name.endsWith('.base.eth')) name += '.base.eth';
  const node = await namehash(name);
  const keyHex = Buffer.from(key, 'utf8').toString('hex');
  const keyLen = key.length;
  // text(bytes32, string) = 0x59d1d43c
  let data = '0x59d1d43c' + node.slice(2);
  data += (64).toString(16).padStart(64, '0'); // offset to string
  data += keyLen.toString(16).padStart(64, '0');
  data += keyHex.padEnd(Math.ceil(keyHex.length / 64) * 64, '0');
  const result = await ethCall(RESOLVER, data);
  return decodeString(result);
}

// --- CLI ---
const args = process.argv.slice(2);
const flags = {};
const positional = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--reverse' || args[i] === '-r') flags.reverse = true;
  else if (args[i] === '--text' || args[i] === '-t') flags.textKey = args[++i];
  else if (args[i] === '--json' || args[i] === '-j') flags.json = true;
  else if (args[i] === '--help' || args[i] === '-h') flags.help = true;
  else positional.push(args[i]);
}

if (flags.help || positional.length === 0) {
  console.log(`basename-resolver — resolve Basenames (.base.eth) on Base

Usage:
  resolve.mjs <name>              Resolve name → address
  resolve.mjs -r <address>        Reverse resolve address → name
  resolve.mjs -t <key> <name>     Read text record (avatar, url, com.twitter, etc.)
  resolve.mjs --json <name>       Output as JSON

Examples:
  resolve.mjs jesse.base.eth
  resolve.mjs jesse
  resolve.mjs -r 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045
  resolve.mjs -t com.twitter jesse
  resolve.mjs --json jesse`);
  process.exit(0);
}

try {
  if (flags.reverse) {
    const address = positional[0];
    if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
      console.error('Error: invalid address format');
      process.exit(1);
    }
    const name = await reverseResolve(address);
    if (flags.json) {
      console.log(JSON.stringify({ address, name: name || null }));
    } else {
      console.log(name || 'No basename found');
    }
  } else if (flags.textKey) {
    const name = positional[0];
    const value = await resolveText(name, flags.textKey);
    if (flags.json) {
      console.log(JSON.stringify({ name, key: flags.textKey, value: value || null }));
    } else {
      console.log(value || `No "${flags.textKey}" record found`);
    }
  } else {
    const name = positional[0];
    const address = await resolveName(name);
    if (flags.json) {
      console.log(JSON.stringify({ name, address: address || null }));
    } else {
      console.log(address || 'Name not found');
    }
  }
} catch (err) {
  console.error('Error:', err.message);
  process.exit(1);
}
