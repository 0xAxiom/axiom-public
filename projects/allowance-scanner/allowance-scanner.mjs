#!/usr/bin/env node

// Token Allowance Scanner — find every ERC-20 approval a wallet has granted.
// Zero dependencies. Uses eth_getLogs to find Approval events, then checks
// current allowance state via eth_call. Works on Base, Ethereum, Arbitrum, etc.

const CHAINS = {
  base:     { id: 8453,  rpc: 'https://mainnet.base.org',        name: 'Base' },
  ethereum: { id: 1,     rpc: 'https://eth.llamarpc.com',        name: 'Ethereum' },
  arbitrum: { id: 42161, rpc: 'https://arb1.arbitrum.io/rpc',    name: 'Arbitrum' },
  optimism: { id: 10,    rpc: 'https://mainnet.optimism.io',     name: 'Optimism' },
};

const APPROVAL_TOPIC = '0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925';
const MAX_UINT256 = BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff');
const ALLOWANCE_SIG = '0xdd62ed3e';
const SYMBOL_SIG = '0x95d89b41';
const DECIMALS_SIG = '0x313ce567';
const NAME_SIG = '0x06fdde03';

function padAddress(addr) {
  return '0x' + addr.slice(2).toLowerCase().padStart(64, '0');
}

function unpadAddress(hex) {
  return '0x' + hex.slice(-40);
}

async function rpcCall(rpcUrl, method, params) {
  const res = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const json = await res.json();
  if (json.error) throw new Error(`RPC error: ${json.error.message}`);
  return json.result;
}

function decodeString(hex) {
  if (!hex || hex === '0x' || hex.length < 66) return null;
  try {
    const stripped = hex.slice(2);
    const offset = parseInt(stripped.slice(0, 64), 16) * 2;
    const len = parseInt(stripped.slice(offset, offset + 64), 16);
    const data = stripped.slice(offset + 64, offset + 64 + len * 2);
    const bytes = [];
    for (let i = 0; i < data.length; i += 2) bytes.push(parseInt(data.slice(i, i + 2), 16));
    return new TextDecoder().decode(new Uint8Array(bytes));
  } catch {
    return null;
  }
}

async function getTokenInfo(rpcUrl, tokenAddr) {
  const [symbolHex, decimalsHex, nameHex] = await Promise.all([
    rpcCall(rpcUrl, 'eth_call', [{ to: tokenAddr, data: SYMBOL_SIG }, 'latest']).catch(() => '0x'),
    rpcCall(rpcUrl, 'eth_call', [{ to: tokenAddr, data: DECIMALS_SIG }, 'latest']).catch(() => '0x12'),
    rpcCall(rpcUrl, 'eth_call', [{ to: tokenAddr, data: NAME_SIG }, 'latest']).catch(() => '0x'),
  ]);

  const symbol = decodeString(symbolHex) || tokenAddr.slice(0, 10) + '...';
  const name = decodeString(nameHex) || '';
  const decimals = parseInt(decimalsHex, 16) || 18;
  return { symbol, name, decimals };
}

async function getCurrentAllowance(rpcUrl, tokenAddr, owner, spender) {
  const data = ALLOWANCE_SIG +
    owner.slice(2).toLowerCase().padStart(64, '0') +
    spender.slice(2).toLowerCase().padStart(64, '0');
  const result = await rpcCall(rpcUrl, 'eth_call', [{ to: tokenAddr, data }, 'latest']);
  return BigInt(result);
}

function formatAmount(raw, decimals) {
  if (raw >= MAX_UINT256 - BigInt(1000)) return 'UNLIMITED';
  if (raw === 0n) return '0';
  const str = raw.toString().padStart(decimals + 1, '0');
  const whole = str.slice(0, str.length - decimals) || '0';
  const frac = str.slice(str.length - decimals).replace(/0+$/, '');
  if (!frac) return addCommas(whole);
  return addCommas(whole) + '.' + frac.slice(0, 4);
}

function addCommas(s) {
  return s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

async function scanApprovals(wallet, chainKey, fromBlock) {
  const chain = CHAINS[chainKey];
  if (!chain) {
    console.error(`Unknown chain: ${chainKey}. Options: ${Object.keys(CHAINS).join(', ')}`);
    process.exit(1);
  }

  const paddedWallet = padAddress(wallet);
  console.log(`\nScanning ${chain.name} for approvals by ${wallet}...`);

  const latestBlock = parseInt(await rpcCall(chain.rpc, 'eth_blockNumber', []), 16);
  const startBlock = parseInt(fromBlock, 16);
  const CHUNK = 9999;
  const logs = [];

  const totalChunks = Math.ceil((latestBlock - startBlock) / CHUNK);
  for (let from = startBlock; from <= latestBlock; from += CHUNK + 1) {
    const to = Math.min(from + CHUNK, latestBlock);
    const chunkIdx = Math.floor((from - startBlock) / (CHUNK + 1)) + 1;
    process.stdout.write(`\r  Scanning blocks ${from}..${to} (chunk ${chunkIdx}/${totalChunks})`);
    try {
      const chunk = await rpcCall(chain.rpc, 'eth_getLogs', [{
        fromBlock: '0x' + from.toString(16),
        toBlock: '0x' + to.toString(16),
        topics: [APPROVAL_TOPIC, paddedWallet],
      }]);
      logs.push(...chunk);
    } catch (e) {
      if (e.message.includes('429') || e.message.includes('rate')) {
        await new Promise(r => setTimeout(r, 2000));
        from -= CHUNK + 1;
      }
    }
  }
  process.stdout.write('\n\n');

  if (!logs.length) {
    console.log('No Approval events found.');
    return;
  }

  console.log(`Found ${logs.length} Approval event(s). Checking current state...\n`);

  const seen = new Map();
  for (const log of logs) {
    const token = log.address.toLowerCase();
    const spender = unpadAddress(log.topics[2]);
    const key = `${token}:${spender}`;
    seen.set(key, { token, spender, blockNumber: parseInt(log.blockNumber, 16) });
  }

  const entries = [...seen.values()];
  const BATCH = 10;
  const results = [];

  for (let i = 0; i < entries.length; i += BATCH) {
    const batch = entries.slice(i, i + BATCH);
    const checked = await Promise.all(batch.map(async ({ token, spender, blockNumber }) => {
      try {
        const [allowance, info] = await Promise.all([
          getCurrentAllowance(chain.rpc, token, wallet, spender),
          getTokenInfo(chain.rpc, token),
        ]);
        return { token, spender, allowance, blockNumber, ...info };
      } catch (e) {
        return { token, spender, allowance: -1n, blockNumber, symbol: '???', name: '', decimals: 18, error: e.message };
      }
    }));
    results.push(...checked);
  }

  const active = results.filter(r => r.allowance > 0n);
  const revoked = results.filter(r => r.allowance === 0n);
  const errored = results.filter(r => r.allowance === -1n);

  if (active.length) {
    console.log(`--- ACTIVE APPROVALS (${active.length}) ---\n`);
    for (const r of active) {
      const amount = formatAmount(r.allowance, r.decimals);
      const risk = r.allowance >= MAX_UINT256 - BigInt(1000) ? ' [HIGH RISK]' : '';
      console.log(`  ${r.symbol} (${r.token})`);
      console.log(`    Spender: ${r.spender}`);
      console.log(`    Amount:  ${amount}${risk}`);
      console.log(`    Since block: ${r.blockNumber}`);
      console.log();
    }
  }

  if (revoked.length) {
    console.log(`--- REVOKED (${revoked.length}) ---\n`);
    for (const r of revoked) {
      console.log(`  ${r.symbol} → ${r.spender} (revoked)`);
    }
    console.log();
  }

  if (errored.length) {
    console.log(`--- ERRORS (${errored.length}) ---\n`);
    for (const r of errored) {
      console.log(`  ${r.token} → ${r.spender}: ${r.error}`);
    }
    console.log();
  }

  const unlimited = active.filter(r => r.allowance >= MAX_UINT256 - BigInt(1000));
  console.log('--- SUMMARY ---');
  console.log(`  Active approvals:    ${active.length}`);
  console.log(`  Unlimited approvals: ${unlimited.length}${unlimited.length > 0 ? ' ⚠️' : ''}`);
  console.log(`  Revoked:             ${revoked.length}`);
  console.log(`  Errors:              ${errored.length}`);

  if (unlimited.length > 0) {
    console.log(`\n  ⚠️  ${unlimited.length} unlimited approval(s) found.`);
    console.log('  Consider revoking approvals you no longer use.');
    console.log('  A compromised spender contract can drain your entire balance.');
  }

  return { active, revoked, errored };
}

function usage() {
  console.log(`
allowance-scanner — scan ERC-20 token approvals for any wallet

Usage:
  node allowance-scanner.mjs <wallet> [options]

Options:
  --chain <name>      Chain to scan (default: base)
                      Options: ${Object.keys(CHAINS).join(', ')}
  --from <block>      Start block (hex or decimal, default: 0x0)
  --json              Output as JSON

Examples:
  node allowance-scanner.mjs 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045
  node allowance-scanner.mjs 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045 --chain ethereum
  node allowance-scanner.mjs 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045 --from 18000000 --json
`);
}

async function main() {
  const args = process.argv.slice(2);
  if (!args.length || args.includes('--help') || args.includes('-h')) {
    usage();
    process.exit(0);
  }

  const wallet = args[0];
  if (!/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
    console.error('Invalid wallet address');
    process.exit(1);
  }

  let chain = 'base';
  let fromBlock = '0x0';
  let jsonOutput = false;

  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--chain' && args[i + 1]) { chain = args[++i]; }
    else if (args[i] === '--from' && args[i + 1]) {
      const b = args[++i];
      fromBlock = b.startsWith('0x') ? b : '0x' + parseInt(b).toString(16);
    }
    else if (args[i] === '--json') { jsonOutput = true; }
  }

  const result = await scanApprovals(wallet, chain, fromBlock);

  if (jsonOutput && result) {
    const serializable = {
      active: result.active.map(r => ({
        token: r.token, symbol: r.symbol, name: r.name,
        spender: r.spender,
        allowance: r.allowance.toString(),
        unlimited: r.allowance >= MAX_UINT256 - BigInt(1000),
        decimals: r.decimals,
        sinceBlock: r.blockNumber,
      })),
      revoked: result.revoked.map(r => ({ token: r.token, symbol: r.symbol, spender: r.spender })),
      errors: result.errored.map(r => ({ token: r.token, spender: r.spender, error: r.error })),
    };
    console.log(JSON.stringify(serializable, null, 2));
  }
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
