#!/usr/bin/env node
/**
 * scan.mjs — one-shot historical scan for any EVM event
 * Scans a block range, outputs matching events, exits.
 *
 * Usage:
 *   node scan.mjs --contract 0x... --event Transfer --blocks 1000
 *   node scan.mjs --contract 0x... --topic 0xddf252... --from 20000000 --to 20001000
 *   node scan.mjs --contract 0x... --event SwapV3 --blocks 500 --json
 */

const KNOWN_EVENTS = {
  'Transfer':    '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
  'Approval':    '0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925',
  'SwapV2':      '0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822',
  'SwapV3':      '0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67',
  'SwapV4':      '0x19b47279256b2a23a1665c810c8d55a1758940ee09377d4f8d26497a3577dc83',
  'Mint_V3':     '0x7a53080ba414158be7ec69b987b5fb7d07dee101fe85488f0853ae16239d0bde',
  'Burn_V3':     '0x0c396cd989a39f4459b5fa1aed6a9a8dcdbc45908acfd67e028cd568da98982c',
  'OwnershipTransferred': '0x8be0079c531659141344cd1fd0a4f28419497f9722a3daafe3b4186f6b6457e0',
};

const RPC_PRESETS = {
  base:       'https://mainnet.base.org',
  ethereum:   'https://eth.llamarpc.com',
  arbitrum:   'https://arb1.arbitrum.io/rpc',
  optimism:   'https://mainnet.optimism.io',
  polygon:    'https://polygon-rpc.com',
};

const args = process.argv.slice(2);
const get  = (flag, def) => { const i = args.indexOf(flag); return i !== -1 && args[i+1] ? args[i+1] : def; };
const has  = (flag) => args.includes(flag);

const CONTRACT    = get('--contract', null);
const EVENT_NAME  = get('--event', null);
const CUSTOM_TOPIC = get('--topic', null);
const FROM_ARG    = get('--from', null);
const TO_ARG      = get('--to', null);
const BLOCKS      = parseInt(get('--blocks', '500'), 10);
const CHAIN       = get('--chain', 'base');
const RPC         = get('--rpc', RPC_PRESETS[CHAIN] || RPC_PRESETS.base);
const JSON_OUT    = has('--json');
const CHUNK       = 500;  // max blocks per getLogs call (conservative)

if (!CONTRACT) {
  console.error('Usage: node scan.mjs --contract 0x... --event Transfer [--blocks 1000] [--chain base]');
  process.exit(1);
}

let topic0;
if (CUSTOM_TOPIC) {
  topic0 = CUSTOM_TOPIC.startsWith('0x') ? CUSTOM_TOPIC : `0x${CUSTOM_TOPIC}`;
} else if (EVENT_NAME) {
  topic0 = KNOWN_EVENTS[EVENT_NAME];
  if (!topic0) { console.error(`Unknown event: ${EVENT_NAME}`); process.exit(1); }
} else {
  console.error('Provide --event or --topic');
  process.exit(1);
}

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

async function main() {
  const latest = parseInt(await rpc('eth_blockNumber', []), 16);
  const toBlock   = TO_ARG   ? parseInt(TO_ARG, 10)   : latest;
  const fromBlock = FROM_ARG ? parseInt(FROM_ARG, 10) : toBlock - BLOCKS;

  if (!JSON_OUT) {
    console.log(`Scanning ${EVENT_NAME || topic0.slice(0,10)} on ${CONTRACT}`);
    console.log(`Blocks ${fromBlock} → ${toBlock} (${toBlock - fromBlock} blocks)\n`);
  }

  const allLogs = [];
  for (let start = fromBlock; start <= toBlock; start += CHUNK + 1) {
    const end = Math.min(start + CHUNK, toBlock);
    const logs = await rpc('eth_getLogs', [{
      address: CONTRACT,
      topics: [topic0],
      fromBlock: `0x${start.toString(16)}`,
      toBlock:   `0x${end.toString(16)}`,
    }]);
    allLogs.push(...logs);
    if (!JSON_OUT) process.stderr.write(`  scanned blocks ${start}-${end} (${logs.length} events)\n`);
  }

  if (JSON_OUT) {
    for (const log of allLogs) {
      const block = parseInt(log.blockNumber, 16);
      const indexed = log.topics.slice(1).map(t => `0x${t.slice(26)}`);
      console.log(JSON.stringify({ block, tx: log.transactionHash, address: log.address, indexed, data: log.data }));
    }
  } else {
    console.log(`\nFound ${allLogs.length} events:\n`);
    for (const log of allLogs) {
      const block = parseInt(log.blockNumber, 16);
      const t = log.topics;
      if (t.length === 3 && log.data.length === 66) {
        const from   = `0x${t[1].slice(26)}`;
        const to     = `0x${t[2].slice(26)}`;
        const amount = BigInt(log.data).toString();
        console.log(`[${block}] ${from} → ${to}  ${amount}`);
      } else {
        console.log(`[${block}] tx=${log.transactionHash}`);
      }
    }
  }
}

main().catch(e => { console.error(e.message); process.exit(1); });
