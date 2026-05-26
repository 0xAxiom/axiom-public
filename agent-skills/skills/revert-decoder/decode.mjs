#!/usr/bin/env node
// revert-decoder — turn raw EVM revert data into a readable error.
// Handles Error(string), Panic(uint256), and custom errors via openchain.xyz.
// Zero deps. With --tx, replays the failed tx via eth_call to extract revert data.
//
// Usage:
//   node decode.mjs 0x08c379a0...                       # decode raw revert hex
//   echo 0x4e487b710000...0011 | node decode.mjs        # from stdin
//   node decode.mjs --tx 0x<hash> --rpc <url>           # replay failed tx
//   node decode.mjs --json 0x...                        # machine-readable

const API = "https://api.openchain.xyz/signature-database/v1/lookup";

const ERROR_STRING_SELECTOR = "0x08c379a0"; // Error(string)
const PANIC_SELECTOR = "0x4e487b71";        // Panic(uint256)

// Solidity Panic codes — see docs.soliditylang.org/en/latest/control-structures.html#panic-via-assert-and-error-via-require
const PANIC_CODES = {
  0x00: "generic compiler-inserted panic",
  0x01: "assert(false)",
  0x11: "arithmetic over/underflow (unchecked)",
  0x12: "division or modulo by zero",
  0x21: "conversion to non-existent enum value",
  0x22: "incorrectly encoded storage byte array",
  0x31: ".pop() on empty array",
  0x32: "array index out of bounds",
  0x41: "memory allocation too large or out of memory",
  0x51: "called a zero-initialized variable of internal function type",
};

function stripHex(s) {
  s = s.trim();
  if (s.startsWith("0x") || s.startsWith("0X")) s = s.slice(2);
  return s.toLowerCase();
}

async function lookupSelector(selector) {
  const url = `${API}?function=${selector}&filter=true`;
  try {
    const res = await fetch(url, { headers: { "user-agent": "revert-decoder/1.0" } });
    if (!res.ok) return [];
    const j = await res.json();
    return j?.result?.function?.[selector]?.map(x => x.name) ?? [];
  } catch {
    return [];
  }
}

function parseSig(sig) {
  const m = sig.match(/^([^(]+)\((.*)\)$/);
  if (!m) return null;
  const name = m[1];
  const raw = m[2];
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

function decodeWord(type, word) {
  if (type === "address") return "0x" + word.slice(24);
  if (type === "bool") return BigInt("0x" + word) === 0n ? "false" : "true";
  if (/^bytes(\d+)$/.test(type)) {
    const n = parseInt(RegExp.$1, 10);
    return "0x" + word.slice(0, n * 2);
  }
  if (/^uint(\d*)$/.test(type)) {
    return BigInt("0x" + word).toString();
  }
  if (/^int(\d*)$/.test(type)) {
    const bits = parseInt(RegExp.$1 || "256", 10);
    let v = BigInt("0x" + word);
    const max = 1n << BigInt(bits - 1);
    if (v >= max) v -= 1n << BigInt(bits);
    return v.toString();
  }
  return "0x" + word;
}

function decodeParams(types, body) {
  const words = [];
  for (let i = 0; i < body.length; i += 64) words.push(body.slice(i, i + 64));
  const out = [];
  const dyn = /\[\]$|^string$|^bytes$|^\(/;
  for (let i = 0; i < types.length; i++) {
    const t = types[i];
    const w = words[i];
    if (!w) { out.push({ type: t, value: "(missing)" }); continue; }
    if (dyn.test(t)) {
      const off = Number(BigInt("0x" + w));
      const tailStart = off * 2;
      const lenWord = body.slice(tailStart, tailStart + 64);
      if (lenWord) {
        const len = Number(BigInt("0x" + lenWord));
        const data = body.slice(tailStart + 64, tailStart + 64 + len * 2);
        if (t === "string") {
          try { out.push({ type: t, value: Buffer.from(data, "hex").toString("utf8") }); }
          catch { out.push({ type: t, value: "0x" + data }); }
        } else if (t === "bytes") {
          out.push({ type: t, value: "0x" + data });
        } else {
          out.push({ type: t, value: `len=${len} data=0x${data.slice(0, 128)}${data.length > 128 ? "…" : ""}` });
        }
      } else {
        out.push({ type: t, value: `(dynamic, offset=${off})` });
      }
    } else {
      out.push({ type: t, value: decodeWord(t, w) });
    }
  }
  return out;
}

// Decode an Error(string) revert: 4-byte selector + ABI-encoded string.
function decodeErrorString(hex) {
  const body = hex.slice(8);
  const params = decodeParams(["string"], body);
  return params[0]?.value ?? "(empty)";
}

// Decode a Panic(uint256) revert: 4-byte selector + uint256 code.
function decodePanic(hex) {
  const body = hex.slice(8);
  const codeHex = body.slice(0, 64);
  const code = Number(BigInt("0x" + codeHex));
  const meaning = PANIC_CODES[code] ?? `(unknown panic code 0x${code.toString(16).padStart(2, "0")})`;
  return { code: `0x${code.toString(16).padStart(2, "0")}`, meaning };
}

// Try to extract revert data from a JSON-RPC error response.
// Different RPC providers attach revert data in different places.
function extractRevertHex(rpcError) {
  if (!rpcError) return null;
  // Direct data field (geth-style)
  if (typeof rpcError.data === "string" && rpcError.data.startsWith("0x")) return rpcError.data;
  // Some providers wrap it like { data: { data: "0x..." } } or originalError
  if (rpcError.data && typeof rpcError.data === "object") {
    if (typeof rpcError.data.data === "string") return rpcError.data.data;
    if (typeof rpcError.data.originalError?.data === "string") return rpcError.data.originalError.data;
  }
  // Message-embedded: "execution reverted: ...; data: 0x..."
  const m = (rpcError.message || "").match(/0x[0-9a-fA-F]+/);
  if (m && m[0].length > 4) return m[0];
  return null;
}

async function fetchTxAndReplay(rpc, txHash) {
  // 1. Get the tx
  const txRes = await fetch(rpc, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getTransactionByHash", params: [txHash] }),
  });
  const txJson = await txRes.json();
  if (!txJson.result) throw new Error(`tx not found: ${JSON.stringify(txJson.error || txJson)}`);
  const tx = txJson.result;

  // 2. Get the receipt to confirm it failed
  const rcptRes = await fetch(rpc, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "eth_getTransactionReceipt", params: [txHash] }),
  });
  const rcptJson = await rcptRes.json();
  const receipt = rcptJson.result;
  const status = receipt?.status;

  // 3. Replay via eth_call at the block BEFORE the tx, to get revert data.
  const block = tx.blockNumber;
  const blockBefore = "0x" + (BigInt(block) - 1n).toString(16);
  const callRes = await fetch(rpc, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0", id: 3, method: "eth_call",
      params: [{
        from: tx.from,
        to: tx.to,
        gas: tx.gas,
        gasPrice: tx.gasPrice,
        value: tx.value,
        data: tx.input,
      }, blockBefore],
    }),
  });
  const callJson = await callRes.json();
  const revertHex = extractRevertHex(callJson.error);

  return {
    tx: { from: tx.from, to: tx.to, value: tx.value, blockNumber: tx.blockNumber, status },
    rpcError: callJson.error || null,
    revertHex,
  };
}

async function readStdin() {
  return new Promise(resolve => {
    let data = "";
    if (process.stdin.isTTY) return resolve("");
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", c => (data += c));
    process.stdin.on("end", () => resolve(data));
  });
}

async function decodeRevert(rawHex) {
  const hex = stripHex(rawHex);

  if (hex.length === 0) {
    return { kind: "empty", message: "empty revert (require() with no message, or out-of-gas)" };
  }
  if (hex.length < 8) {
    return { kind: "raw", message: `revert data too short for a selector: 0x${hex}` };
  }

  const selector = "0x" + hex.slice(0, 8);

  if (selector === ERROR_STRING_SELECTOR) {
    return { kind: "Error(string)", selector, reason: decodeErrorString(hex) };
  }
  if (selector === PANIC_SELECTOR) {
    const p = decodePanic(hex);
    return { kind: "Panic(uint256)", selector, panicCode: p.code, meaning: p.meaning };
  }

  // Custom error — lookup signature, decode params.
  const sigs = await lookupSelector(selector);
  const body = hex.slice(8);
  const matches = [];
  if (sigs.length === 0) {
    matches.push({ signature: null, note: "no known custom error for this selector" });
  } else {
    for (const sig of sigs) {
      const parsed = parseSig(sig);
      if (!parsed) { matches.push({ signature: sig }); continue; }
      const params = decodeParams(parsed.types, body);
      matches.push({ signature: sig, name: parsed.name, params });
    }
  }
  return { kind: "custom-error", selector, bodyBytes: body.length / 2, matches, rawBody: body };
}

async function main() {
  const args = process.argv.slice(2);
  let raw = "";
  let txHash = null;
  let rpc = process.env.RPC_URL || "https://mainnet.base.org";
  let asJson = false;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--tx") txHash = args[++i];
    else if (a === "--rpc") rpc = args[++i];
    else if (a === "--json") asJson = true;
    else if (a === "-h" || a === "--help") {
      console.log("Usage: decode.mjs <hex> | --tx <hash> [--rpc <url>] [--json]");
      process.exit(0);
    } else if (!raw) raw = a;
  }

  let txMeta = null;
  let rpcError = null;

  if (txHash) {
    const r = await fetchTxAndReplay(rpc, txHash);
    txMeta = r.tx;
    rpcError = r.rpcError;
    if (r.revertHex) raw = r.revertHex;
    else if (txMeta.status === "0x1") {
      // Tx succeeded — nothing to decode.
      const out = { tx: txMeta, note: "tx did not revert (status=0x1)" };
      console.log(asJson ? JSON.stringify(out, null, 2) : `tx ${txHash} did not revert (status=0x1).`);
      return;
    } else {
      const out = { tx: txMeta, rpcError, note: "no revert data exposed by RPC (try a node with debug_traceTransaction)" };
      if (asJson) console.log(JSON.stringify(out, null, 2));
      else {
        console.log(`tx: from=${txMeta.from}  to=${txMeta.to}  status=${txMeta.status}`);
        console.log("no revert data exposed by RPC. Replay with debug_traceTransaction on a node that supports it.");
        if (rpcError?.message) console.log("rpc error message:", rpcError.message);
      }
      return;
    }
  }

  if (!raw) raw = (await readStdin()).trim();
  if (!raw) {
    console.error("error: no revert data. Pass hex, pipe to stdin, or use --tx <hash>.");
    process.exit(1);
  }

  const decoded = await decodeRevert(raw);
  const result = { tx: txMeta, ...decoded };

  if (asJson) { console.log(JSON.stringify(result, null, 2)); return; }

  if (txMeta) console.log(`tx: from=${txMeta.from}  to=${txMeta.to}  status=${txMeta.status}`);

  switch (decoded.kind) {
    case "empty":
      console.log(decoded.message);
      break;
    case "raw":
      console.log(decoded.message);
      break;
    case "Error(string)":
      console.log(`Error(string)  ${decoded.selector}`);
      console.log(`  reason: ${JSON.stringify(decoded.reason)}`);
      break;
    case "Panic(uint256)":
      console.log(`Panic(uint256) ${decoded.selector}`);
      console.log(`  code:    ${decoded.panicCode}`);
      console.log(`  meaning: ${decoded.meaning}`);
      break;
    case "custom-error":
      console.log(`custom error  selector=${decoded.selector}  (${decoded.bodyBytes} bytes of params)`);
      for (const m of decoded.matches) {
        if (!m.signature) { console.log(`  ${m.note}`); continue; }
        console.log(`\n  ${m.signature}`);
        if (!m.params) continue;
        for (let i = 0; i < m.params.length; i++) {
          console.log(`    [${i}] ${m.params[i].type.padEnd(10)} = ${m.params[i].value}`);
        }
      }
      if (decoded.matches.every(m => !m.signature) && decoded.rawBody) {
        console.log("\nraw params (32-byte words):");
        for (let i = 0; i < decoded.rawBody.length; i += 64) {
          console.log(`  [${i / 64}] 0x${decoded.rawBody.slice(i, i + 64)}`);
        }
      }
      break;
  }
}

main().catch(e => { console.error("error:", e.message); process.exit(1); });
