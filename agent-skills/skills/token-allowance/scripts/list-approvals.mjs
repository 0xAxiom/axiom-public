#!/usr/bin/env node
/**
 * List all ERC-20 Approval events for a wallet address.
 * Uses eth_getLogs — zero deps, no API key, any EVM chain.
 *
 * Usage: node list-approvals.mjs <owner> [fromBlock_or_-N] [rpc_url]
 *   fromBlock: absolute block number, hex, or -N for "last N blocks" (default: -50000)
 * Env: RPC_URL
 *
 * Examples:
 *   node list-approvals.mjs 0xYourWallet
 *   node list-approvals.mjs 0xYourWallet -100000
 *   node list-approvals.mjs 0xYourWallet 0 https://eth.llamarpc.com
 */

const [,, owner, fromArg = '-50000', rpc = process.env.RPC_URL || 'https://mainnet.base.org'] = process.argv;

if (!owner) {
  console.error('Usage: list-approvals.mjs <owner> [fromBlock_or_-N] [rpc_url]');
  process.exit(1);
}

// keccak256("Approval(address,address,uint256)")
const APPROVAL_TOPIC = '0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925';
const INFINITE_THRESHOLD = 10n ** 28n;

function padAddr(addr) {
  return '0x' + addr.toLowerCase().replace('0x', '').padStart(64, '0');
}

async function rpc1(method, params) {
  const res = await fetch(rpc, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params }),
  });
  const { result, error } = await res.json();
  if (error) throw new Error(`RPC ${method}: ${error.message}`);
  return result;
}

async function main() {
  const latestHex = await rpc1('eth_blockNumber', []);
  const latest    = parseInt(latestHex, 16);

  let fromBlock;
  if (fromArg.startsWith('-')) {
    fromBlock = '0x' + Math.max(0, latest + parseInt(fromArg)).toString(16);
  } else if (fromArg.startsWith('0x')) {
    fromBlock = fromArg;
  } else {
    fromBlock = '0x' + parseInt(fromArg, 10).toString(16);
  }

  const fromNum = parseInt(fromBlock, 16);
  const range   = latest - fromNum;
  console.error(`Scanning ${fromNum.toLocaleString()} → ${latest.toLocaleString()} (${range.toLocaleString()} blocks)…`);

  const logs = await rpc1('eth_getLogs', [{
    fromBlock,
    toBlock: 'latest',
    topics: [APPROVAL_TOPIC, padAddr(owner)],
  }]);

  // Decode each log; dedupe by (token, spender) keeping the latest block
  const map = new Map();
  for (const log of logs) {
    const spender  = '0x' + log.topics[2].slice(26).toLowerCase();
    const value    = log.data === '0x' ? 0n : BigInt(log.data);
    const block    = parseInt(log.blockNumber, 16);
    const key      = `${log.address.toLowerCase()}:${spender}`;
    const existing = map.get(key);
    if (!existing || existing.block < block) {
      map.set(key, {
        token:    log.address.toLowerCase(),
        spender,
        amount:   value.toString(),
        infinite: value > INFINITE_THRESHOLD,
        revoked:  value === 0n,
        block,
        tx:       log.transactionHash,
      });
    }
  }

  const all      = [...map.values()].sort((a, b) => b.block - a.block);
  const active   = all.filter(a => !a.revoked);
  const infinite = active.filter(a => a.infinite);

  const out = {
    owner:            owner.toLowerCase(),
    rpc,
    scannedBlocks:    `${fromNum} - ${latest}`,
    totalEvents:      logs.length,
    uniquePairs:      all.length,
    activeApprovals:  active.length,
    infiniteCount:    infinite.length,
    approvals:        all,
  };

  console.log(JSON.stringify(out, null, 2));

  if (infinite.length > 0) {
    console.error(`\n⚠  ${infinite.length} INFINITE approval(s) found.`);
    console.error(`   Run check-allowance.mjs to confirm current state, then revoke-calldata.mjs to generate revoke tx.\n`);
  }
}

main().catch(e => { console.error(e.message); process.exit(1); });
