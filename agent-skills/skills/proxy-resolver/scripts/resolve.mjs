#!/usr/bin/env node
// proxy-resolver: detect EIP-1167 minimal proxies and ERC-1967 upgradeable
// proxies on any EVM chain; resolve to implementation address.
//
// Usage:
//   node resolve.mjs <address> [--rpc <url>] [--chain base|mainnet|optimism|arbitrum|polygon|sepolia]
//   node resolve.mjs <address> --json
//   node resolve.mjs <address> --recurse   # follow proxy chains
//
// Exit codes: 0 ok, 1 input/RPC error.

const RPCS = {
  base:     'https://mainnet.base.org',
  mainnet:  'https://eth.llamarpc.com',
  optimism: 'https://mainnet.optimism.io',
  arbitrum: 'https://arb1.arbitrum.io/rpc',
  polygon:  'https://polygon-rpc.com',
  sepolia:  'https://sepolia.base.org',
};

// ERC-1967 storage slots
const SLOT_IMPL  = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc'; // keccak256("eip1967.proxy.implementation") - 1
const SLOT_ADMIN = '0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103';
const SLOT_BEACON = '0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50';
// EIP-1822 (UUPS) legacy slot
const SLOT_1822  = '0x7050c9e0f4ca769c69bd3a8ef740bc37934f8e2c036e5a723fd8ee048ed3f8c3';

// EIP-1167 minimal proxy bytecode pattern (45 bytes):
// 363d3d373d3d3d363d73<20-byte impl>5af43d82803e903d91602b57fd5bf3
const CLONE_RE = /^0x363d3d373d3d3d363d73([0-9a-f]{40})5af43d82803e903d91602b57fd5bf3$/i;
// PUSH0 variant (post-Shanghai, used by some Solady factories):
// 5f5f365f5f37365f73<20-byte impl>5af43d5f5f3e5f3d91602a57fd5bf3 (44 bytes)
const CLONE_PUSH0_RE = /^0x5f5f365f5f37365f73([0-9a-f]{40})5af43d5f5f3e5f3d91602a57fd5bf3$/i;
// EIP-1167 with immutable args (OpenZeppelin ClonesWithImmutableArgs):
// starts with the clone prefix but has extra trailing data
const CLONE_PREFIX_RE = /^0x363d3d373d3d3d363d73([0-9a-f]{40})5af43d82803e903d91602b57fd5bf3/i;

function parseArgs(argv) {
  const args = { recurse: false, json: false, chain: 'base', rpc: null, address: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--recurse') args.recurse = true;
    else if (a === '--json') args.json = true;
    else if (a === '--chain') args.chain = argv[++i];
    else if (a === '--rpc') args.rpc = argv[++i];
    else if (!args.address) args.address = a;
  }
  return args;
}

async function rpc(url, method, params) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  if (!res.ok) throw new Error(`rpc http ${res.status}`);
  const json = await res.json();
  if (json.error) throw new Error(`rpc error: ${json.error.message}`);
  return json.result;
}

function slotToAddress(slotValue) {
  if (!slotValue || slotValue === '0x' || /^0x0+$/.test(slotValue)) return null;
  const addr = '0x' + slotValue.slice(-40).toLowerCase();
  if (/^0x0+$/.test(addr)) return null;
  return addr;
}

async function inspect(url, address) {
  const addr = address.toLowerCase();
  const code = await rpc(url, 'eth_getCode', [addr, 'latest']);

  if (!code || code === '0x') {
    return { address: addr, type: 'eoa', hasCode: false };
  }

  // EIP-1167 exact-match
  let m = CLONE_RE.exec(code);
  if (m) return { address: addr, type: 'minimal-proxy', standard: 'EIP-1167', implementation: '0x' + m[1].toLowerCase(), bytecodeLen: (code.length - 2) / 2 };

  m = CLONE_PUSH0_RE.exec(code);
  if (m) return { address: addr, type: 'minimal-proxy', standard: 'EIP-1167-PUSH0', implementation: '0x' + m[1].toLowerCase(), bytecodeLen: (code.length - 2) / 2 };

  // EIP-1167 with immutable args (Solady CloneWithImmutableArgs)
  m = CLONE_PREFIX_RE.exec(code);
  if (m) {
    const tailHex = code.slice(2 + 2 * 45); // strip prefix
    return {
      address: addr,
      type: 'minimal-proxy',
      standard: 'EIP-1167-with-immutable-args',
      implementation: '0x' + m[1].toLowerCase(),
      immutableArgsBytes: tailHex.length / 2,
      bytecodeLen: (code.length - 2) / 2,
    };
  }

  // ERC-1967 / UUPS / TransparentUpgradeableProxy
  const [implRaw, adminRaw, beaconRaw, legacyRaw] = await Promise.all([
    rpc(url, 'eth_getStorageAt', [addr, SLOT_IMPL, 'latest']),
    rpc(url, 'eth_getStorageAt', [addr, SLOT_ADMIN, 'latest']),
    rpc(url, 'eth_getStorageAt', [addr, SLOT_BEACON, 'latest']),
    rpc(url, 'eth_getStorageAt', [addr, SLOT_1822, 'latest']),
  ]);
  const impl = slotToAddress(implRaw);
  const admin = slotToAddress(adminRaw);
  const beacon = slotToAddress(beaconRaw);
  const legacy = slotToAddress(legacyRaw);

  if (impl) {
    return { address: addr, type: 'erc1967-proxy', standard: 'ERC-1967', implementation: impl, admin, bytecodeLen: (code.length - 2) / 2 };
  }
  if (beacon) {
    // beacon proxies hold beacon address; the beacon itself returns the impl
    return { address: addr, type: 'beacon-proxy', standard: 'ERC-1967-beacon', beacon, bytecodeLen: (code.length - 2) / 2 };
  }
  if (legacy) {
    return { address: addr, type: 'uups-proxy', standard: 'EIP-1822', implementation: legacy, bytecodeLen: (code.length - 2) / 2 };
  }

  // Diamond (EIP-2535) detection: bytecode often very small, contains DELEGATECALL,
  // but no standard slot — heuristic only.
  const looksTiny = (code.length - 2) / 2 < 200;
  return {
    address: addr,
    type: looksTiny ? 'contract-small' : 'contract',
    standard: null,
    implementation: null,
    bytecodeLen: (code.length - 2) / 2,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.address || !/^0x[0-9a-fA-F]{40}$/.test(args.address)) {
    console.error('usage: resolve.mjs <0xAddress> [--chain base|mainnet|...] [--rpc URL] [--json] [--recurse]');
    process.exit(1);
  }
  const url = args.rpc || RPCS[args.chain];
  if (!url) {
    console.error(`unknown chain: ${args.chain}. use one of: ${Object.keys(RPCS).join(', ')} or --rpc URL`);
    process.exit(1);
  }

  const chain = [];
  let current = args.address;
  const seen = new Set();
  while (current) {
    if (seen.has(current.toLowerCase())) {
      chain.push({ address: current.toLowerCase(), error: 'proxy loop detected' });
      break;
    }
    seen.add(current.toLowerCase());
    const info = await inspect(url, current);
    chain.push(info);
    if (!args.recurse) break;
    current = info.implementation || null;
    if (!current) break;
  }

  if (args.json) {
    console.log(JSON.stringify(args.recurse ? chain : chain[0], null, 2));
    return;
  }

  for (const info of chain) {
    const lines = [];
    lines.push(`address:       ${info.address}`);
    lines.push(`type:          ${info.type}${info.standard ? ` (${info.standard})` : ''}`);
    if (info.implementation) lines.push(`implementation: ${info.implementation}`);
    if (info.beacon)         lines.push(`beacon:        ${info.beacon}`);
    if (info.admin)          lines.push(`admin:         ${info.admin}`);
    if (info.immutableArgsBytes != null) lines.push(`immutable args: ${info.immutableArgsBytes} bytes`);
    if (info.bytecodeLen != null) lines.push(`bytecode:      ${info.bytecodeLen} bytes`);
    if (info.error)          lines.push(`error:         ${info.error}`);
    console.log(lines.join('\n'));
    if (chain.length > 1 && info !== chain[chain.length - 1]) console.log('  ↓');
  }
}

main().catch((e) => { console.error('error:', e.message); process.exit(1); });
