#!/usr/bin/env node
/**
 * Check ERC-20 token allowance for an owner/spender pair.
 * Zero deps — raw JSON-RPC only.
 *
 * Usage: node check-allowance.mjs <token> <owner> <spender> [rpc_url]
 * Env:   RPC_URL (default: Base mainnet)
 */

const [,, token, owner, spender, rpc = process.env.RPC_URL || 'https://mainnet.base.org'] = process.argv;

if (!token || !owner || !spender) {
  console.error('Usage: check-allowance.mjs <token> <owner> <spender> [rpc_url]');
  console.error('Env:   RPC_URL (default: https://mainnet.base.org)');
  process.exit(1);
}

const norm  = addr => addr.toLowerCase();
const padAddr = addr => norm(addr).replace('0x', '').padStart(64, '0');

async function rpc1(method, params) {
  const res = await fetch(rpc, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const { result, error } = await res.json();
  if (error) throw new Error(`RPC ${method}: ${error.message}`);
  return result;
}

function decodeString(hex) {
  try {
    if (!hex || hex === '0x') return '?';
    const data = hex.slice(2);
    // ABI-encoded string: offset (32) + length (32) + utf8 bytes
    const len = parseInt(data.slice(64, 128), 16);
    if (!len || len > 64) {
      // Fallback: bytes32 style (old tokens like MKR)
      const raw = Buffer.from(data.slice(0, 64), 'hex');
      return raw.toString('utf8').replace(/\0/g, '').trim() || '?';
    }
    return Buffer.from(data.slice(128, 128 + len * 2), 'hex').toString('utf8').trim();
  } catch { return '?'; }
}

function decodeUint(hex) {
  if (!hex || hex === '0x') return 18;
  return Number(BigInt(hex));
}

// well-known ERC-20 selectors
const SEL_ALLOWANCE = '0xdd62ed3e'; // allowance(address,address)
const SEL_SYMBOL    = '0x95d89b41'; // symbol()
const SEL_DECIMALS  = '0x313ce567'; // decimals()

const INFINITE = 2n ** 256n - 1n;
// treat anything > 10^28 as effectively infinite
const INFINITE_THRESHOLD = 10n ** 28n;

async function main() {
  const calldata = SEL_ALLOWANCE + padAddr(owner) + padAddr(spender);

  const [raw, symbolHex, decimalsHex] = await Promise.all([
    rpc1('eth_call', [{ to: token, data: calldata }, 'latest']),
    rpc1('eth_call', [{ to: token, data: SEL_SYMBOL   }, 'latest']).catch(() => '0x'),
    rpc1('eth_call', [{ to: token, data: SEL_DECIMALS }, 'latest']).catch(() => '0x12'),
  ]);

  const allowance = BigInt(raw);
  const decimals  = decodeUint(decimalsHex);
  const symbol    = decodeString(symbolHex);
  const isInfinite = allowance > INFINITE_THRESHOLD;
  const isZero     = allowance === 0n;

  let human;
  if (isInfinite) {
    human = 'INFINITE';
  } else if (isZero) {
    human = '0';
  } else {
    const divisor = 10 ** decimals;
    human = (Number(allowance) / divisor).toFixed(6);
  }

  const result = {
    token:    norm(token),
    owner:    norm(owner),
    spender:  norm(spender),
    symbol,
    decimals,
    allowance: allowance.toString(),
    human:    `${human} ${symbol}`,
    infinite: isInfinite,
    zero:     isZero,
    risk:     isInfinite
      ? 'HIGH — spender can drain all tokens'
      : isZero ? 'NONE' : 'LIMITED',
    rpc,
  };

  console.log(JSON.stringify(result, null, 2));

  if (isInfinite) {
    console.error(`\n⚠  INFINITE APPROVAL — ${norm(spender)} can drain all ${symbol} from ${norm(owner)}`);
    console.error(`   Run: node revoke-calldata.mjs ${token} ${spender} [rpc] to generate revoke tx\n`);
  }
}

main().catch(e => { console.error(e.message); process.exit(1); });
