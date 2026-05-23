#!/usr/bin/env node
/**
 * decode-swap.js
 * Decode Uniswap V2/V3 Swap events from any pool — no ethers, no API key.
 *
 * Usage:
 *   node decode-swap.js <poolAddress> [v2|v3] [rpcUrl] [blockRange]
 *
 * Examples:
 *   # Uniswap V3 pool on Base (USDC/ETH)
 *   node decode-swap.js 0xd0b53D9277642d899DF5C87A3966A349A798F224 v3
 *
 *   # V2 pair
 *   node decode-swap.js 0xSomePair v2 https://mainnet.base.org 500
 */

'use strict';

const { decodeEvent } = require('./decode-event');
const https = require('https');
const http = require('http');

// ─── Swap ABIs ───────────────────────────────────────────────────────────────

const SWAP_V2_ABI = {
  name: 'Swap',
  type: 'event',
  inputs: [
    { name: 'sender',     type: 'address', indexed: true  },
    { name: 'amount0In',  type: 'uint256', indexed: false },
    { name: 'amount1In',  type: 'uint256', indexed: false },
    { name: 'amount0Out', type: 'uint256', indexed: false },
    { name: 'amount1Out', type: 'uint256', indexed: false },
    { name: 'to',         type: 'address', indexed: true  },
  ],
};

const SWAP_V3_ABI = {
  name: 'Swap',
  type: 'event',
  inputs: [
    { name: 'sender',      type: 'address', indexed: true  },
    { name: 'recipient',   type: 'address', indexed: true  },
    { name: 'amount0',     type: 'int256',  indexed: false },
    { name: 'amount1',     type: 'int256',  indexed: false },
    { name: 'sqrtPriceX96', type: 'uint160', indexed: false },
    { name: 'liquidity',   type: 'uint128', indexed: false },
    { name: 'tick',        type: 'int24',   indexed: false },
  ],
};

// Swap topic0 is the same for both V2 and V3 (just "Swap" but different params → different hash)
// V2: Swap(address indexed sender, uint amount0In, uint amount1In, uint amount0Out, uint amount1Out, address indexed to)
const SWAP_V2_TOPIC = '0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822';
// V3: Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)
const SWAP_V3_TOPIC = '0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67';

// ─── RPC helper ─────────────────────────────────────────────────────────────

function rpcCall(url, method, params) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method, params });
    const mod = url.startsWith('https') ? https : http;
    const parsed = new URL(url);

    const req = mod.request({
      hostname: parsed.hostname,
      port: parsed.port || (url.startsWith('https') ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try {
          const r = JSON.parse(data);
          if (r.error) reject(new Error(r.error.message));
          else resolve(r.result);
        } catch (e) { reject(e); }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ─── Sqrtprice → price conversion ───────────────────────────────────────────

function sqrtPriceX96ToPrice(sqrtPriceX96) {
  // price = (sqrtPriceX96 / 2^96)^2
  const Q96 = 2n ** 96n;
  const price = (sqrtPriceX96 * sqrtPriceX96 * 10n ** 18n) / (Q96 * Q96);
  return price; // token1/token0 * 1e18
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const [,, poolAddr, version = 'v3', rpcUrl = 'https://mainnet.base.org', blockRange = '1000'] = process.argv;

  if (!poolAddr) {
    console.error('Usage: node decode-swap.js <poolAddress> [v2|v3] [rpcUrl] [blockRange]');
    process.exit(1);
  }

  const isV3 = version !== 'v2';
  const topic = isV3 ? SWAP_V3_TOPIC : SWAP_V2_TOPIC;
  const abi   = isV3 ? SWAP_V3_ABI   : SWAP_V2_ABI;
  const range = parseInt(blockRange, 10);

  const latestHex = await rpcCall(rpcUrl, 'eth_blockNumber', []);
  const latest = Number(BigInt(latestHex));
  const fromBlock = '0x' + Math.max(0, latest - range).toString(16);
  const toBlock   = '0x' + latest.toString(16);

  console.log(`\nFetching Uniswap ${version.toUpperCase()} Swap events for ${poolAddr}`);
  console.log(`Block range: ${latest - range} → ${latest}\n`);

  const logs = await rpcCall(rpcUrl, 'eth_getLogs', [{
    address: poolAddr.toLowerCase(),
    topics: [topic],
    fromBlock,
    toBlock,
  }]);

  console.log(`Found ${logs.length} swaps\n`);

  for (const log of logs.slice(0, 15)) {
    try {
      const decoded = decodeEvent(abi, log);
      const p = decoded.params;

      console.log(`Block ${Number(log.blockNumber)} | tx ${log.transactionHash.slice(0, 18)}...`);

      if (isV3) {
        const a0 = p.amount0;
        const a1 = p.amount1;
        const dir = a0 < 0n ? 'token0 OUT, token1 IN' : 'token0 IN, token1 OUT';
        const price = sqrtPriceX96ToPrice(p.sqrtPriceX96);
        console.log(`  Direction: ${dir}`);
        console.log(`  amount0:   ${a0.toString()}`);
        console.log(`  amount1:   ${a1.toString()}`);
        console.log(`  tick:      ${p.tick.toString()}`);
        console.log(`  price*1e18:${price.toString()}`);
        console.log(`  sender:    ${p.sender}`);
      } else {
        console.log(`  amount0In:  ${p.amount0In.toString()}`);
        console.log(`  amount1In:  ${p.amount1In.toString()}`);
        console.log(`  amount0Out: ${p.amount0Out.toString()}`);
        console.log(`  amount1Out: ${p.amount1Out.toString()}`);
        console.log(`  sender:     ${p.sender}`);
        console.log(`  to:         ${p.to}`);
      }
      console.log();
    } catch (err) {
      console.log(`  [decode error: ${err.message}]`);
    }
  }

  if (logs.length > 15) {
    console.log(`... and ${logs.length - 15} more swaps`);
  }
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
