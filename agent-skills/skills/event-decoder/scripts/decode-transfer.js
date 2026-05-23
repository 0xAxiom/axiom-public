#!/usr/bin/env node
/**
 * decode-transfer.js
 * Decode ERC-20 Transfer and Approval events from any token.
 * Fetches recent logs via eth_getLogs and prints decoded results.
 *
 * Usage:
 *   node decode-transfer.js <tokenAddress> [rpcUrl] [blockRange]
 *
 * Examples:
 *   # USDC on Base, last 1000 blocks
 *   node decode-transfer.js 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
 *
 *   # Custom RPC and block range
 *   node decode-transfer.js 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 https://mainnet.base.org 500
 */

'use strict';

const { decodeEvent } = require('./decode-event');
const https = require('https');
const http = require('http');

// ─── Known event ABIs ────────────────────────────────────────────────────────

const TRANSFER_ABI = {
  name: 'Transfer',
  type: 'event',
  inputs: [
    { name: 'from',  type: 'address', indexed: true  },
    { name: 'to',    type: 'address', indexed: true  },
    { name: 'value', type: 'uint256', indexed: false },
  ],
};

const APPROVAL_ABI = {
  name: 'Approval',
  type: 'event',
  inputs: [
    { name: 'owner',   type: 'address', indexed: true  },
    { name: 'spender', type: 'address', indexed: true  },
    { name: 'value',   type: 'uint256', indexed: false },
  ],
};

// ERC-20 Transfer topic0 (keccak256 of "Transfer(address,address,uint256)")
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
// ERC-20 Approval topic0
const APPROVAL_TOPIC = '0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925';

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
          const parsed = JSON.parse(data);
          if (parsed.error) reject(new Error(parsed.error.message));
          else resolve(parsed.result);
        } catch (e) { reject(e); }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const [,, tokenAddr, rpcUrl = 'https://mainnet.base.org', blockRange = '1000'] = process.argv;

  if (!tokenAddr) {
    console.error('Usage: node decode-transfer.js <tokenAddress> [rpcUrl] [blockRange]');
    process.exit(1);
  }

  const addr = tokenAddr.toLowerCase();
  const range = parseInt(blockRange, 10);

  // Get current block
  const latestHex = await rpcCall(rpcUrl, 'eth_blockNumber', []);
  const latest = Number(BigInt(latestHex));
  const fromBlock = '0x' + Math.max(0, latest - range).toString(16);
  const toBlock   = '0x' + latest.toString(16);

  console.log(`\nFetching Transfer + Approval logs for ${tokenAddr}`);
  console.log(`Block range: ${latest - range} → ${latest} (${range} blocks)\n`);

  // Fetch Transfer logs
  const transferLogs = await rpcCall(rpcUrl, 'eth_getLogs', [{
    address: addr,
    topics: [TRANSFER_TOPIC],
    fromBlock,
    toBlock,
  }]);

  // Fetch Approval logs
  const approvalLogs = await rpcCall(rpcUrl, 'eth_getLogs', [{
    address: addr,
    topics: [APPROVAL_TOPIC],
    fromBlock,
    toBlock,
  }]);

  console.log(`Found: ${transferLogs.length} Transfer events, ${approvalLogs.length} Approval events\n`);

  // Decode and print Transfers
  if (transferLogs.length > 0) {
    console.log('=== TRANSFERS ===\n');
    for (const log of transferLogs.slice(0, 20)) {  // cap at 20 for display
      const decoded = decodeEvent(TRANSFER_ABI, log);
      const { from, to, value } = decoded.params;
      console.log(`Block ${Number(log.blockNumber)}`);
      console.log(`  from:  ${from}`);
      console.log(`  to:    ${to}`);
      console.log(`  value: ${value.toString()} (raw)`);
      console.log(`  tx:    ${log.transactionHash}`);
      console.log();
    }
    if (transferLogs.length > 20) {
      console.log(`  ... and ${transferLogs.length - 20} more\n`);
    }
  }

  // Decode and print Approvals
  if (approvalLogs.length > 0) {
    console.log('=== APPROVALS ===\n');
    for (const log of approvalLogs.slice(0, 10)) {
      const decoded = decodeEvent(APPROVAL_ABI, log);
      const { owner, spender, value } = decoded.params;
      const isInfinite = value === (2n ** 256n - 1n);
      console.log(`Block ${Number(log.blockNumber)}`);
      console.log(`  owner:   ${owner}`);
      console.log(`  spender: ${spender}`);
      console.log(`  amount:  ${isInfinite ? 'INFINITE' : value.toString()}`);
      console.log(`  tx:      ${log.transactionHash}`);
      console.log();
    }
  }

  // Summary
  console.log('=== SUMMARY ===');
  console.log(`Total volume (raw): ${transferLogs.reduce((sum, log) => {
    try {
      const d = decodeEvent(TRANSFER_ABI, log);
      return sum + d.params.value;
    } catch { return sum; }
  }, 0n).toString()}`);
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
