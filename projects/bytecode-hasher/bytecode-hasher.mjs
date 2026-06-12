#!/usr/bin/env node

// Bytecode Hasher — fingerprint deployed contracts by hashing runtime bytecode.
// Compare contracts across addresses to detect clones, verify implementations,
// and find identical deployments. Zero dependencies.

import { createHash } from 'node:crypto';

const CHAINS = {
  base:     { rpc: 'https://mainnet.base.org',     name: 'Base' },
  ethereum: { rpc: 'https://eth.llamarpc.com',      name: 'Ethereum' },
  arbitrum: { rpc: 'https://arb1.arbitrum.io/rpc',  name: 'Arbitrum' },
  optimism: { rpc: 'https://mainnet.optimism.io',   name: 'Optimism' },
};

let reqId = 1;

async function rpc(url, method, params) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: reqId++, method, params }),
  });
  const json = await res.json();
  if (json.error) throw new Error(`RPC error: ${json.error.message}`);
  return json.result;
}

async function getCode(rpcUrl, address) {
  const code = await rpc(rpcUrl, 'eth_getCode', [address, 'latest']);
  return code === '0x' ? null : code;
}

function hashBytecode(bytecode) {
  return createHash('sha256').update(bytecode).digest('hex');
}

// Strip constructor args and metadata from runtime bytecode for normalized comparison.
// Solidity appends CBOR-encoded metadata (compiler version, source hash) at the end.
// This metadata differs between identical-source compilations with different settings.
function stripMetadata(bytecode) {
  // Solidity metadata: last 2 bytes = length of CBOR, preceded by CBOR data.
  // The CBOR block starts with 0xa2 (map with 2 entries) typically.
  const hex = bytecode.startsWith('0x') ? bytecode.slice(2) : bytecode;
  if (hex.length < 4) return hex;

  // Read last 2 bytes as metadata length
  const metaLenHex = hex.slice(-4);
  const metaLen = parseInt(metaLenHex, 16);

  // Metadata length (in bytes) * 2 (hex chars) + 4 (the length field itself)
  const totalMetaChars = metaLen * 2 + 4;

  if (totalMetaChars >= hex.length || metaLen === 0 || metaLen > 512) {
    // Doesn't look like valid Solidity metadata — return as-is
    return hex;
  }

  return hex.slice(0, hex.length - totalMetaChars);
}

function bytecodeStats(bytecode) {
  const hex = bytecode.startsWith('0x') ? bytecode.slice(2) : bytecode;
  const bytes = hex.length / 2;
  // Count PUSH0 (5F), SELFDESTRUCT (FF), DELEGATECALL (F4), CREATE2 (F5)
  const opcodes = {};
  const interesting = { '5f': 'PUSH0', 'ff': 'SELFDESTRUCT', 'f4': 'DELEGATECALL', 'f5': 'CREATE2' };
  for (let i = 0; i < hex.length; i += 2) {
    const op = hex.slice(i, i + 2).toLowerCase();
    if (interesting[op]) {
      opcodes[interesting[op]] = (opcodes[interesting[op]] || 0) + 1;
    }
    // Skip PUSH data
    const opInt = parseInt(op, 16);
    if (opInt >= 0x60 && opInt <= 0x7f) {
      i += (opInt - 0x5f) * 2;
    }
  }
  return { bytes, opcodes };
}

// --- Commands ---

async function cmdHash(addresses, chainKey) {
  const chain = CHAINS[chainKey];
  if (!chain) {
    console.error(`Unknown chain: ${chainKey}. Options: ${Object.keys(CHAINS).join(', ')}`);
    process.exit(1);
  }

  console.log(`\nFetching bytecode from ${chain.name}...\n`);

  const results = await Promise.all(
    addresses.map(async (addr) => {
      const code = await getCode(chain.rpc, addr);
      if (!code) return { addr, empty: true };
      const raw = hashBytecode(code);
      const normalized = hashBytecode(stripMetadata(code));
      const stats = bytecodeStats(code);
      return { addr, code, raw, normalized, stats, empty: false };
    })
  );

  for (const r of results) {
    if (r.empty) {
      console.log(`${r.addr}`);
      console.log(`  Status: EOA or empty contract\n`);
      continue;
    }
    console.log(`${r.addr}`);
    console.log(`  Size:       ${r.stats.bytes.toLocaleString()} bytes`);
    console.log(`  Hash (raw): ${r.raw}`);
    console.log(`  Hash (norm): ${r.normalized}`);
    if (Object.keys(r.stats.opcodes).length > 0) {
      const ops = Object.entries(r.stats.opcodes).map(([k, v]) => `${k}:${v}`).join(' ');
      console.log(`  Opcodes:    ${ops}`);
    }
    console.log();
  }

  // If multiple addresses, show comparison
  if (results.filter(r => !r.empty).length > 1) {
    console.log('--- Comparison ---');
    const groups = {};
    for (const r of results) {
      if (r.empty) continue;
      if (!groups[r.normalized]) groups[r.normalized] = [];
      groups[r.normalized].push(r.addr);
    }
    const groupEntries = Object.entries(groups);
    if (groupEntries.length === 1) {
      console.log('All contracts have IDENTICAL normalized bytecode (same source, possibly different metadata).');
      // Check if raw hashes also match
      const rawSet = new Set(results.filter(r => !r.empty).map(r => r.raw));
      if (rawSet.size === 1) {
        console.log('Raw bytecode also matches exactly (same compiler settings + metadata).');
      } else {
        console.log('Raw bytecode differs — likely same source compiled with different settings or Solidity version.');
      }
    } else {
      console.log(`Found ${groupEntries.length} distinct bytecode groups:`);
      for (const [hash, addrs] of groupEntries) {
        console.log(`\n  Group ${hash.slice(0, 12)}...:`);
        for (const a of addrs) console.log(`    ${a}`);
      }
    }
    console.log();
  }
}

async function cmdCompareChains(address, chainKeys) {
  console.log(`\nComparing ${address} across chains...\n`);

  const results = await Promise.all(
    chainKeys.map(async (key) => {
      const chain = CHAINS[key];
      if (!chain) return { chain: key, error: `Unknown chain: ${key}` };
      try {
        const code = await getCode(chain.rpc, address);
        if (!code) return { chain: key, name: chain.name, empty: true };
        return {
          chain: key,
          name: chain.name,
          raw: hashBytecode(code),
          normalized: hashBytecode(stripMetadata(code)),
          bytes: bytecodeStats(code).bytes,
          empty: false,
        };
      } catch (e) {
        return { chain: key, name: chain.name, error: e.message };
      }
    })
  );

  for (const r of results) {
    if (r.error) {
      console.log(`  ${r.chain}: ERROR — ${r.error}`);
    } else if (r.empty) {
      console.log(`  ${r.name}: not deployed`);
    } else {
      console.log(`  ${r.name}: ${r.bytes.toLocaleString()} bytes — ${r.normalized.slice(0, 16)}...`);
    }
  }

  const deployed = results.filter(r => !r.empty && !r.error);
  if (deployed.length > 1) {
    const normSet = new Set(deployed.map(r => r.normalized));
    console.log();
    if (normSet.size === 1) {
      console.log(`Identical bytecode across ${deployed.length} chains.`);
    } else {
      console.log(`Bytecode DIFFERS across chains — ${normSet.size} distinct versions.`);
    }
  }
  console.log();
}

// --- CLI ---

function usage() {
  console.log(`
bytecode-hasher — fingerprint and compare deployed contract bytecode

Usage:
  bytecode-hasher <address> [address...] [--chain base|ethereum|arbitrum|optimism]
  bytecode-hasher <address> --cross-chain
  bytecode-hasher --help

Examples:
  # Hash a single contract on Base
  bytecode-hasher 0x1234...abcd

  # Compare two contracts (are they clones?)
  bytecode-hasher 0x1234...abcd 0x5678...efgh

  # Check if the same address has identical bytecode across chains
  bytecode-hasher 0x1234...abcd --cross-chain

  # Hash on Ethereum mainnet
  bytecode-hasher 0x1234...abcd --chain ethereum

Options:
  --chain <name>    Chain to query (default: base)
  --cross-chain     Compare bytecode across all supported chains
  --help            Show this help
`);
}

const args = process.argv.slice(2);
if (args.length === 0 || args.includes('--help')) {
  usage();
  process.exit(0);
}

const addresses = [];
let chain = 'base';
let crossChain = false;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--chain') {
    chain = args[++i];
  } else if (args[i] === '--cross-chain') {
    crossChain = true;
  } else if (args[i].startsWith('0x')) {
    addresses.push(args[i]);
  } else {
    console.error(`Unknown argument: ${args[i]}`);
    process.exit(1);
  }
}

if (addresses.length === 0) {
  console.error('Provide at least one address.');
  process.exit(1);
}

if (crossChain) {
  await cmdCompareChains(addresses[0], Object.keys(CHAINS));
} else {
  await cmdHash(addresses, chain);
}
