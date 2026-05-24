#!/usr/bin/env node
// calldata-decoder — turn raw EVM tx input into a human-readable function call.
// Zero deps. Uses openchain.xyz signature database to resolve 4-byte selectors.
//
// Usage:
//   node decode.mjs 0xa9059cbb000000000000000000000000ab5801a7d398351b8be11c439e05c5b3259aec9b0000000000000000000000000000000000000000000000000de0b6b3a7640000
//   echo 0xa9059cbb... | node decode.mjs
//   node decode.mjs --tx 0x<txhash> --rpc https://mainnet.base.org

const API = "https://api.openchain.xyz/signature-database/v1/lookup";

function stripHex(s) {
  s = s.trim();
  if (s.startsWith("0x") || s.startsWith("0X")) s = s.slice(2);
  return s.toLowerCase();
}

async function lookupSelector(selector) {
  const url = `${API}?function=${selector}&filter=true`;
  const res = await fetch(url, { headers: { "user-agent": "calldata-decoder/1.0" } });
  if (!res.ok) return [];
  const j = await res.json();
  return j?.result?.function?.[selector]?.map(x => x.name) ?? [];
}

// Parse a function signature like "transfer(address,uint256)" into type list.
// Returns null for nested tuples/arrays we won't try to decode strictly.
function parseSig(sig) {
  const m = sig.match(/^([^(]+)\((.*)\)$/);
  if (!m) return null;
  const name = m[1];
  const raw = m[2];
  if (!raw) return { name, types: [] };
  // Best-effort split on top-level commas.
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

// Decode a single 32-byte word as the requested type. Returns string.
// Supports: address, bool, uint*, int*, bytes32. Anything else → raw word.
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
  return "0x" + word; // dynamic / tuple / unknown → show raw word
}

// Decode params best-effort. For dynamic types (string, bytes, T[]) we show
// the offset word and then a hex dump of the tail; not perfect, but useful.
function decodeParams(types, body) {
  // body is hex without selector. Split into 32-byte words.
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
      const tailStart = off * 2; // bytes -> hex chars
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

async function fetchTxInput(rpc, txHash) {
  const res = await fetch(rpc, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getTransactionByHash", params: [txHash] }),
  });
  const j = await res.json();
  if (!j.result) throw new Error(`tx not found on ${rpc}: ${JSON.stringify(j.error || j)}`);
  return { input: j.result.input, to: j.result.to, value: j.result.value, from: j.result.from };
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

async function main() {
  const args = process.argv.slice(2);
  let calldata = "";
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
    } else if (!calldata) calldata = a;
  }

  let txMeta = null;
  if (txHash) {
    txMeta = await fetchTxInput(rpc, txHash);
    calldata = txMeta.input;
  }
  if (!calldata) calldata = (await readStdin()).trim();
  if (!calldata) {
    console.error("error: no calldata. Pass hex as arg, pipe to stdin, or use --tx <hash>.");
    process.exit(1);
  }

  const hex = stripHex(calldata);
  if (hex.length < 8) {
    console.error("error: calldata too short for a 4-byte selector");
    process.exit(1);
  }
  const selector = "0x" + hex.slice(0, 8);
  const body = hex.slice(8);

  const sigs = await lookupSelector(selector);
  const result = {
    selector,
    bodyBytes: body.length / 2,
    matches: [],
    tx: txMeta,
  };

  if (sigs.length === 0) {
    result.matches.push({ signature: null, name: null, params: null, note: "no known signature for selector" });
  } else {
    for (const sig of sigs) {
      const parsed = parseSig(sig);
      if (!parsed) { result.matches.push({ signature: sig, params: null }); continue; }
      const params = decodeParams(parsed.types, body);
      result.matches.push({ signature: sig, name: parsed.name, params });
    }
  }

  if (asJson) { console.log(JSON.stringify(result, null, 2)); return; }

  console.log(`selector: ${selector}    (${result.bodyBytes} bytes of params)`);
  if (txMeta) console.log(`tx: from=${txMeta.from}  to=${txMeta.to}  value=${BigInt(txMeta.value).toString()} wei`);
  if (sigs.length === 0) {
    console.log("(no known signature — selector not in openchain.xyz database)");
    if (body) {
      console.log("\nraw params (32-byte words):");
      for (let i = 0; i < body.length; i += 64) console.log(`  [${i / 64}] 0x${body.slice(i, i + 64)}`);
    }
    return;
  }
  for (const m of result.matches) {
    console.log(`\n  ${m.signature}`);
    if (!m.params) { console.log("    (could not parse signature)"); continue; }
    for (let i = 0; i < m.params.length; i++) {
      console.log(`    [${i}] ${m.params[i].type.padEnd(10)} = ${m.params[i].value}`);
    }
  }
}

main().catch(e => { console.error("error:", e.message); process.exit(1); });
