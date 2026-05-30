#!/usr/bin/env node
// storage-reader — read and decode EVM contract storage slots.
// Zero deps. Computes mapping/array slot positions via keccak-256.
//
// Usage:
//   node read.mjs <address> <slot> [--rpc URL]
//   node read.mjs <address> <slot> --map <key>           # mapping(key => value) at slot
//   node read.mjs <address> <slot> --map <key> --nested <key2>  # nested mapping
//   node read.mjs <address> <slot> --array <index>       # dynamic array element
//   node read.mjs <address> <slot> --decode address|uint256|bool|string|bytes32
//   node read.mjs <address> --scan 0 20                  # scan slots 0..19
//
// Examples:
//   # Read slot 0 of USDC on Base
//   node read.mjs 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 0
//
//   # Read balanceOf mapping (slot 9 for USDC) for a specific address
//   node read.mjs 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 9 --map 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045
//
//   # Scan first 10 slots
//   node read.mjs 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 --scan 0 10

const DEFAULT_RPC = "https://mainnet.base.org";

// --- Minimal keccak-256 (FIPS 202) ---
// We inline a compact keccak to stay zero-dep.

const ROUND_CONSTANTS = [
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n,
  0x000000000000808bn, 0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n,
  0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
  0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n,
  0x8000000000008002n, 0x8000000000000080n, 0x000000000000800an, 0x800000008000000an,
  0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
];

const ROTATIONS = [
  [0,1,62,28,27],[36,44,6,55,20],[3,10,43,25,39],[41,45,15,21,8],[18,2,61,56,14]
];

const MASK64 = (1n << 64n) - 1n;
function rot64(x, n) {
  n = n % 64;
  if (n === 0) return x;
  return ((x << BigInt(n)) | (x >> BigInt(64 - n))) & MASK64;
}

function keccakF1600(state) {
  for (let round = 0; round < 24; round++) {
    // Theta
    const C = new Array(5);
    for (let x = 0; x < 5; x++) C[x] = state[x] ^ state[x+5] ^ state[x+10] ^ state[x+15] ^ state[x+20];
    const D = new Array(5);
    for (let x = 0; x < 5; x++) D[x] = C[(x+4)%5] ^ rot64(C[(x+1)%5], 1);
    for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) state[x+5*y] ^= D[x];
    // Rho + Pi
    const B = new Array(25).fill(0n);
    for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) B[y + 5*((2*x+3*y)%5)] = rot64(state[x+5*y], ROTATIONS[x][y]);
    // Chi
    for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) state[x+5*y] = B[x+5*y] ^ ((~B[(x+1)%5+5*y]) & MASK64 & B[(x+2)%5+5*y]);
    // Iota
    state[0] ^= ROUND_CONSTANTS[round];
    for (let i = 0; i < 25; i++) state[i] &= MASK64;
  }
}

function keccak256(inputBytes) {
  const rate = 136; // 1088 bits for keccak-256
  // Pad: append 0x01, then zeros, then 0x80 at end of block
  const padLen = rate - (inputBytes.length % rate);
  const padded = new Uint8Array(inputBytes.length + padLen);
  padded.set(inputBytes);
  padded[inputBytes.length] = 0x01;
  padded[padded.length - 1] |= 0x80;

  const state = new Array(25).fill(0n);
  for (let offset = 0; offset < padded.length; offset += rate) {
    for (let i = 0; i < rate; i += 8) {
      const lane = i >> 3;
      let v = 0n;
      for (let b = 0; b < 8; b++) v |= BigInt(padded[offset + i + b]) << BigInt(b * 8);
      state[lane] ^= v;
    }
    keccakF1600(state);
  }
  // Squeeze 32 bytes
  const out = new Uint8Array(32);
  for (let i = 0; i < 4; i++) {
    const v = state[i];
    for (let b = 0; b < 8; b++) out[i*8+b] = Number((v >> BigInt(b*8)) & 0xFFn);
  }
  return out;
}

// --- Hex utils ---

function hexToBytes(hex) {
  hex = hex.replace(/^0x/i, "");
  if (hex.length % 2) hex = "0" + hex;
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.substr(i*2, 2), 16);
  return bytes;
}

function bytesToHex(bytes) {
  return "0x" + Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
}

function padLeft(hex, bytes) {
  hex = hex.replace(/^0x/i, "");
  return hex.padStart(bytes * 2, "0");
}

function toBytes32(value) {
  if (typeof value === "string") {
    if (value.startsWith("0x") || value.startsWith("0X")) {
      return hexToBytes(padLeft(value, 32));
    }
    // Try as decimal number
    return hexToBytes(padLeft(BigInt(value).toString(16), 32));
  }
  return hexToBytes(padLeft(BigInt(value).toString(16), 32));
}

// --- Slot computation ---

function mappingSlot(baseSlot, key) {
  // keccak256(abi.encode(key, slot))
  const keyBytes = toBytes32(key);
  const slotBytes = toBytes32(baseSlot);
  const packed = new Uint8Array(64);
  packed.set(keyBytes, 0);
  packed.set(slotBytes, 32);
  return bytesToHex(keccak256(packed));
}

function arraySlot(baseSlot, index) {
  // elements start at keccak256(slot), element i at keccak256(slot) + i
  const slotBytes = toBytes32(baseSlot);
  const startHash = keccak256(slotBytes);
  const start = BigInt(bytesToHex(startHash));
  const elementSlot = start + BigInt(index);
  return "0x" + padLeft(elementSlot.toString(16), 32);
}

// --- Decode helpers ---

function decodeValue(raw, type) {
  const hex = raw.replace(/^0x/i, "");
  switch (type) {
    case "address":
      return "0x" + hex.slice(24);
    case "uint256":
    case "uint":
      return BigInt("0x" + hex).toString();
    case "uint128":
      return BigInt("0x" + hex.slice(32)).toString();
    case "int256":
    case "int": {
      const n = BigInt("0x" + hex);
      const max = 1n << 255n;
      return (n >= max ? n - (1n << 256n) : n).toString();
    }
    case "bool":
      return BigInt("0x" + hex) !== 0n ? "true" : "false";
    case "bytes32":
      return "0x" + hex;
    case "string":
    case "bytes": {
      // Simple case: short string stored inline (last byte < 32 means length*2)
      const lastByte = parseInt(hex.slice(-2), 16);
      if (lastByte < 64 && lastByte % 2 === 0) {
        const len = lastByte / 2;
        const strBytes = hexToBytes(hex.slice(0, len * 2));
        try {
          return new TextDecoder().decode(strBytes);
        } catch { return "0x" + hex.slice(0, len * 2); }
      }
      return "0x" + hex + " (may be long string - read keccak256(slot) for data)";
    }
    default:
      return "0x" + hex;
  }
}

function guessType(raw) {
  const hex = raw.replace(/^0x/i, "");
  if (hex === "0".repeat(64)) return { type: "zero", decoded: "0" };
  // Check if it looks like an address (first 12 bytes zero, last 20 non-zero)
  if (hex.slice(0, 24) === "0".repeat(24) && hex.slice(24) !== "0".repeat(40)) {
    const addr = "0x" + hex.slice(24);
    const n = BigInt("0x" + hex);
    // Could be a small uint too
    if (n < 1000000n) return { type: "uint256", decoded: n.toString(), alt: `or address ${addr}` };
    return { type: "address", decoded: addr };
  }
  // Check bool
  const n = BigInt("0x" + hex);
  if (n === 1n) return { type: "bool/uint256", decoded: "true / 1" };
  // Small number
  if (n < 10n ** 24n) return { type: "uint256", decoded: n.toString() };
  // Large number - could be uint256 or bytes32
  return { type: "uint256|bytes32", decoded: n.toString() };
}

// --- RPC ---

async function rpcCall(rpc, method, params) {
  const res = await fetch(rpc, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!res.ok) throw new Error(`RPC error: ${res.status} ${res.statusText}`);
  const j = await res.json();
  if (j.error) throw new Error(`RPC error: ${j.error.message}`);
  return j.result;
}

async function getStorage(rpc, address, slot) {
  return rpcCall(rpc, "eth_getStorageAt", [address, slot, "latest"]);
}

// --- CLI ---

function usage() {
  console.log(`storage-reader — read and decode EVM contract storage slots

Usage:
  node read.mjs <address> <slot> [options]
  node read.mjs <address> --scan <from> <to> [options]

Options:
  --rpc <url>          RPC endpoint (default: Base mainnet)
  --map <key>          Compute mapping slot: keccak256(key, baseSlot)
  --nested <key>       Second-level mapping key (for nested mappings)
  --array <index>      Compute array element slot: keccak256(slot) + index
  --decode <type>      Decode as: address, uint256, int256, bool, string, bytes32
  --scan <from> <to>   Scan a range of slots

Examples:
  node read.mjs 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 0
  node read.mjs 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 9 --map 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045
  node read.mjs 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 --scan 0 10`);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 2 || args.includes("--help") || args.includes("-h")) {
    usage();
    process.exit(args.includes("--help") || args.includes("-h") ? 0 : 1);
  }

  const address = args[0];
  let rpc = DEFAULT_RPC;
  let mapKey = null, nestedKey = null, arrayIndex = null, decodeType = null;
  let scanMode = false, scanFrom = 0, scanTo = 0;
  let slot = null;

  // Parse flags
  for (let i = 1; i < args.length; i++) {
    switch (args[i]) {
      case "--rpc": rpc = args[++i]; break;
      case "--map": mapKey = args[++i]; break;
      case "--nested": nestedKey = args[++i]; break;
      case "--array": arrayIndex = args[++i]; break;
      case "--decode": decodeType = args[++i]; break;
      case "--scan":
        scanMode = true;
        scanFrom = parseInt(args[++i]);
        scanTo = parseInt(args[++i]);
        break;
      default:
        if (slot === null) slot = args[i];
        break;
    }
  }

  // --- Scan mode ---
  if (scanMode) {
    console.log(`Scanning slots ${scanFrom}..${scanTo - 1} on ${address}\n`);
    const results = [];
    // Batch in groups of 10
    for (let i = scanFrom; i < scanTo; i += 10) {
      const batch = [];
      for (let j = i; j < Math.min(i + 10, scanTo); j++) {
        const slotHex = "0x" + padLeft(j.toString(16), 32);
        batch.push(getStorage(rpc, address, slotHex).then(v => ({ slot: j, value: v })));
      }
      results.push(...await Promise.all(batch));
    }

    for (const { slot: s, value } of results) {
      const isEmpty = value === "0x" + "0".repeat(64) || value === "0x0";
      if (isEmpty) {
        console.log(`  slot ${String(s).padStart(3)}: (empty)`);
      } else {
        const padded = value.replace(/^0x/, "").padStart(64, "0");
        const guess = guessType("0x" + padded);
        console.log(`  slot ${String(s).padStart(3)}: ${value}`);
        console.log(`         -> ${guess.type}: ${guess.decoded}${guess.alt ? ` (${guess.alt})` : ""}`);
      }
    }
    return;
  }

  // --- Single slot mode ---
  if (slot === null) { usage(); process.exit(1); }

  let targetSlot;
  if (mapKey) {
    targetSlot = mappingSlot(slot, mapKey);
    if (nestedKey) {
      targetSlot = mappingSlot(targetSlot, nestedKey);
    }
    const label = nestedKey
      ? `mapping[${mapKey}][${nestedKey}]`
      : `mapping[${mapKey}]`;
    console.log(`Base slot: ${slot}`);
    console.log(`${label} -> computed slot: ${targetSlot}\n`);
  } else if (arrayIndex !== null) {
    targetSlot = arraySlot(slot, arrayIndex);
    console.log(`Base slot: ${slot}`);
    console.log(`array[${arrayIndex}] -> computed slot: ${targetSlot}\n`);
  } else {
    targetSlot = "0x" + padLeft(slot.replace(/^0x/i, ""), 32);
  }

  const raw = await getStorage(rpc, address, targetSlot);
  console.log(`Address: ${address}`);
  console.log(`Slot:    ${targetSlot}`);
  console.log(`Raw:     ${raw}\n`);

  const padded = raw.replace(/^0x/, "").padStart(64, "0");

  if (decodeType) {
    console.log(`Decoded (${decodeType}): ${decodeValue("0x" + padded, decodeType)}`);
  } else {
    const guess = guessType("0x" + padded);
    console.log(`Auto-detected: ${guess.type}`);
    console.log(`Decoded: ${guess.decoded}${guess.alt ? ` (${guess.alt})` : ""}`);
  }
}

main().catch(e => { console.error("Error:", e.message); process.exit(1); });
