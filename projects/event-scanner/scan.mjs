#!/usr/bin/env node

// Event scanner — query and decode contract events from any EVM address.
// Zero dependencies. Uses eth_getLogs + eth_getBlockByNumber via JSON-RPC.

const CHAINS = {
  base: 'https://mainnet.base.org',
  ethereum: 'https://eth.llamarpc.com',
  optimism: 'https://mainnet.optimism.io',
  arbitrum: 'https://arb1.arbitrum.io/rpc',
};

const KNOWN_EVENTS = {
  '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef': {
    name: 'Transfer',
    sig: 'Transfer(address,address,uint256)',
    decode: (topics, data) => ({
      from: '0x' + topics[1].slice(26),
      to: '0x' + topics[2].slice(26),
      value: BigInt(data || '0x0').toString(),
    }),
  },
  '0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925': {
    name: 'Approval',
    sig: 'Approval(address,address,uint256)',
    decode: (topics, data) => ({
      owner: '0x' + topics[1].slice(26),
      spender: '0x' + topics[2].slice(26),
      value: BigInt(data || '0x0').toString(),
    }),
  },
  '0x1c411e9a96e071241c2f21f7726b17ae89e3cab4c78be50e062b03a9fffbbad1': {
    name: 'Sync',
    sig: 'Sync(uint112,uint112)',
    decode: (_topics, data) => {
      const d = data.replace('0x', '').padStart(64, '0');
      return {
        reserve0: BigInt('0x' + d.slice(0, 32)).toString(),
        reserve1: BigInt('0x' + d.slice(32, 64)).toString(),
      };
    },
  },
  '0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822': {
    name: 'Swap',
    sig: 'Swap(address,uint256,uint256,uint256,uint256,address)',
    decode: (topics, data) => {
      const d = data.replace('0x', '');
      return {
        sender: '0x' + topics[1].slice(26),
        amount0In: BigInt('0x' + d.slice(0, 64)).toString(),
        amount1In: BigInt('0x' + d.slice(64, 128)).toString(),
        amount0Out: BigInt('0x' + d.slice(128, 192)).toString(),
        amount1Out: BigInt('0x' + d.slice(192, 256)).toString(),
        to: '0x' + topics[2].slice(26),
      };
    },
  },
  '0xe1fffcc4923d04b559f4d29a8bfc6cda04eb5b0d3c460751c2402c5c5cc9109c': {
    name: 'Deposit',
    sig: 'Deposit(address,uint256)',
    decode: (topics, data) => ({
      dst: '0x' + topics[1].slice(26),
      wad: BigInt(data || '0x0').toString(),
    }),
  },
  '0x7fcf532c15f0a6db0bd6d0e038bea71d30d808c7d98cb3bf7268a95bf5081b65': {
    name: 'Withdrawal',
    sig: 'Withdrawal(address,uint256)',
    decode: (topics, data) => ({
      src: '0x' + topics[1].slice(26),
      wad: BigInt(data || '0x0').toString(),
    }),
  },
  '0x8be0079c531659141344cd1fd0a4f28419497f9722a3daafe3b4186f6b6457e0': {
    name: 'OwnershipTransferred',
    sig: 'OwnershipTransferred(address,address)',
    decode: (topics) => ({
      previousOwner: '0x' + topics[1].slice(26),
      newOwner: '0x' + topics[2].slice(26),
    }),
  },
};

let rpcId = 1;

async function rpc(url, method, params) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: rpcId++, method, params }),
  });
  const json = await res.json();
  if (json.error) throw new Error(`RPC error: ${json.error.message}`);
  return json.result;
}

async function getBlockNumber(rpcUrl) {
  const hex = await rpc(rpcUrl, 'eth_blockNumber', []);
  return Number(hex);
}

async function getBlock(rpcUrl, blockNum) {
  const hex = '0x' + blockNum.toString(16);
  return rpc(rpcUrl, 'eth_getBlockByNumber', [hex, false]);
}

async function getLogs(rpcUrl, address, fromBlock, toBlock, topics) {
  const params = {
    address,
    fromBlock: '0x' + fromBlock.toString(16),
    toBlock: '0x' + toBlock.toString(16),
  };
  if (topics && topics.length > 0) params.topics = topics;
  return rpc(rpcUrl, 'eth_getLogs', [params]);
}

function decodeEvent(log) {
  const topic0 = log.topics[0];
  const known = KNOWN_EVENTS[topic0];
  if (known) {
    try {
      return { name: known.name, sig: known.sig, args: known.decode(log.topics, log.data) };
    } catch {
      return { name: known.name, sig: known.sig, args: null };
    }
  }
  return { name: null, sig: null, topic0, topicCount: log.topics.length, dataLen: log.data?.length || 0 };
}

function formatValue(val) {
  const n = BigInt(val);
  if (n > 10n ** 15n) {
    const eth = Number(n) / 1e18;
    return `${val} (${eth.toFixed(6)} if 18 dec)`;
  }
  return val;
}

function printEvent(evt, log, timestamp) {
  const time = timestamp ? new Date(timestamp * 1000).toISOString() : '?';
  const block = Number(log.blockNumber);
  const txIdx = Number(log.transactionIndex);
  const logIdx = Number(log.logIndex);

  console.log(`\n--- Block ${block} | tx#${txIdx} log#${logIdx} | ${time} ---`);
  console.log(`  tx: ${log.transactionHash}`);

  if (evt.name) {
    console.log(`  event: ${evt.name}`);
    if (evt.args) {
      for (const [k, v] of Object.entries(evt.args)) {
        const display = typeof v === 'string' && /^\d+$/.test(v) && v.length > 10 ? formatValue(v) : v;
        console.log(`    ${k}: ${display}`);
      }
    }
  } else {
    console.log(`  topic0: ${evt.topic0}`);
    console.log(`  topics: ${evt.topicCount}, data bytes: ${(evt.dataLen - 2) / 2}`);
  }
}

function usage() {
  console.log(`event-scanner — query and decode contract events

Usage:
  node scan.mjs <address> [options]

Options:
  --chain <name>      Chain: base (default), ethereum, optimism, arbitrum
  --blocks <n>        How many blocks back to scan (default: 1000)
  --from <block>      Start block (overrides --blocks)
  --to <block>        End block (default: latest)
  --topic <hex>       Filter by topic0 (event signature hash)
  --limit <n>         Max events to display (default: 50)
  --json              Output as JSON array
  --rpc <url>         Custom RPC URL (overrides --chain)

Examples:
  node scan.mjs 0x4200000000000000000000000000000000000006 --chain base --blocks 100
  node scan.mjs 0xdead...beef --topic 0xddf252ad... --blocks 5000
  node scan.mjs 0x1234...5678 --chain ethereum --json --limit 20`);
  process.exit(0);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) usage();

  const address = args[0];
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
    console.error('Error: invalid address format');
    process.exit(1);
  }

  let chain = 'base';
  let blocks = 1000;
  let fromBlock = null;
  let toBlock = null;
  let topic = null;
  let limit = 50;
  let jsonOutput = false;
  let customRpc = null;

  for (let i = 1; i < args.length; i++) {
    switch (args[i]) {
      case '--chain': chain = args[++i]; break;
      case '--blocks': blocks = parseInt(args[++i], 10); break;
      case '--from': fromBlock = parseInt(args[++i], 10); break;
      case '--to': toBlock = parseInt(args[++i], 10); break;
      case '--topic': topic = args[++i]; break;
      case '--limit': limit = parseInt(args[++i], 10); break;
      case '--json': jsonOutput = true; break;
      case '--rpc': customRpc = args[++i]; break;
    }
  }

  const rpcUrl = customRpc || CHAINS[chain];
  if (!rpcUrl) {
    console.error(`Unknown chain: ${chain}. Available: ${Object.keys(CHAINS).join(', ')}`);
    process.exit(1);
  }

  const latest = await getBlockNumber(rpcUrl);
  const from = fromBlock ?? latest - blocks;
  const to = toBlock ?? latest;

  console.log(`Scanning ${address} on ${customRpc ? 'custom RPC' : chain}`);
  console.log(`Block range: ${from} → ${to} (${to - from} blocks)`);

  const CHUNK = 2000;
  let allLogs = [];

  for (let start = from; start <= to; start += CHUNK) {
    const end = Math.min(start + CHUNK - 1, to);
    try {
      const topics = topic ? [topic] : [];
      const logs = await getLogs(rpcUrl, address, start, end, topics.length ? topics : undefined);
      allLogs = allLogs.concat(logs);
    } catch (err) {
      if (err.message.includes('too many') || err.message.includes('range')) {
        const mid = Math.floor((start + end) / 2);
        try {
          const topics = topic ? [topic] : [];
          const logs1 = await getLogs(rpcUrl, address, start, mid, topics.length ? topics : undefined);
          const logs2 = await getLogs(rpcUrl, address, mid + 1, end, topics.length ? topics : undefined);
          allLogs = allLogs.concat(logs1, logs2);
        } catch (e2) {
          console.error(`Warning: chunk ${start}-${end} failed: ${e2.message}`);
        }
      } else {
        console.error(`Warning: chunk ${start}-${end} failed: ${err.message}`);
      }
    }
  }

  console.log(`Found ${allLogs.length} events`);

  if (allLogs.length === 0) {
    process.exit(0);
  }

  const display = allLogs.slice(-limit);

  const blockNums = [...new Set(display.map((l) => Number(l.blockNumber)))];
  const timestamps = {};
  for (const bn of blockNums) {
    try {
      const block = await getBlock(rpcUrl, bn);
      timestamps[bn] = Number(block.timestamp);
    } catch {
      timestamps[bn] = null;
    }
  }

  if (jsonOutput) {
    const out = display.map((log) => {
      const evt = decodeEvent(log);
      return {
        block: Number(log.blockNumber),
        tx: log.transactionHash,
        logIndex: Number(log.logIndex),
        timestamp: timestamps[Number(log.blockNumber)] || null,
        event: evt.name || 'unknown',
        topic0: log.topics[0],
        args: evt.args || null,
        data: log.data,
      };
    });
    console.log(JSON.stringify(out, null, 2));
  } else {
    if (allLogs.length > limit) {
      console.log(`(showing last ${limit} of ${allLogs.length})`);
    }
    for (const log of display) {
      const evt = decodeEvent(log);
      printEvent(evt, log, timestamps[Number(log.blockNumber)]);
    }
  }

  const eventCounts = {};
  for (const log of allLogs) {
    const evt = decodeEvent(log);
    const name = evt.name || log.topics[0]?.slice(0, 10) || 'unknown';
    eventCounts[name] = (eventCounts[name] || 0) + 1;
  }

  console.log('\n--- Summary ---');
  const sorted = Object.entries(eventCounts).sort((a, b) => b[1] - a[1]);
  for (const [name, count] of sorted) {
    console.log(`  ${name}: ${count}`);
  }
}

main().catch((err) => {
  console.error(`Fatal: ${err.message}`);
  process.exit(1);
});
