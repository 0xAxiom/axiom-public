#!/usr/bin/env node
// erc20-burn-stats — count ERC-20 burns by scanning Transfer logs to a dead address.
// Zero deps. Node 18+. Pure JSON-RPC (eth_getLogs).
//
// Usage:
//   node burn-stats.mjs --token 0xADDR [--rpc URL] [--dead 0xADDR]
//       [--from BLOCK] [--to BLOCK|latest] [--chunk N] [--json]
//
// Defaults:
//   --rpc    https://mainnet.base.org
//   --dead   0x000000000000000000000000000000000000dEaD
//   --from   0 (auto-bumps to earliest log if RPC complains)
//   --to     latest
//   --chunk  10000
//
// Examples:
//   node burn-stats.mjs --token 0xf3Ce5d... --rpc https://mainnet.base.org
//   node burn-stats.mjs --token 0xTOKEN --dead 0x0000000000000000000000000000000000000000

const TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

function parseArgs(argv) {
  const out = {
    rpc: "https://mainnet.base.org",
    dead: "0x000000000000000000000000000000000000dEaD",
    from: "auto",
    to: "latest",
    chunk: 10000,
    json: false,
    token: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === "--token") out.token = next();
    else if (a === "--rpc") out.rpc = next();
    else if (a === "--dead") out.dead = next();
    else if (a === "--from") {
      const v = next();
      out.from = v === "auto" ? "auto" : parseInt(v, 10);
    }
    else if (a === "--to") {
      const v = next();
      out.to = v === "latest" ? "latest" : parseInt(v, 10);
    } else if (a === "--chunk") out.chunk = parseInt(next(), 10);
    else if (a === "--json") out.json = true;
    else if (a === "-h" || a === "--help") {
      console.log(USAGE);
      process.exit(0);
    } else {
      console.error(`unknown arg: ${a}`);
      process.exit(2);
    }
  }
  return out;
}

const USAGE = `erc20-burn-stats — count ERC-20 burns to a dead address.

Usage:
  node burn-stats.mjs --token 0xADDR [--rpc URL] [--dead 0xADDR]
      [--from BLOCK] [--to BLOCK|latest] [--chunk N] [--json]

Defaults: rpc=https://mainnet.base.org dead=0x...dEaD from=auto to=latest chunk=10000
(--from=auto binary-searches for the contract's deployment block)`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let _id = 1;
async function rpc(url, method, params) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: _id++, method, params }),
    });
    const text = await res.text();
    if (res.status === 429) {
      await sleep(500 * 2 ** attempt);
      continue;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status} ${text}`);
    let j;
    try {
      j = JSON.parse(text);
    } catch {
      throw new Error(`bad json: ${text.slice(0, 200)}`);
    }
    if (j.error) {
      const msg = (j.error && j.error.message) || JSON.stringify(j.error);
      if (/rate limit|too many|429/i.test(msg)) {
        await sleep(500 * 2 ** attempt);
        continue;
      }
      throw new Error(`${method}: ${msg}`);
    }
    return j.result;
  }
  throw new Error(`${method}: gave up after 5 retries (rate-limited)`);
}

async function findDeployBlock(rpcUrl, addr, latest) {
  let lo = 1,
    hi = latest;
  const has = async (b) => {
    const code = await rpc(rpcUrl, "eth_getCode", [
      addr,
      "0x" + b.toString(16),
    ]);
    return code && code !== "0x";
  };
  if (!(await has(hi))) throw new Error(`no code at ${addr} on latest block`);
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (await has(mid)) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

function pad32(addr) {
  const h = addr.toLowerCase().replace(/^0x/, "");
  if (h.length !== 40) throw new Error(`bad address: ${addr}`);
  return "0x" + "0".repeat(24) + h;
}

function hexToBigInt(hex) {
  return BigInt(hex && hex !== "0x" ? hex : "0x0");
}

function formatUnits(bi, decimals) {
  const neg = bi < 0n;
  let s = (neg ? -bi : bi).toString().padStart(decimals + 1, "0");
  const i = s.length - decimals;
  const whole = s.slice(0, i);
  const frac = s.slice(i).replace(/0+$/, "");
  return (neg ? "-" : "") + (frac ? `${whole}.${frac}` : whole);
}

async function ethCall(rpcUrl, to, data) {
  return rpc(rpcUrl, "eth_call", [{ to, data }, "latest"]);
}

// Decode ABI-encoded string (offset, length, bytes)
function decodeString(hex) {
  if (!hex || hex === "0x") return "";
  const h = hex.replace(/^0x/, "");
  // skip first 32-byte offset, read length, then bytes
  const len = parseInt(h.slice(64, 128), 16);
  const bytes = h.slice(128, 128 + len * 2);
  return Buffer.from(bytes, "hex").toString("utf8");
}

async function getTokenMeta(rpcUrl, token) {
  // symbol() 0x95d89b41, name() 0x06fdde03, decimals() 0x313ce567, totalSupply() 0x18160ddd
  let symbol = "?",
    name = "?",
    decimals = 18,
    totalSupply = 0n;
  try {
    symbol = decodeString(await ethCall(rpcUrl, token, "0x95d89b41"));
  } catch {}
  try {
    name = decodeString(await ethCall(rpcUrl, token, "0x06fdde03"));
  } catch {}
  try {
    const d = await ethCall(rpcUrl, token, "0x313ce567");
    decimals = Number(hexToBigInt(d));
  } catch {}
  try {
    const ts = await ethCall(rpcUrl, token, "0x18160ddd");
    totalSupply = hexToBigInt(ts);
  } catch {}
  return { symbol, name, decimals, totalSupply };
}

async function getLogsChunked({ rpcUrl, token, deadTopic, from, to, chunk }) {
  const events = [];
  let cursor = from;
  let stride = chunk;
  while (cursor <= to) {
    const end = Math.min(cursor + stride - 1, to);
    try {
      const logs = await rpc(rpcUrl, "eth_getLogs", [
        {
          fromBlock: "0x" + cursor.toString(16),
          toBlock: "0x" + end.toString(16),
          address: token,
          topics: [TRANSFER_TOPIC, null, deadTopic],
        },
      ]);
      for (const l of logs) {
        events.push({
          block: parseInt(l.blockNumber, 16),
          tx: l.transactionHash,
          from: "0x" + l.topics[1].slice(26),
          amount: hexToBigInt(l.data),
        });
      }
      cursor = end + 1;
      // gently widen stride after a clean chunk
      if (stride < chunk) stride = Math.min(stride * 2, chunk);
    } catch (e) {
      const msg = String(e.message || e);
      // Many providers cap at 10k blocks / 10k logs / 5s — back off.
      if (stride > 1) {
        stride = Math.max(1, Math.floor(stride / 2));
        process.stderr.write(
          `  RPC pushback at ${cursor}-${end}, halving stride to ${stride}\n`
        );
        continue;
      }
      throw new Error(`eth_getLogs failed at block ${cursor}: ${msg}`);
    }
  }
  return events;
}

async function getBlockTime(rpcUrl, blockNumber) {
  const b = await rpc(rpcUrl, "eth_getBlockByNumber", [
    "0x" + blockNumber.toString(16),
    false,
  ]);
  return parseInt(b.timestamp, 16);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.token) {
    console.error(USAGE);
    process.exit(2);
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(args.token)) {
    console.error(`bad --token: ${args.token}`);
    process.exit(2);
  }

  const log = (...m) => {
    if (!args.json) console.error(...m);
  };

  log(`token: ${args.token}`);
  log(`rpc:   ${args.rpc}`);
  log(`dead:  ${args.dead}`);

  const meta = await getTokenMeta(args.rpc, args.token);
  log(`meta:  ${meta.name} (${meta.symbol}) decimals=${meta.decimals}`);

  const latestHex = await rpc(args.rpc, "eth_blockNumber", []);
  const latest = parseInt(latestHex, 16);
  const to = args.to === "latest" ? latest : args.to;

  let from = args.from;
  if (from === "auto") {
    log(`from:  auto — binary-searching deployment block...`);
    from = await findDeployBlock(args.rpc, args.token, to);
    log(`from:  ${from} (token deployed here)`);
  }
  log(`scan:  blocks ${from} → ${to} (chunk=${args.chunk})`);

  const deadTopic = pad32(args.dead);
  const events = await getLogsChunked({
    rpcUrl: args.rpc,
    token: args.token,
    deadTopic,
    from,
    to,
    chunk: args.chunk,
  });

  const total = events.reduce((acc, e) => acc + e.amount, 0n);
  const first = events[0];
  const last = events[events.length - 1];

  let firstTime = null,
    lastTime = null;
  if (first) firstTime = await getBlockTime(args.rpc, first.block);
  if (last && last !== first) lastTime = await getBlockTime(args.rpc, last.block);
  else if (first) lastTime = firstTime;

  const supplyPct =
    meta.totalSupply > 0n
      ? Number((total * 1_000_000n) / (meta.totalSupply + total)) / 10_000
      : null;

  const result = {
    token: args.token,
    symbol: meta.symbol,
    name: meta.name,
    decimals: meta.decimals,
    dead: args.dead,
    rpc: args.rpc,
    scanned: { from, to },
    burn_event_count: events.length,
    burned_raw: total.toString(),
    burned: formatUnits(total, meta.decimals),
    current_total_supply_raw: meta.totalSupply.toString(),
    current_total_supply: formatUnits(meta.totalSupply, meta.decimals),
    burned_pct_of_original_supply: supplyPct, // burned / (supply + burned)
    first_burn: first
      ? { block: first.block, tx: first.tx, timestamp: firstTime, iso: firstTime ? new Date(firstTime * 1000).toISOString() : null }
      : null,
    last_burn: last
      ? { block: last.block, tx: last.tx, timestamp: lastTime, iso: lastTime ? new Date(lastTime * 1000).toISOString() : null }
      : null,
  };

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log("");
    console.log(`burn events:     ${result.burn_event_count}`);
    console.log(`total burned:    ${result.burned} ${meta.symbol}`);
    console.log(`current supply:  ${result.current_total_supply} ${meta.symbol}`);
    if (supplyPct !== null)
      console.log(`% of original:   ${supplyPct.toFixed(4)}%`);
    if (result.first_burn)
      console.log(
        `first burn:      block ${result.first_burn.block}  (${result.first_burn.iso})`
      );
    if (result.last_burn)
      console.log(
        `last burn:       block ${result.last_burn.block}  (${result.last_burn.iso})`
      );
  }
}

main().catch((e) => {
  console.error(`error: ${e.message || e}`);
  process.exit(1);
});
