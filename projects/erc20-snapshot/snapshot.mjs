#!/usr/bin/env node
// erc20-snapshot — zero-dep holder balance snapshot for any EVM ERC-20.
//
// Usage:
//   node snapshot.mjs --token 0xToken --block 12345678 [--rpc URL] [--start 0] [--step 5000] [--out file]
//
// Default RPC is Base mainnet. Walks Transfer logs to derive the holder set,
// then batches eth_call balanceOf(holder) at the target block. Emits CSV (default)
// or JSON to stdout (or --out path).

const TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const k = a.slice(2);
    const v = argv[i + 1];
    if (v && !v.startsWith("--")) {
      out[k] = v;
      i++;
    } else {
      out[k] = true;
    }
  }
  return out;
}

function hex(n) {
  return "0x" + BigInt(n).toString(16);
}

function pad32(addrLike) {
  const h = addrLike.toLowerCase().replace(/^0x/, "");
  return "0x" + h.padStart(64, "0");
}

function topicToAddress(t) {
  return "0x" + t.slice(-40).toLowerCase();
}

async function rpc(url, method, params, id = 1) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
    });
    if (res.status === 429 || res.status === 503) {
      await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
      continue;
    }
    if (!res.ok) throw new Error(`RPC ${method} HTTP ${res.status}`);
    const j = await res.json();
    if (j.error) throw new Error(`RPC ${method}: ${j.error.message}`);
    return j.result;
  }
  throw new Error(`RPC ${method} rate-limited after retries`);
}

async function rpcBatch(url, calls) {
  const body = calls.map((c, i) => ({
    jsonrpc: "2.0",
    id: i,
    method: c.method,
    params: c.params,
  }));
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`RPC batch HTTP ${res.status}`);
  const parsed = await res.json();
  if (!Array.isArray(parsed)) {
    // RPC doesn't support batching — fall back to sequential calls.
    const out = [];
    for (const c of calls) out.push(await rpc(url, c.method, c.params));
    return out;
  }
  return parsed
    .sort((a, b) => a.id - b.id)
    .map((r) => {
      if (r.error) throw new Error(`RPC batch item ${r.id}: ${r.error.message}`);
      return r.result;
    });
}

async function getLogsRanged(url, address, fromBlock, toBlock, step) {
  const holders = new Set();
  let from = BigInt(fromBlock);
  const end = BigInt(toBlock);
  const stride = BigInt(step);
  let scanned = 0;
  while (from <= end) {
    const to = from + stride - 1n > end ? end : from + stride - 1n;
    let logs;
    try {
      logs = await rpc(url, "eth_getLogs", [
        {
          address,
          topics: [TRANSFER_TOPIC],
          fromBlock: hex(from),
          toBlock: hex(to),
        },
      ]);
    } catch (e) {
      // Many RPCs cap range; halve and retry once.
      const mid = from + (to - from) / 2n;
      const left = await rpc(url, "eth_getLogs", [
        { address, topics: [TRANSFER_TOPIC], fromBlock: hex(from), toBlock: hex(mid) },
      ]);
      const right = await rpc(url, "eth_getLogs", [
        { address, topics: [TRANSFER_TOPIC], fromBlock: hex(mid + 1n), toBlock: hex(to) },
      ]);
      logs = [...left, ...right];
    }
    for (const l of logs) {
      if (l.topics.length >= 3) {
        holders.add(topicToAddress(l.topics[1]));
        holders.add(topicToAddress(l.topics[2]));
      }
    }
    scanned += Number(to - from + 1n);
    process.stderr.write(
      `\rscanned ${scanned} blocks · ${holders.size} unique addresses`
    );
    from = to + 1n;
  }
  process.stderr.write("\n");
  holders.delete("0x0000000000000000000000000000000000000000");
  return [...holders];
}

async function balancesAt(url, token, holders, block, batchSize = 100) {
  const blockTag = hex(block);
  const balances = {};
  for (let i = 0; i < holders.length; i += batchSize) {
    const chunk = holders.slice(i, i + batchSize);
    const calls = chunk.map((h) => ({
      method: "eth_call",
      params: [
        { to: token, data: "0x70a08231" + pad32(h).slice(2) },
        blockTag,
      ],
    }));
    const results = await rpcBatch(url, calls);
    chunk.forEach((h, idx) => {
      balances[h] = BigInt(results[idx] || "0x0");
    });
    process.stderr.write(
      `\rbalances ${Math.min(i + batchSize, holders.length)}/${holders.length}`
    );
  }
  process.stderr.write("\n");
  return balances;
}

async function readDecimals(url, token) {
  try {
    const r = await rpc(url, "eth_call", [
      { to: token, data: "0x313ce567" },
      "latest",
    ]);
    return Number(BigInt(r));
  } catch {
    return 18;
  }
}

function fmtAmount(raw, decimals) {
  const s = raw.toString().padStart(decimals + 1, "0");
  const intPart = s.slice(0, s.length - decimals) || "0";
  const fracPart = s.slice(s.length - decimals).replace(/0+$/, "");
  return fracPart ? `${intPart}.${fracPart}` : intPart;
}

async function main() {
  const args = parseArgs(process.argv);
  const token = args.token;
  const block = args.block;
  if (!token || !block) {
    console.error(
      "usage: node snapshot.mjs --token 0x... --block N [--rpc URL] [--start 0] [--step 5000] [--out file] [--json]"
    );
    process.exit(1);
  }
  const url = args.rpc || "https://mainnet.base.org";
  const start = args.start ? BigInt(args.start) : 0n;
  const step = args.step ? Number(args.step) : 5000;
  const decimals = await readDecimals(url, token);

  process.stderr.write(`token ${token} · block ${block} · decimals ${decimals}\n`);

  const holders = await getLogsRanged(url, token, start, BigInt(block), step);
  const balances = await balancesAt(url, token, holders, BigInt(block));

  const rows = Object.entries(balances)
    .filter(([, v]) => v > 0n)
    .sort((a, b) => (b[1] > a[1] ? 1 : b[1] < a[1] ? -1 : 0));

  let output;
  if (args.json) {
    output = JSON.stringify(
      {
        token,
        block: Number(block),
        decimals,
        holders: rows.length,
        balances: rows.map(([addr, raw]) => ({
          address: addr,
          raw: raw.toString(),
          amount: fmtAmount(raw, decimals),
        })),
      },
      null,
      2
    );
  } else {
    output =
      "address,raw,amount\n" +
      rows
        .map(([a, r]) => `${a},${r.toString()},${fmtAmount(r, decimals)}`)
        .join("\n");
  }

  if (args.out) {
    const fs = await import("node:fs/promises");
    await fs.writeFile(args.out, output);
    process.stderr.write(`wrote ${rows.length} holders → ${args.out}\n`);
  } else {
    process.stdout.write(output + "\n");
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
