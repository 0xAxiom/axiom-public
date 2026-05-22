#!/usr/bin/env node
/**
 * Generate calldata to revoke (set to 0) an ERC-20 token approval.
 * Prints the unsigned transaction — does NOT send. Pipe to your signing tool.
 *
 * Usage: node revoke-calldata.mjs <token> <spender> [rpc_url]
 * Env:   RPC_URL
 *
 * Output: JSON tx object compatible with cast send, bankr.sh, or tx-simulator.mjs
 */

const [,, token, spender, rpc = process.env.RPC_URL || 'https://mainnet.base.org'] = process.argv;

if (!token || !spender) {
  console.error('Usage: revoke-calldata.mjs <token> <spender> [rpc_url]');
  process.exit(1);
}

// approve(address,uint256) selector
const SEL_APPROVE = '0x095ea7b3';
const SEL_SYMBOL  = '0x95d89b41';

function padAddr(addr) {
  return addr.toLowerCase().replace('0x', '').padStart(64, '0');
}

function decodeString(hex) {
  try {
    if (!hex || hex === '0x') return token;
    const data = hex.slice(2);
    const len = parseInt(data.slice(64, 128), 16);
    if (!len || len > 64) {
      return Buffer.from(data.slice(0, 64), 'hex').toString('utf8').replace(/\0/g, '').trim() || token;
    }
    return Buffer.from(data.slice(128, 128 + len * 2), 'hex').toString('utf8').trim();
  } catch { return token; }
}

async function main() {
  // approve(spender, 0) — the standard revoke pattern
  const calldata = SEL_APPROVE + padAddr(spender) + '0'.repeat(64);

  let symbol = token;
  try {
    const res = await fetch(rpc, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'eth_call',
        params: [{ to: token, data: SEL_SYMBOL }, 'latest'],
      }),
    });
    const { result } = await res.json();
    symbol = decodeString(result);
  } catch {}

  const tx = {
    to:    token.toLowerCase(),
    data:  calldata,
    value: '0x0',
    meta: {
      action:  'revoke',
      token:   token.toLowerCase(),
      symbol,
      spender: spender.toLowerCase(),
      description: `Revoke ${symbol} approval for spender ${spender.toLowerCase()}`,
    },
  };

  console.log(JSON.stringify(tx, null, 2));

  console.error(`\nSend from the owner wallet to execute the revoke.`);
  console.error(`  cast:    cast send ${token} "${calldata}" --rpc-url ${rpc}`);
  console.error(`  verify:  node check-allowance.mjs ${token} <owner> ${spender} ${rpc}\n`);
}

main().catch(e => { console.error(e.message); process.exit(1); });
