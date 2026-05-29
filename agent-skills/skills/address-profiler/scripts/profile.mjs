#!/usr/bin/env node
// address-profiler — quick profile of any EVM address.
// Zero deps. Node 18+. Pure JSON-RPC.
//
// Returns: balance, nonce (tx count), contract status, ERC-20 top holdings,
// and recent block activity. Works on Base, Ethereum, or any EVM chain.
//
// Usage:
//   node profile.mjs 0xADDRESS
//   node profile.mjs 0xADDRESS --chain mainnet
//   node profile.mjs 0xADDRESS --tokens USDC,WETH,DAI
//   node profile.mjs 0xADDRESS --json
//   node profile.mjs 0xADDRESS --full

const RPCS = {
  base: "https://mainnet.base.org",
  mainnet: "https://eth.llamarpc.com",
};

// Well-known ERC-20s per chain
const TOKENS = {
  base: {
    USDC: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    WETH: "0x4200000000000000000000000000000000000006",
    DAI: "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb",
    USDbC: "0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6Ca",
    cbETH: "0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22",
    DEGEN: "0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed",
    AERO: "0x940181a94A35A4569E4529A3CDfB74e38FD98631",
    BRETT: "0x532f27101965dd16442E59d40670FaF5eBB142E4",
  },
  mainnet: {
    USDC: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    WETH: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
    DAI: "0x6B175474E89094C44Da98b954EedeAC495271d0F",
    USDT: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
    WBTC: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599",
    LINK: "0x514910771AF9Ca656af840dff83E8264EcF986CA",
  },
};

// ERC-20 balanceOf(address) selector
const BAL_OF = "0x70a08231";
// ERC-20 decimals() selector
const DECIMALS = "0x313ce567";
// ERC-20 symbol() selector
const SYMBOL = "0x95d89b41";

// ─── RPC helpers ───

let rpcId = 0;
async function rpc(url, method, params) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error.message);
  return json.result;
}

async function rpcBatch(url, calls) {
  const batch = calls.map((c, i) => ({
    jsonrpc: "2.0",
    id: i + 1,
    method: c.method,
    params: c.params,
  }));
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(batch),
  });
  const json = await res.json();
  // Sort by id to maintain order
  return Array.isArray(json) ? json.sort((a, b) => a.id - b.id) : [json];
}

function padAddr(addr) {
  return addr.slice(2).toLowerCase().padStart(64, "0");
}

function formatEth(weiHex) {
  const wei = BigInt(weiHex);
  const eth = Number(wei) / 1e18;
  if (eth === 0) return "0 ETH";
  if (eth < 0.0001) return `${eth.toExponential(2)} ETH`;
  if (eth < 1) return `${eth.toFixed(4)} ETH`;
  return `${eth.toFixed(4)} ETH`;
}

function formatToken(rawHex, decimals) {
  const raw = BigInt(rawHex);
  if (raw === 0n) return 0;
  return Number(raw) / 10 ** decimals;
}

// ─── profiling ───

async function profileAddress(rpcUrl, address, chain, opts) {
  const padded = padAddr(address);
  const profile = { address, chain };

  // Batch: balance, nonce, code, block number
  const batch = await rpcBatch(rpcUrl, [
    { method: "eth_getBalance", params: [address, "latest"] },
    { method: "eth_getTransactionCount", params: [address, "latest"] },
    { method: "eth_getCode", params: [address, "latest"] },
    { method: "eth_blockNumber", params: [] },
  ]);

  // Handle batch errors (rate limits, etc)
  for (const r of batch) {
    if (r.error) throw new Error(`RPC batch error: ${r.error.message}`);
  }

  const balHex = batch[0].result;
  const nonceHex = batch[1].result;
  const code = batch[2].result;
  const blockHex = batch[3].result;

  profile.balance = { wei: BigInt(balHex).toString(), formatted: formatEth(balHex) };
  profile.nonce = Number(BigInt(nonceHex));
  profile.isContract = code && code !== "0x" && code.length > 2;
  profile.codeSize = profile.isContract ? Math.floor((code.length - 2) / 2) : 0;
  profile.currentBlock = Number(BigInt(blockHex));

  // Token balances
  const tokenList = TOKENS[chain] || {};
  const selectedTokens = opts.tokens
    ? Object.fromEntries(
        opts.tokens
          .split(",")
          .map((t) => t.trim().toUpperCase())
          .filter((t) => tokenList[t])
          .map((t) => [t, tokenList[t]])
      )
    : tokenList;

  if (Object.keys(selectedTokens).length > 0) {
    const tokenCalls = Object.entries(selectedTokens).flatMap(([sym, addr]) => [
      { method: "eth_call", params: [{ to: addr, data: BAL_OF + padded }, "latest"] },
      { method: "eth_call", params: [{ to: addr, data: DECIMALS }, "latest"] },
    ]);

    let tokenResults;
    try {
      tokenResults = await rpcBatch(rpcUrl, tokenCalls);
    } catch {
      tokenResults = [];
    }
    profile.tokens = {};

    const entries = Object.entries(selectedTokens);
    for (let i = 0; i < entries.length; i++) {
      const [sym] = entries[i];
      const balResult = tokenResults[i * 2];
      const decResult = tokenResults[i * 2 + 1];
      if (!balResult || !decResult) continue;
      if (balResult.error || decResult.error) continue;
      const decimals = Number(BigInt(decResult.result || "0x0"));
      const balance = formatToken(balResult.result || "0x0", decimals);
      if (balance > 0) {
        profile.tokens[sym] = { balance, decimals };
      }
    }
  }

  // Recent activity: check last 100 blocks for logs from/to this address
  if (opts.full) {
    const fromBlock = "0x" + (profile.currentBlock - 100).toString(16);
    const toBlock = "latest";
    try {
      const logs = await rpc(rpcUrl, "eth_getLogs", [
        { fromBlock, toBlock, topics: [null, "0x" + padded] },
      ]);
      profile.recentIncoming = Array.isArray(logs) ? logs.length : 0;
    } catch {
      profile.recentIncoming = "query_failed";
    }
    try {
      const logs = await rpc(rpcUrl, "eth_getLogs", [
        { fromBlock, toBlock, topics: [null, null, "0x" + padded] },
      ]);
      profile.recentOutgoing = Array.isArray(logs) ? logs.length : 0;
    } catch {
      profile.recentOutgoing = "query_failed";
    }
  }

  return profile;
}

// ─── output ───

function printProfile(p) {
  console.log(`\n  Address:  ${p.address}`);
  console.log(`  Chain:    ${p.chain}`);
  console.log(`  Balance:  ${p.balance.formatted}`);
  console.log(`  Nonce:    ${p.nonce} tx${p.nonce !== 1 ? "s" : ""}`);
  console.log(`  Type:     ${p.isContract ? `Contract (${p.codeSize} bytes)` : "EOA"}`);

  if (p.tokens && Object.keys(p.tokens).length > 0) {
    console.log(`  Tokens:`);
    for (const [sym, data] of Object.entries(p.tokens)) {
      const val = data.balance < 0.01 ? data.balance.toExponential(2) : data.balance.toLocaleString(undefined, { maximumFractionDigits: 4 });
      console.log(`    ${sym.padEnd(8)} ${val}`);
    }
  }

  if (p.recentIncoming !== undefined) {
    console.log(`  Recent (100 blocks):`);
    console.log(`    Incoming events: ${p.recentIncoming}`);
    console.log(`    Outgoing events: ${p.recentOutgoing}`);
  }
  console.log();
}

// ─── CLI ───

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    console.log(`address-profiler — quick profile of any EVM address

Usage:
  profile 0xADDRESS                    Basic profile (balance, nonce, type, tokens)
  profile 0xADDRESS --chain mainnet    Use Ethereum mainnet (default: base)
  profile 0xADDRESS --tokens USDC,WETH Only check specific tokens
  profile 0xADDRESS --full             Include recent block activity
  profile 0xADDRESS --json             JSON output
  profile addr1 addr2 addr3            Multiple addresses

Supported chains: ${Object.keys(RPCS).join(", ")}
Default tokens (Base): ${Object.keys(TOKENS.base).join(", ")}`);
    process.exit(0);
  }

  let chain = "base";
  let jsonOut = false;
  let full = false;
  let tokens = null;
  const addresses = [];

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--chain" && args[i + 1]) { chain = args[++i]; continue; }
    if (a === "--rpc" && args[i + 1]) { RPCS[chain] = args[++i]; continue; }
    if (a === "--tokens" && args[i + 1]) { tokens = args[++i]; continue; }
    if (a === "--json") { jsonOut = true; continue; }
    if (a === "--full") { full = true; continue; }
    if (a.startsWith("0x") && a.length === 42) { addresses.push(a); continue; }
    console.error(`Unknown: ${a}`);
    process.exit(1);
  }

  const rpcUrl = RPCS[chain];
  if (!rpcUrl) {
    console.error(`Unknown chain: ${chain}. Available: ${Object.keys(RPCS).join(", ")}`);
    process.exit(1);
  }

  if (addresses.length === 0) {
    console.error("No address provided.");
    process.exit(1);
  }

  const results = [];
  for (const addr of addresses) {
    try {
      results.push(await profileAddress(rpcUrl, addr, chain, { full, tokens }));
    } catch (err) {
      results.push({ address: addr, chain, error: err.message });
    }
  }

  if (jsonOut) {
    console.log(JSON.stringify(results.length === 1 ? results[0] : results, null, 2));
  } else {
    for (const r of results) {
      if (r.error) { console.log(`${r.address}: ERROR — ${r.error}`); continue; }
      printProfile(r);
    }
  }
}

main().catch((err) => {
  console.error(`Fatal: ${err.message}`);
  process.exit(1);
});
