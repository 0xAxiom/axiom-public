#!/usr/bin/env node

// Multicall Batcher — bundle multiple eth_call reads into a single RPC request.
// Uses Multicall3 (0xcA11bde05977b3631167028862bE2a173976CA11), deployed on
// every major EVM chain. Zero dependencies.
//
// Usage:
//   node multicall-batcher.mjs <calls-file> [--chain base] [--block latest]
//   node multicall-batcher.mjs --inline "0xAddr:0xCalldata,0xAddr2:0xCalldata2"
//
// Calls file format (JSON):
//   [
//     { "target": "0x...", "calldata": "0x...", "label": "totalSupply" },
//     { "target": "0x...", "calldata": "0x...", "label": "balanceOf" }
//   ]
//
// Each call can optionally set "allowFailure": true (default: true).

const MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11';

const CHAINS = {
  base:     { rpc: 'https://mainnet.base.org',        name: 'Base' },
  ethereum: { rpc: 'https://eth.llamarpc.com',        name: 'Ethereum' },
  arbitrum: { rpc: 'https://arb1.arbitrum.io/rpc',    name: 'Arbitrum' },
  optimism: { rpc: 'https://mainnet.optimism.io',     name: 'Optimism' },
  polygon:  { rpc: 'https://polygon-rpc.com',         name: 'Polygon' },
};

// aggregate3((address target, bool allowFailure, bytes callData)[])
// selector: 0x82ad56cb
const AGGREGATE3_SIG = '0x82ad56cb';

// --- ABI encoding helpers (zero-dep) ---

function encodeUint256(n) {
  return BigInt(n).toString(16).padStart(64, '0');
}

function encodeBytes(hex) {
  const data = hex.startsWith('0x') ? hex.slice(2) : hex;
  const len = data.length / 2;
  const padded = data.padEnd(Math.ceil(data.length / 64) * 64, '0');
  return encodeUint256(len) + padded;
}

function encodeAggregate3(calls) {
  // aggregate3 takes a dynamic array of structs:
  //   (address target, bool allowFailure, bytes callData)[]
  //
  // ABI layout:
  //   [0x00] offset to array (0x20)
  //   [0x20] array length
  //   [0x40+] per-element offsets (relative to array data start)
  //   then each element: target (padded), allowFailure (padded), offset-to-calldata, calldata

  const arrayOffset = encodeUint256(0x20);
  const arrayLength = encodeUint256(calls.length);

  // Each struct is dynamically sized because of bytes callData.
  // We need: offset for each element, then each element's encoding.
  const encodedElements = [];
  for (const call of calls) {
    const target = call.target.slice(2).toLowerCase().padStart(64, '0');
    const allowFailure = encodeUint256(call.allowFailure !== false ? 1 : 0);
    // offset to callData within the struct (3 * 32 = 0x60)
    const calldataOffset = encodeUint256(0x60);
    const calldataEncoded = encodeBytes(call.calldata);
    encodedElements.push(target + allowFailure + calldataOffset + calldataEncoded);
  }

  // Element offsets (relative to start of array data, which is after length word)
  let elementOffsets = '';
  let runningOffset = calls.length * 32; // skip past all offset words
  const elementHexes = [];
  for (const elem of encodedElements) {
    elementOffsets += encodeUint256(runningOffset);
    elementHexes.push(elem);
    runningOffset += elem.length / 2; // bytes
  }

  return AGGREGATE3_SIG +
    arrayOffset +
    arrayLength +
    elementOffsets +
    elementHexes.join('');
}

function decodeAggregate3Result(hex) {
  // Returns: (bool success, bytes returnData)[]
  const data = hex.startsWith('0x') ? hex.slice(2) : hex;

  // [0x00] offset to array
  const arrayDataOffset = parseInt(data.slice(0, 64), 16) * 2;
  const arrayLen = parseInt(data.slice(arrayDataOffset, arrayDataOffset + 64), 16);

  const results = [];
  const offsetsStart = arrayDataOffset + 64;

  for (let i = 0; i < arrayLen; i++) {
    const elemOffset = parseInt(data.slice(offsetsStart + i * 64, offsetsStart + (i + 1) * 64), 16) * 2;
    const elemStart = arrayDataOffset + 64 + elemOffset;

    const success = parseInt(data.slice(elemStart, elemStart + 64), 16) === 1;
    const returnDataOffset = parseInt(data.slice(elemStart + 64, elemStart + 128), 16) * 2;
    const returnDataStart = elemStart + returnDataOffset;
    const returnDataLen = parseInt(data.slice(returnDataStart, returnDataStart + 64), 16);
    const returnData = '0x' + data.slice(returnDataStart + 64, returnDataStart + 64 + returnDataLen * 2);

    results.push({ success, returnData });
  }
  return results;
}

// --- RPC ---

async function rpcCall(rpcUrl, method, params) {
  const res = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const json = await res.json();
  if (json.error) throw new Error(`RPC error: ${json.error.message}`);
  return json.result;
}

// --- Decode helpers ---

function decodeUint256(hex) {
  const h = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (h.length === 0) return '0';
  return BigInt('0x' + h).toString(10);
}

function decodeAddress(hex) {
  const h = hex.startsWith('0x') ? hex.slice(2) : hex;
  return '0x' + h.slice(-40).toLowerCase();
}

function decodeString(hex) {
  try {
    const h = hex.startsWith('0x') ? hex.slice(2) : hex;
    if (h.length < 128) return null;
    const offset = parseInt(h.slice(0, 64), 16) * 2;
    const len = parseInt(h.slice(offset, offset + 64), 16);
    const strHex = h.slice(offset + 64, offset + 64 + len * 2);
    let s = '';
    for (let i = 0; i < strHex.length; i += 2) {
      s += String.fromCharCode(parseInt(strHex.slice(i, i + 2), 16));
    }
    return s;
  } catch {
    return null;
  }
}

function tryDecode(hex) {
  if (!hex || hex === '0x' || hex.length <= 2) return hex;
  const h = hex.startsWith('0x') ? hex.slice(2) : hex;
  // single uint256
  if (h.length === 64) {
    const n = BigInt('0x' + h);
    // Only classify as address if the value is large enough to plausibly be one
    // (> 2^128) and fits the zero-padded pattern
    if (n > BigInt(2) ** BigInt(128) && h.slice(0, 24) === '000000000000000000000000' && h.slice(24) !== '0'.repeat(40)) {
      return { type: 'address', value: decodeAddress(hex) };
    }
    return { type: 'uint256', value: n.toString(10) };
  }
  // try string
  const str = decodeString(hex);
  if (str && str.length > 0 && str.length < 200) {
    return { type: 'string', value: str };
  }
  return { type: 'bytes', value: hex };
}

// --- Common calldata presets ---

const PRESETS = {
  totalSupply:  '0x18160ddd',
  name:         '0x06fdde03',
  symbol:       '0x95d89b41',
  decimals:     '0x313ce567',
  owner:        '0x8da5cb5b',
  paused:       '0x5c975abb',
};

function resolvePreset(calldata) {
  if (PRESETS[calldata]) return PRESETS[calldata];
  return calldata;
}

// --- CLI ---

function printUsage() {
  console.log(`
Multicall Batcher — bundle eth_call reads into one RPC request via Multicall3.

Usage:
  node multicall-batcher.mjs <calls.json> [--chain base] [--block latest]
  node multicall-batcher.mjs --inline "0xAddr:totalSupply,0xAddr:symbol"
  node multicall-batcher.mjs --token 0xAddr [--chain base]

Options:
  --chain <name>    Chain to query (base, ethereum, arbitrum, optimism, polygon)
  --block <num>     Block number or "latest" (default: latest)
  --inline <spec>   Comma-separated target:calldata pairs (supports presets)
  --token <addr>    Shortcut: fetch name, symbol, decimals, totalSupply for a token
  --raw             Output raw hex instead of decoded values
  --json            Output as JSON

Presets: ${Object.keys(PRESETS).join(', ')}

Examples:
  # Get token info for USDC on Base
  node multicall-batcher.mjs --token 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 --chain base

  # Custom multicall from file
  echo '[{"target":"0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913","calldata":"totalSupply","label":"supply"}]' > calls.json
  node multicall-batcher.mjs calls.json --chain base
`);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    printUsage();
    process.exit(0);
  }

  let chainName = 'base';
  let block = 'latest';
  let raw = false;
  let jsonOut = false;
  let calls = [];

  // Parse flags
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--chain' && args[i + 1]) { chainName = args[++i]; continue; }
    if (args[i] === '--block' && args[i + 1]) { block = args[++i]; continue; }
    if (args[i] === '--raw') { raw = true; continue; }
    if (args[i] === '--json') { jsonOut = true; continue; }
    if (args[i] === '--inline' && args[i + 1]) {
      const pairs = args[++i].split(',');
      for (const pair of pairs) {
        const [target, calldataOrPreset] = pair.split(':');
        const calldata = resolvePreset(calldataOrPreset);
        calls.push({ target, calldata, label: calldataOrPreset, allowFailure: true });
      }
      continue;
    }
    if (args[i] === '--token' && args[i + 1]) {
      const addr = args[++i];
      calls = [
        { target: addr, calldata: PRESETS.name, label: 'name', allowFailure: true },
        { target: addr, calldata: PRESETS.symbol, label: 'symbol', allowFailure: true },
        { target: addr, calldata: PRESETS.decimals, label: 'decimals', allowFailure: true },
        { target: addr, calldata: PRESETS.totalSupply, label: 'totalSupply', allowFailure: true },
        { target: addr, calldata: PRESETS.owner, label: 'owner', allowFailure: true },
      ];
      continue;
    }
    // Assume it's a file path
    if (!args[i].startsWith('--')) {
      const fs = await import('node:fs');
      const content = fs.readFileSync(args[i], 'utf-8');
      const parsed = JSON.parse(content);
      calls = parsed.map(c => ({
        target: c.target,
        calldata: resolvePreset(c.calldata),
        label: c.label || c.calldata,
        allowFailure: c.allowFailure !== false,
      }));
    }
  }

  if (calls.length === 0) {
    console.error('Error: no calls specified. Use --inline, --token, or provide a JSON file.');
    process.exit(1);
  }

  const chain = CHAINS[chainName];
  if (!chain) {
    console.error(`Unknown chain: ${chainName}. Available: ${Object.keys(CHAINS).join(', ')}`);
    process.exit(1);
  }

  const blockParam = block === 'latest' ? 'latest' : '0x' + parseInt(block).toString(16);

  console.error(`Batching ${calls.length} calls via Multicall3 on ${chain.name}...`);

  const encoded = encodeAggregate3(calls);
  const result = await rpcCall(chain.rpc, 'eth_call', [
    { to: MULTICALL3, data: encoded },
    blockParam,
  ]);

  const decoded = decodeAggregate3Result(result);

  if (jsonOut) {
    const output = decoded.map((r, i) => ({
      label: calls[i].label,
      target: calls[i].target,
      success: r.success,
      raw: r.returnData,
      decoded: raw ? undefined : (r.success ? tryDecode(r.returnData) : null),
    }));
    console.log(JSON.stringify(output, null, 2));
  } else {
    for (let i = 0; i < decoded.length; i++) {
      const r = decoded[i];
      const label = calls[i].label || `call[${i}]`;
      if (!r.success) {
        console.log(`${label}: REVERTED`);
        continue;
      }
      if (raw) {
        console.log(`${label}: ${r.returnData}`);
      } else {
        const d = tryDecode(r.returnData);
        if (typeof d === 'object' && d !== null) {
          console.log(`${label}: ${d.value} (${d.type})`);
        } else {
          console.log(`${label}: ${d}`);
        }
      }
    }
  }
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
