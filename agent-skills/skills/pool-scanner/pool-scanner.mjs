#!/usr/bin/env node
// pool-scanner — find Uniswap V2/V3 liquidity pools for any token on Base.
// Zero deps. Uses eth_call + eth_getLogs against public RPCs.
//
// Usage:
//   node pool-scanner.mjs 0xTokenAddress                # scan Base for pools
//   node pool-scanner.mjs 0xToken --chain mainnet        # scan Ethereum
//   node pool-scanner.mjs 0xToken --json                 # JSON output
//   node pool-scanner.mjs 0xToken --v2-only              # only V2 pools
//   node pool-scanner.mjs 0xToken --v3-only              # only V3 pools

import { createHash } from "node:crypto";
import https from "node:https";
import http from "node:http";

const CHAINS = {
  base: {
    rpc: "https://mainnet.base.org",
    name: "Base",
    explorer: "https://basescan.org",
    v2Factory: "0x8909Dc15e40173Ff4699343b6eB8132c65e18eC6", // Uniswap V2 on Base
    v3Factory: "0x33128a8fC17869897dcE68Ed026d694621f6FDfD", // Uniswap V3 on Base
    weth: "0x4200000000000000000000000000000000000006",
    usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    stables: {
      "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913": { symbol: "USDC", decimals: 6 },
      "0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA": { symbol: "USDbC", decimals: 6 },
      "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb": { symbol: "DAI", decimals: 18 },
    },
  },
  mainnet: {
    rpc: "https://eth.llamarpc.com",
    name: "Ethereum",
    explorer: "https://etherscan.io",
    v2Factory: "0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f",
    v3Factory: "0x1F98431c8aD98523631AE4a59f267346ea31F984",
    weth: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
    usdc: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    stables: {
      "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48": { symbol: "USDC", decimals: 6 },
      "0xdAC17F958D2ee523a2206206994597C13D831ec7": { symbol: "USDT", decimals: 6 },
      "0x6B175474E89094C44Da98b954EedeAC495271d0F": { symbol: "DAI", decimals: 18 },
    },
  },
};

const V3_FEE_TIERS = [100, 500, 3000, 10000];

const ZERO_ADDR = "0x0000000000000000000000000000000000000000";

// ── RPC helpers ──

let rpcId = 1;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function rpcCallOnce(url, method, params) {
  const body = JSON.stringify({ jsonrpc: "2.0", id: rpcId++, method, params });
  const parsed = new URL(url);
  const transport = parsed.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const req = transport.request(
      { hostname: parsed.hostname, port: parsed.port, path: parsed.pathname + parsed.search, method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) } },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          try {
            const j = JSON.parse(data);
            if (j.error) reject(new Error(j.error.message));
            else resolve(j.result);
          } catch (e) { reject(e); }
        });
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

async function rpcCall(url, method, params, retries = 4) {
  for (let i = 0; i < retries; i++) {
    try {
      return await rpcCallOnce(url, method, params);
    } catch (e) {
      if (i < retries - 1 && /rate limit/i.test(e.message)) {
        await sleep(1000 * 2 ** i);
        continue;
      }
      throw e;
    }
  }
}

function ethCall(rpc, to, data) {
  return rpcCall(rpc, "eth_call", [{ to, data }, "latest"]);
}

function pad32(hex) {
  return hex.replace(/^0x/, "").toLowerCase().padStart(64, "0");
}

function encodeFunctionCall(selector, ...args) {
  return "0x" + selector + args.map(pad32).join("");
}

function decodeAddress(hex) {
  return "0x" + hex.slice(-40);
}

function decodeUint(hex) {
  return BigInt("0x" + (hex.replace(/^0x/, "") || "0"));
}

function keccak256(text) {
  return "0x" + createHash("sha3-256").update(text).digest("hex");
}

function formatUnits(val, decimals) {
  const s = val.toString().padStart(decimals + 1, "0");
  const whole = s.slice(0, s.length - decimals) || "0";
  const frac = s.slice(s.length - decimals);
  const trimmed = frac.replace(/0+$/, "");
  return trimmed ? `${whole}.${trimmed}` : whole;
}

function formatCompact(n) {
  if (n >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(2) + "K";
  return n.toFixed(2);
}

// ── Token info ──

async function getTokenInfo(rpc, addr) {
  const [symRaw, decRaw] = await Promise.all([
    ethCall(rpc, addr, "0x95d89b41").catch(() => "0x"),
    ethCall(rpc, addr, "0x313ce567").catch(() => "0x12"),
  ]);
  let symbol = "???";
  try {
    if (symRaw && symRaw.length > 2) {
      const bytes = Buffer.from(symRaw.replace(/^0x/, ""), "hex");
      if (bytes.length === 32 && bytes[0] !== 0) {
        symbol = bytes.toString("utf8").replace(/\0/g, "").trim();
      } else if (bytes.length >= 64) {
        const offset = parseInt(symRaw.slice(2, 66), 16);
        const len = parseInt(symRaw.slice(66, 130), 16);
        if (len > 0 && len < 32) {
          symbol = Buffer.from(symRaw.slice(130, 130 + len * 2), "hex").toString("utf8").trim();
        }
      }
    }
  } catch {}
  const decimals = Number(decRaw && decRaw !== "0x" ? BigInt(decRaw) : 18n);
  return { symbol, decimals, address: addr.toLowerCase() };
}

// ── V2 pool scanning ──

// getReserves() selector
const GET_RESERVES = "0x0902f1ac";
// getPool V2: getPair(address,address) = 0xe6a43905
const GET_PAIR = "e6a43905";

async function findV2Pool(rpc, factory, tokenA, tokenB) {
  const data = encodeFunctionCall(GET_PAIR, tokenA, tokenB);
  const result = await ethCall(rpc, factory, data);
  const pool = decodeAddress(result);
  if (pool === ZERO_ADDR) return null;
  return pool;
}

async function getV2Reserves(rpc, pool) {
  const result = await ethCall(rpc, pool, GET_RESERVES);
  if (!result || result === "0x") return null;
  const hex = result.replace(/^0x/, "");
  const reserve0 = decodeUint(hex.slice(0, 64));
  const reserve1 = decodeUint(hex.slice(64, 128));
  return { reserve0, reserve1 };
}

// ── V3 pool scanning ──

// getPool(address,address,uint24) = 0x1698ee82
const GET_POOL_V3 = "1698ee82";
// slot0() = 0x3850c7bd
const SLOT0 = "0x3850c7bd";
// liquidity() = 0x1a686502
const LIQUIDITY = "0x1a686502";

async function findV3Pool(rpc, factory, tokenA, tokenB, fee) {
  const data = encodeFunctionCall(GET_POOL_V3, tokenA, tokenB, "0x" + fee.toString(16));
  const result = await ethCall(rpc, factory, data);
  const pool = decodeAddress(result);
  if (pool === ZERO_ADDR) return null;
  return pool;
}

async function getV3State(rpc, pool) {
  const [slot0Raw, liqRaw] = await Promise.all([
    ethCall(rpc, pool, SLOT0).catch(() => null),
    ethCall(rpc, pool, LIQUIDITY).catch(() => "0x0"),
  ]);
  if (!slot0Raw || slot0Raw === "0x") return null;
  const hex = slot0Raw.replace(/^0x/, "");
  const sqrtPriceX96 = decodeUint(hex.slice(0, 64));
  const tick = Number(BigInt.asIntN(24, decodeUint(hex.slice(64, 128))));
  const liquidity = decodeUint(liqRaw);
  return { sqrtPriceX96, tick, liquidity };
}

function sqrtPriceToPrice(sqrtPriceX96, decimals0, decimals1) {
  const price = Number(sqrtPriceX96) ** 2 / 2 ** 192;
  return price * 10 ** (decimals0 - decimals1);
}

// ── V2 reserve-based pricing ──

function reservePrice(reserve0, reserve1, decimals0, decimals1) {
  if (reserve0 === 0n) return 0;
  return (Number(reserve1) / Number(reserve0)) * 10 ** (decimals0 - decimals1);
}

// ── Token balance for TVL ──

async function getBalance(rpc, token, holder) {
  const data = encodeFunctionCall("70a08231", holder);
  const result = await ethCall(rpc, token, "0x" + data.slice(2));
  return decodeUint(result.replace(/^0x/, ""));
}

// ── Main ──

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    console.log(`pool-scanner — find Uniswap V2/V3 pools for any token

Usage:
  node pool-scanner.mjs <token-address> [options]

Options:
  --chain <base|mainnet>   Chain to scan (default: base)
  --v2-only                Only scan V2 pools
  --v3-only                Only scan V3 pools
  --json                   Output as JSON
  -h, --help               Show this help`);
    process.exit(0);
  }

  const token = args.find((a) => a.startsWith("0x") && a.length === 42);
  if (!token) { console.error("Error: provide a valid token address"); process.exit(1); }

  const chainName = args.includes("--chain") ? args[args.indexOf("--chain") + 1] : "base";
  const chain = CHAINS[chainName];
  if (!chain) { console.error(`Error: unknown chain "${chainName}"`); process.exit(1); }

  const v2Only = args.includes("--v2-only");
  const v3Only = args.includes("--v3-only");
  const jsonOut = args.includes("--json");

  const rpc = chain.rpc;

  const tokenInfo = await getTokenInfo(rpc, token);
  const wethInfo = { symbol: "WETH", decimals: 18, address: chain.weth.toLowerCase() };

  const quoteTokens = [
    { ...wethInfo },
    ...Object.entries(chain.stables).map(([addr, info]) => ({ ...info, address: addr.toLowerCase() })),
  ].filter((q) => q.address !== token.toLowerCase());

  if (!jsonOut) {
    console.log(`\nScanning ${chain.name} pools for ${tokenInfo.symbol} (${token})\n`);
  }

  const pools = [];

  // Scan V2
  if (!v3Only) {
    for (const quote of quoteTokens) {
      try {
        const pool = await findV2Pool(rpc, chain.v2Factory, token, quote.address);
        if (!pool) continue;

        const reserves = await getV2Reserves(rpc, pool);
        if (!reserves || (reserves.reserve0 === 0n && reserves.reserve1 === 0n)) continue;

        const isToken0 = token.toLowerCase() < quote.address.toLowerCase();
        const tokenReserve = isToken0 ? reserves.reserve0 : reserves.reserve1;
        const quoteReserve = isToken0 ? reserves.reserve1 : reserves.reserve0;

        const price = reservePrice(
          tokenReserve, quoteReserve,
          tokenInfo.decimals, quote.decimals
        );

        const tokenReserveF = Number(formatUnits(tokenReserve, tokenInfo.decimals));
        const quoteReserveF = Number(formatUnits(quoteReserve, quote.decimals));

        pools.push({
          type: "V2",
          pool,
          pair: `${tokenInfo.symbol}/${quote.symbol}`,
          tokenReserve: tokenReserveF,
          quoteReserve: quoteReserveF,
          quoteSymbol: quote.symbol,
          price,
          fee: "0.3%",
        });
      } catch(e) { if (process.env.DEBUG) console.error("V2:", quote.symbol, e.message); }
    }
  }

  // Scan V3 — sequential to stay under public RPC rate limits
  if (!v2Only) {
    for (const quote of quoteTokens) {
      for (const fee of V3_FEE_TIERS) {
        try {
          const pool = await findV3Pool(rpc, chain.v3Factory, token, quote.address, fee);
          if (!pool) continue;

          const state = await getV3State(rpc, pool);
          if (!state || state.sqrtPriceX96 === 0n) continue;

          const isToken0 = token.toLowerCase() < quote.address.toLowerCase();
          const decimals0 = isToken0 ? tokenInfo.decimals : quote.decimals;
          const decimals1 = isToken0 ? quote.decimals : tokenInfo.decimals;

          let price = sqrtPriceToPrice(state.sqrtPriceX96, decimals0, decimals1);
          if (!isToken0 && price > 0) price = 1 / price;

          const [bal0, bal1] = await Promise.all([
            getBalance(rpc, isToken0 ? token : quote.address, pool),
            getBalance(rpc, isToken0 ? quote.address : token, pool),
          ]);

          const tokenBal = isToken0 ? bal0 : bal1;
          const quoteBal = isToken0 ? bal1 : bal0;
          const tokenReserveF = Number(formatUnits(tokenBal, tokenInfo.decimals));
          const quoteReserveF = Number(formatUnits(quoteBal, quote.decimals));

          pools.push({
            type: "V3",
            pool,
            pair: `${tokenInfo.symbol}/${quote.symbol}`,
            fee: `${fee / 10000}%`,
            feeRaw: fee,
            tokenReserve: tokenReserveF,
            quoteReserve: quoteReserveF,
            quoteSymbol: quote.symbol,
            price,
            liquidity: state.liquidity.toString(),
            tick: state.tick,
          });
        } catch(e) { if (process.env.DEBUG) console.error("V3:", quote.symbol, fee, e.message); }
      }
    }
  }

  // Sort by quote reserve descending (proxy for TVL)
  pools.sort((a, b) => b.quoteReserve - a.quoteReserve);

  if (jsonOut) {
    console.log(JSON.stringify({ token: tokenInfo, chain: chainName, pools }, null, 2));
    return;
  }

  if (pools.length === 0) {
    console.log("No pools found.");
    return;
  }

  console.log(`Found ${pools.length} pool(s):\n`);

  for (const p of pools) {
    const feeStr = p.type === "V3" ? ` (${p.fee})` : "";
    console.log(`  ${p.type}${feeStr}  ${p.pair}`);
    console.log(`    Pool:     ${p.pool}`);
    console.log(`    Price:    1 ${tokenInfo.symbol} = ${p.price < 0.0001 ? p.price.toExponential(4) : p.price.toFixed(6)} ${p.quoteSymbol}`);
    console.log(`    ${tokenInfo.symbol}:${" ".repeat(Math.max(1, 8 - tokenInfo.symbol.length))}${formatCompact(p.tokenReserve)}`);
    console.log(`    ${p.quoteSymbol}:${" ".repeat(Math.max(1, 8 - p.quoteSymbol.length))}${formatCompact(p.quoteReserve)}`);
    if (p.liquidity) console.log(`    Liq:      ${formatCompact(Number(p.liquidity))}`);
    console.log();
  }

  // Summary
  const wethPools = pools.filter((p) => p.quoteSymbol === "WETH");
  const usdPools = pools.filter((p) => ["USDC", "USDbC", "USDT", "DAI"].includes(p.quoteSymbol));
  if (wethPools.length > 0) {
    const best = wethPools[0];
    console.log(`Best WETH price: 1 ${tokenInfo.symbol} = ${best.price < 0.0001 ? best.price.toExponential(4) : best.price.toFixed(6)} WETH (${best.type} ${best.pair})`);
  }
  if (usdPools.length > 0) {
    const best = usdPools[0];
    console.log(`Best USD price:  1 ${tokenInfo.symbol} = $${best.price < 0.0001 ? best.price.toExponential(4) : best.price.toFixed(6)} (${best.type} ${best.pair})`);
  }
}

main().catch((e) => { console.error("Error:", e.message); process.exit(1); });
