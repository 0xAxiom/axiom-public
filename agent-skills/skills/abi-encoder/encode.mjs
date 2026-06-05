#!/usr/bin/env node
// abi-encoder — encode EVM function calls and constructor args from signature + values.
// Zero deps. Complement to calldata-decoder.
//
// Usage:
//   node encode.mjs "transfer(address,uint256)" 0xAbC...123 1000000000000000000
//   node encode.mjs "approve(address,uint256)" 0xSpender 115792089237316195423570985008687907853269984665640564039457584007913129639935
//   node encode.mjs --constructor "(uint256,string,address)" 100 "MyToken" 0xOwner
//   node encode.mjs --raw "(address,uint256)" 0xAbC 500   # abi.encode without selector

function stripHex(s) {
  s = s.trim();
  if (s.startsWith("0x") || s.startsWith("0X")) s = s.slice(2);
  return s.toLowerCase();
}

function padLeft(hex, bytes) {
  return hex.padStart(bytes * 2, "0");
}

function padRight(hex, bytes) {
  return hex.padEnd(bytes * 2, "0");
}

function keccak256(data) {
  const RC = [
    0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n,
    0x000000000000808bn, 0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n,
    0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
    0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n,
    0x8000000000008002n, 0x8000000000000080n, 0x000000000000800an, 0x800000008000000an,
    0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
  ];
  const ROTC = [
    [0,36,3,41,18],[1,44,10,45,2],[62,6,43,15,61],[28,55,25,21,56],[27,20,39,8,14]
  ];

  const bytes = typeof data === "string" ? new Uint8Array([...data].map(c => c.charCodeAt(0))) : new Uint8Array(data);
  const rate = 136;
  const padded = new Uint8Array(Math.ceil((bytes.length + 1) / rate) * rate);
  padded.set(bytes);
  padded[bytes.length] = 0x01;
  padded[padded.length - 1] |= 0x80;

  const state = Array.from({ length: 5 }, () => Array.from({ length: 5 }, () => 0n));

  for (let off = 0; off < padded.length; off += rate) {
    for (let i = 0; i < rate / 8; i++) {
      const x = i % 5, y = Math.floor(i / 5);
      let v = 0n;
      for (let b = 0; b < 8; b++) v |= BigInt(padded[off + i * 8 + b]) << BigInt(b * 8);
      state[x][y] ^= v;
    }
    for (let round = 0; round < 24; round++) {
      const C = [];
      for (let x = 0; x < 5; x++) C[x] = state[x][0] ^ state[x][1] ^ state[x][2] ^ state[x][3] ^ state[x][4];
      const D = [];
      for (let x = 0; x < 5; x++) D[x] = C[(x + 4) % 5] ^ rot64(C[(x + 1) % 5], 1);
      for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) state[x][y] ^= D[x];
      const B = Array.from({ length: 5 }, () => Array(5));
      for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) B[y][(2 * x + 3 * y) % 5] = rot64(state[x][y], ROTC[x][y]);
      for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) state[x][y] = B[x][y] ^ ((~B[(x + 1) % 5][y]) & B[(x + 2) % 5][y]);
      state[0][0] ^= RC[round];
    }
  }

  const out = [];
  for (let i = 0; i < 4; i++) {
    const x = i % 5, y = Math.floor(i / 5);
    let v = state[x][y];
    for (let b = 0; b < 8; b++) { out.push(Number(v & 0xffn)); v >>= 8n; }
  }
  return out.slice(0, 32).map(b => b.toString(16).padStart(2, "0")).join("");

  function rot64(v, n) {
    v = BigInt.asUintN(64, v);
    n = n % 64;
    return BigInt.asUintN(64, (v << BigInt(n)) | (v >> BigInt(64 - n)));
  }
}

function functionSelector(sig) {
  const clean = sig.replace(/\s/g, "");
  const bytes = [...clean].map(c => c.charCodeAt(0));
  return keccak256(bytes).slice(0, 8);
}

function parseSig(sig) {
  const m = sig.match(/^([^(]*)\((.*)\)$/s);
  if (!m) return null;
  const name = m[1];
  const raw = m[2].trim();
  if (!raw) return { name, types: [] };
  const types = [];
  let depth = 0, cur = "";
  for (const c of raw) {
    if (c === "(") { depth++; cur += c; }
    else if (c === ")") { depth--; cur += c; }
    else if (c === "," && depth === 0) { types.push(cur.trim()); cur = ""; }
    else cur += c;
  }
  if (cur.trim()) types.push(cur.trim());
  return { name, types };
}

function isDynamic(type) {
  if (type === "bytes" || type === "string") return true;
  if (type.endsWith("[]")) return true;
  if (type.startsWith("(")) {
    const inner = parseSig(`f${type}`);
    if (!inner) return true;
    return inner.types.some(t => isDynamic(t));
  }
  return false;
}

function encodeValue(type, value) {
  if (type === "address") {
    return padLeft(stripHex(String(value)), 32);
  }
  if (type === "bool") {
    const v = value === "true" || value === "1" || value === true ? 1 : 0;
    return padLeft(v.toString(16), 32);
  }
  if (/^uint(\d*)$/.test(type)) {
    const n = BigInt(value);
    return padLeft(n.toString(16), 32);
  }
  if (/^int(\d*)$/.test(type)) {
    const bits = parseInt(type.match(/\d+/)?.[0] || "256", 10);
    let n = BigInt(value);
    if (n < 0n) n = (1n << BigInt(bits)) + n;
    return padLeft(BigInt.asUintN(256, n).toString(16), 32);
  }
  if (/^bytes(\d+)$/.test(type)) {
    const size = parseInt(RegExp.$1, 10);
    const hex = stripHex(String(value));
    return padRight(hex.slice(0, size * 2), 32);
  }
  if (type === "bytes") {
    const hex = stripHex(String(value));
    const len = hex.length / 2;
    const words = Math.ceil(hex.length / 64);
    return padLeft(len.toString(16), 32) + padRight(hex, words * 32);
  }
  if (type === "string") {
    const hex = [...String(value)].map(c => c.charCodeAt(0).toString(16).padStart(2, "0")).join("");
    const len = hex.length / 2;
    const words = Math.ceil(hex.length / 64);
    return padLeft(len.toString(16), 32) + padRight(hex, words * 32);
  }
  if (type.endsWith("[]")) {
    const baseType = type.slice(0, -2);
    const items = JSON.parse(value);
    return encodeArray(baseType, items);
  }
  if (/^(.+)\[(\d+)\]$/.test(type)) {
    const baseType = RegExp.$1;
    const items = JSON.parse(value);
    return encodeTuple(items.map((_, i) => baseType), items);
  }
  if (type.startsWith("(")) {
    const inner = parseSig(`f${type}`);
    const items = JSON.parse(value);
    return encodeTuple(inner.types, items);
  }
  throw new Error(`Unsupported type: ${type}`);
}

function encodeArray(baseType, items) {
  const count = padLeft(items.length.toString(16), 32);
  const encoded = encodeTuple(items.map(() => baseType), items);
  return count + encoded;
}

function encodeTuple(types, values) {
  if (types.length !== values.length) throw new Error(`Type/value count mismatch: ${types.length} types, ${values.length} values`);

  const heads = [];
  const tails = [];
  let tailOffset = types.length * 32;

  for (let i = 0; i < types.length; i++) {
    if (isDynamic(types[i])) {
      const encoded = encodeValue(types[i], values[i]);
      heads.push(null);
      tails.push(encoded);
    } else {
      heads.push(encodeValue(types[i], values[i]));
      tails.push(null);
    }
  }

  let dynamicOffset = tailOffset;
  const headHex = [];
  const tailHex = [];

  for (let i = 0; i < types.length; i++) {
    if (heads[i] !== null) {
      headHex.push(heads[i]);
    } else {
      headHex.push(padLeft(dynamicOffset.toString(16), 32));
      const tail = tails[i];
      tailHex.push(tail);
      dynamicOffset += tail.length / 2;
    }
  }

  return headHex.join("") + tailHex.join("");
}

function encode(sig, values, mode) {
  const parsed = parseSig(sig);
  if (!parsed) throw new Error(`Cannot parse signature: ${sig}`);

  const encoded = encodeTuple(parsed.types, values);

  if (mode === "constructor" || mode === "raw") {
    return "0x" + encoded;
  }

  const selector = functionSelector(sig.replace(/\s/g, ""));
  return "0x" + selector + encoded;
}

function printHelp() {
  console.log(`abi-encoder — encode EVM function calls from signature + values

Usage:
  node encode.mjs "transfer(address,uint256)" 0xRecipient 1000000000000000000
  node encode.mjs "approve(address,uint256)" 0xSpender 0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff
  node encode.mjs --constructor "(uint256,string,address)" 100 "MyToken" 0xOwner
  node encode.mjs --raw "(address,uint256)" 0xAbC 500

Supported types:
  address, bool, uint8-uint256, int8-int256, bytes1-bytes32,
  bytes, string, fixed-size arrays T[N], dynamic arrays T[],
  tuples (T1,T2,...) — pass as JSON arrays

Flags:
  --constructor    Encode constructor args (no function selector)
  --raw            Encode values only (abi.encode, no selector)
  --help           Show this help

Zero dependencies. Complement to calldata-decoder.`);
}

const args = process.argv.slice(2);
if (args.includes("--help") || args.length === 0) {
  printHelp();
  process.exit(0);
}

let mode = "function";
if (args[0] === "--constructor") { mode = "constructor"; args.shift(); }
else if (args[0] === "--raw") { mode = "raw"; args.shift(); }

const sig = args[0];
const values = args.slice(1);

try {
  const result = encode(sig, values, mode);
  console.log(result);
} catch (e) {
  console.error(`Error: ${e.message}`);
  process.exit(1);
}
