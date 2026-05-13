#!/usr/bin/env node
/**
 * onchain-event-watcher — watch EVM events via eth_getLogs polling
 * Zero dependencies. Works on Base, Ethereum, Arbitrum, Optimism, Polygon.
 *
 * Usage:
 *   node watch.mjs --contract 0x... --event Transfer --rpc https://mainnet.base.org
 *   node watch.mjs --contract 0x... --topic 0xddf252... --interval 10
 *   node watch.mjs --contract 0x... --event Swap --from latest --loop
 *   node watch.mjs --list-events
 */

import { createInterface } from 'readline';

// ─── Known event topic hashes (keccak256 of signature) ────────────────────────
const KNOWN_EVENTS = {
  // ERC-20
  'Transfer':    '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
  'Approval':    '0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925',

  // Uniswap V2
  'SwapV2':      '0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822',
  'Mint_V2':     '0x4c209b5fc8ad50758f13e2e1088ba56a560dff690a1c6fef26394f4c03821c4f',
  'Burn_V2':     '0xdccd412f0b1252819cb1fd330b93224ca42612892bb3f4f789976e6d81936496',
  'Sync_V2':     '0x1c411e9a96e071241c2f21f7726b17ae89e3cab4c78be50e062b03a9fffbbad1',

  // Uniswap V3
  'SwapV3':      '0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67',
  'Mint_V3':     '0x7a53080ba414158be7ec69b987b5fb7d07dee101fe85488f0853ae16239d0bde',
  'Burn_V3':     '0x0c396cd989a39f4459b5fa1aed6a9a8dcdbc45908acfd67e028cd568da98982c',
  'Collect_V3':  '0x70935338e69775456a85ddef226c395fb668b63fa0115f5f20610b388e6ca9c0',

  // Uniswap V4
  'SwapV4':      '0x19b47279256b2a23a1665c810c8d55a1758940ee09377d4f8d26497a3577dc83',
  'ModifyLiquidityV4': '0x02b543c6000000000000000000000000000000000000000000000000000000000',

  // General
  'OwnershipTransferred': '0x8be0079c531659141344cd1fd0a4f28419497f9722a3daafe3b4186f6b6457e0',
  'Upgraded':    '0xbc7cd75a20ee27fd9adebab32041f755214dbc6bffa90cc0225b39da2e5c2d3b',
  'Paused':      '0x62e78cea01bee320cd4e420270b5ea74000d11b0c9f74754ebdbfc544b05a258',
  'Unpaused':    '0x5db9ee0a495bf2e6ff9c91a7834c1ba4fdd244a5e8aa4e537bd38aeae4b073aa',

  // ERC-721
  'Transfer721':  '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
  'ApprovalNFT':  '0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925',
  'ApprovalForAll': '0x17307eab39ab6107e8899845ad3d59bd9653f200f220920489ca2b5937696c31',
};

// ─── RPC presets ─────────────────────────────────────────────────────────────
const RPC_PRESETS = {
  base:       'https://mainnet.base.org',
  ethereum:   'https://eth.llamarpc.com',
  arbitrum:   'https://arb1.arbitrum.io/rpc',
  optimism:   'https://mainnet.optimism.io',
  polygon:    'https://polygon-rpc.com',
  'base-sep': 'https://sepolia.base.org',
};

// ─── CLI args ─────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const get = (flag, def) => {
  const i = args.indexOf(flag);
  return i !== -1 && args[i + 1] ? args[i + 1] : def;
};
const has = (flag) => args.includes(flag);

if (has('--list-events')) {
  console.log('\nKnown event shortcuts:\n');
  for (const [name, topic] of Object.entries(KNOWN_EVENTS)) {
    console.log(`  ${name.padEnd(22)} ${topic}`);
  }
  console.log('\nFor custom events: compute keccak256 of the full signature');
  console.log('Example: cast keccak "Transfer(address,address,uint256)"');
  process.exit(0);
}

const CONTRACT   = get('--contract', null);
const EVENT_NAME = get('--event', null);
const CUSTOM_TOPIC = get('--topic', null);
const FROM_BLOCK = get('--from', 'latest');
const INTERVAL   = parseInt(get('--interval', '12'), 10);
const LOOP       = has('--loop');
const JSON_OUT   = has('--json');
const CHAIN      = get('--chain', 'base');
let RPC          = get('--rpc', RPC_PRESETS[CHAIN] || RPC_PRESETS.base);

if (!CONTRACT && !has('--list-events')) {
  console.error('Usage: node watch.mjs --contract 0x... --event Transfer [--loop] [--interval 12] [--chain base]');
  console.error('       node watch.mjs --list-events');
  process.exit(1);
}

// ─── Resolve topic ────────────────────────────────────────────────────────────
let topic0;
if (CUSTOM_TOPIC) {
  topic0 = CUSTOM_TOPIC.startsWith('0x') ? CUSTOM_TOPIC : `0x${CUSTOM_TOPIC}`;
} else if (EVENT_NAME) {
  topic0 = KNOWN_EVENTS[EVENT_NAME];
  if (!topic0) {
    console.error(`Unknown event: "${EVENT_NAME}". Use --list-events or --topic 0x... directly.`);
    process.exit(1);
  }
} else {
  console.error('Provide --event <name> or --topic 0x<hash>');
  process.exit(1);
}

// ─── RPC call ─────────────────────────────────────────────────────────────────
let reqId = 1;
async function rpc(method, params) {
  const res = await fetch(RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: reqId++, method, params }),
  });
  const data = await res.json();
  if (data.error) throw new Error(`RPC error: ${data.error.message}`);
  return data.result;
}

async function getBlockNumber() {
  const hex = await rpc('eth_blockNumber', []);
  return parseInt(hex, 16);
}

async function getLogs(fromBlock, toBlock) {
  const filter = {
    address: CONTRACT,
    topics: [topic0],
    fromBlock: `0x${fromBlock.toString(16)}`,
    toBlock:   `0x${toBlock.toString(16)}`,
  };
  return rpc('eth_getLogs', [filter]);
}

// ─── Log formatting ───────────────────────────────────────────────────────────
function decodeAddressTopic(t) {
  return `0x${t.slice(26)}`;
}

function formatLog(log) {
  const block = parseInt(log.blockNumber, 16);
  const txHash = log.transactionHash;
  const topics = log.topics;
  const data = log.data;

  const decoded = {
    block,
    tx: txHash,
    address: log.address,
    topic: topics[0],
    indexed: topics.slice(1).map((t, i) => ({
      i,
      raw: t,
      asAddress: decodeAddressTopic(t),
    })),
    data,
  };

  // Try decode Transfer-shaped events (topic1=from, topic2=to, data=uint256)
  if (topics.length === 3 && data.length === 66) {
    const amount = BigInt(data);
    decoded.parsed = {
      from:   decodeAddressTopic(topics[1]),
      to:     decodeAddressTopic(topics[2]),
      amount: amount.toString(),
    };
  }

  return decoded;
}

// ─── Main loop ────────────────────────────────────────────────────────────────
const eventLabel = EVENT_NAME || topic0.slice(0, 10) + '...';

async function run() {
  let latestKnown = FROM_BLOCK === 'latest'
    ? await getBlockNumber()
    : parseInt(FROM_BLOCK, 10);

  if (!JSON_OUT) {
    console.log(`Watching ${eventLabel} on ${CONTRACT}`);
    console.log(`Chain: ${CHAIN} | RPC: ${RPC}`);
    console.log(`Starting from block ${latestKnown}${LOOP ? ` (polling every ${INTERVAL}s)` : ''}\n`);
  }

  do {
    try {
      const currentBlock = await getBlockNumber();
      if (currentBlock > latestKnown) {
        const logs = await getLogs(latestKnown + 1, currentBlock);
        for (const log of logs) {
          const formatted = formatLog(log);
          if (JSON_OUT) {
            process.stdout.write(JSON.stringify(formatted) + '\n');
          } else {
            const parsed = formatted.parsed;
            if (parsed) {
              console.log(`[block ${formatted.block}] ${eventLabel}: ${parsed.from} → ${parsed.to}  amount=${parsed.amount}`);
            } else {
              console.log(`[block ${formatted.block}] ${eventLabel} tx=${formatted.tx}`);
            }
          }
        }
        latestKnown = currentBlock;
      }
    } catch (e) {
      if (!JSON_OUT) console.error(`Error: ${e.message}`);
    }

    if (LOOP) await new Promise(r => setTimeout(r, INTERVAL * 1000));
  } while (LOOP);
}

run().catch(e => {
  console.error(e.message);
  process.exit(1);
});
