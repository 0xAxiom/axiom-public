#!/usr/bin/env node

// Proxy Detector — detect proxy contracts and find their implementation.
// Checks EIP-1967 (TransparentProxy, UUPS), EIP-1822 (UUPS), EIP-897 (DelegateProxy),
// and beacon patterns. Zero dependencies. Works on Base, Ethereum, Arbitrum, Optimism.

const CHAINS = {
  base:     { id: 8453,  rpc: 'https://mainnet.base.org',        name: 'Base' },
  ethereum: { id: 1,     rpc: 'https://eth.llamarpc.com',        name: 'Ethereum' },
  arbitrum: { id: 42161, rpc: 'https://arb1.arbitrum.io/rpc',    name: 'Arbitrum' },
  optimism: { id: 10,    rpc: 'https://mainnet.optimism.io',     name: 'Optimism' },
};

// EIP-1967 storage slots
const SLOTS = {
  // bytes32(uint256(keccak256("eip1967.proxy.implementation")) - 1)
  implementation: '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc',
  // bytes32(uint256(keccak256("eip1967.proxy.beacon")) - 1)
  beacon:         '0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50',
  // bytes32(uint256(keccak256("eip1967.proxy.admin")) - 1)
  admin:          '0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103',
  // EIP-1822 (older UUPS)
  eip1822:        '0xc5f16f0fcc639fa48a6947836d9850f504798523bf8c9a3a87d5876cf622bcf7',
};

// Function selectors
const SELECTORS = {
  implementation: '0x5c60da1b', // implementation()
  beacon:         '0x59659e90', // beacon() — not standard but some proxies expose it
  proxiableUUID:  '0x52d1902d', // proxiableUUID() — EIP-1822
  getImplementation: '0xaaf10f42', // getImplementation() — some OpenZeppelin proxies
};

const ZERO_ADDR = '0x' + '0'.repeat(40);
const ZERO_SLOT = '0x' + '0'.repeat(64);

let _rpcId = 1;

async function rpcCall(rpcUrl, method, params) {
  const res = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: _rpcId++, method, params }),
  });
  const json = await res.json();
  if (json.error) throw new Error(`RPC error: ${json.error.message}`);
  return json.result;
}

function extractAddress(slot) {
  if (!slot || slot === ZERO_SLOT || slot.length < 42) return null;
  const addr = '0x' + slot.slice(-40);
  return addr === ZERO_ADDR ? null : addr;
}

async function getStorageAt(rpcUrl, address, slot) {
  return rpcCall(rpcUrl, 'eth_getStorageAt', [address, slot, 'latest']);
}

async function ethCall(rpcUrl, to, data) {
  try {
    return await rpcCall(rpcUrl, 'eth_call', [{ to, data }, 'latest']);
  } catch {
    return null;
  }
}

async function getCode(rpcUrl, address) {
  return rpcCall(rpcUrl, 'eth_getCode', [address, 'latest']);
}

async function detectProxy(rpcUrl, address) {
  const results = {
    address,
    isProxy: false,
    proxyType: null,
    implementation: null,
    beacon: null,
    admin: null,
    checks: [],
  };

  // First verify it's a contract
  const code = await getCode(rpcUrl, address);
  if (!code || code === '0x' || code === '0x0') {
    results.checks.push({ method: 'getCode', result: 'EOA or empty — not a contract' });
    return results;
  }

  // 1. EIP-1967 implementation slot
  const implSlot = await getStorageAt(rpcUrl, address, SLOTS.implementation);
  const implAddr = extractAddress(implSlot);
  if (implAddr) {
    results.isProxy = true;
    results.implementation = implAddr;
    results.checks.push({ method: 'EIP-1967 impl slot', result: implAddr });

    // Check if it has a beacon too
    const beaconSlot = await getStorageAt(rpcUrl, address, SLOTS.beacon);
    const beaconAddr = extractAddress(beaconSlot);
    if (beaconAddr) {
      results.beacon = beaconAddr;
      results.proxyType = 'BeaconProxy (EIP-1967)';
      results.checks.push({ method: 'EIP-1967 beacon slot', result: beaconAddr });
    } else {
      // Distinguish UUPS vs Transparent by checking if impl has proxiableUUID
      const uuid = await ethCall(rpcUrl, implAddr, SELECTORS.proxiableUUID);
      if (uuid && uuid !== '0x' && uuid.length > 2) {
        results.proxyType = 'UUPS (EIP-1967)';
        results.checks.push({ method: 'proxiableUUID() on impl', result: 'present — UUPS' });
      } else {
        results.proxyType = 'TransparentProxy (EIP-1967)';
      }
    }

    // Admin slot
    const adminSlot = await getStorageAt(rpcUrl, address, SLOTS.admin);
    const adminAddr = extractAddress(adminSlot);
    if (adminAddr) {
      results.admin = adminAddr;
      results.checks.push({ method: 'EIP-1967 admin slot', result: adminAddr });
    }

    return results;
  }
  results.checks.push({ method: 'EIP-1967 impl slot', result: 'empty' });

  // 2. EIP-1967 beacon slot
  const beaconSlot = await getStorageAt(rpcUrl, address, SLOTS.beacon);
  const beaconAddr = extractAddress(beaconSlot);
  if (beaconAddr) {
    results.isProxy = true;
    results.proxyType = 'BeaconProxy (EIP-1967)';
    results.beacon = beaconAddr;
    results.checks.push({ method: 'EIP-1967 beacon slot', result: beaconAddr });

    // Read implementation from beacon
    const beaconImpl = await ethCall(rpcUrl, beaconAddr, SELECTORS.implementation);
    if (beaconImpl) {
      const beaconImplAddr = extractAddress(beaconImpl);
      if (beaconImplAddr) {
        results.implementation = beaconImplAddr;
        results.checks.push({ method: 'beacon.implementation()', result: beaconImplAddr });
      }
    }
    return results;
  }
  results.checks.push({ method: 'EIP-1967 beacon slot', result: 'empty' });

  // 3. EIP-1822 slot
  const eip1822Slot = await getStorageAt(rpcUrl, address, SLOTS.eip1822);
  const eip1822Addr = extractAddress(eip1822Slot);
  if (eip1822Addr) {
    results.isProxy = true;
    results.proxyType = 'UUPS (EIP-1822)';
    results.implementation = eip1822Addr;
    results.checks.push({ method: 'EIP-1822 slot', result: eip1822Addr });
    return results;
  }
  results.checks.push({ method: 'EIP-1822 slot', result: 'empty' });

  // 4. Try implementation() function call (EIP-897 / custom proxies)
  const implCall = await ethCall(rpcUrl, address, SELECTORS.implementation);
  if (implCall && implCall !== '0x') {
    const implCallAddr = extractAddress(implCall);
    if (implCallAddr) {
      results.isProxy = true;
      results.proxyType = 'DelegateProxy (EIP-897)';
      results.implementation = implCallAddr;
      results.checks.push({ method: 'implementation() call', result: implCallAddr });
      return results;
    }
  }
  results.checks.push({ method: 'implementation() call', result: 'empty or reverted' });

  // 5. Try getImplementation() — some older OpenZeppelin proxies
  const getImpl = await ethCall(rpcUrl, address, SELECTORS.getImplementation);
  if (getImpl && getImpl !== '0x') {
    const getImplAddr = extractAddress(getImpl);
    if (getImplAddr) {
      results.isProxy = true;
      results.proxyType = 'Proxy (getImplementation)';
      results.implementation = getImplAddr;
      results.checks.push({ method: 'getImplementation() call', result: getImplAddr });
      return results;
    }
  }
  results.checks.push({ method: 'getImplementation() call', result: 'empty or reverted' });

  // 6. Minimal proxy (EIP-1167 clone) detection via bytecode
  // Pattern: 0x363d3d373d3d3d363d73<addr>5af43d82803e903d91602b57fd5bf3
  const codeHex = code.toLowerCase();
  if (codeHex.startsWith('0x363d3d373d3d3d363d73') && codeHex.endsWith('5af43d82803e903d91602b57fd5bf3')) {
    const cloneTarget = '0x' + codeHex.slice(22, 62);
    results.isProxy = true;
    results.proxyType = 'Minimal Proxy (EIP-1167 clone)';
    results.implementation = cloneTarget;
    results.checks.push({ method: 'EIP-1167 bytecode pattern', result: cloneTarget });
    return results;
  }
  results.checks.push({ method: 'EIP-1167 bytecode pattern', result: 'no match' });

  return results;
}

function formatResult(result, chain) {
  const lines = [];
  lines.push(`\n  Contract: ${result.address} (${chain})`);
  lines.push(`  --------`);

  if (!result.isProxy) {
    lines.push(`  Not a proxy contract.`);
  } else {
    lines.push(`  Proxy type:      ${result.proxyType}`);
    lines.push(`  Implementation:  ${result.implementation}`);
    if (result.beacon) lines.push(`  Beacon:          ${result.beacon}`);
    if (result.admin)  lines.push(`  Admin:           ${result.admin}`);
  }

  if (result.checks.length > 0) {
    lines.push(`\n  Detection log:`);
    for (const c of result.checks) {
      lines.push(`    ${c.method}: ${c.result}`);
    }
  }

  return lines.join('\n');
}

// --- CLI ---
const args = process.argv.slice(2);
if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
  console.log(`
  proxy-detector — detect proxy contracts and reveal their implementation

  Usage:
    proxy-detector <address> [--chain base|ethereum|arbitrum|optimism] [--json]

  Examples:
    proxy-detector 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913           # USDC on Base
    proxy-detector 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48 --chain ethereum
    proxy-detector 0x1234...abcd --json

  Checks (in order):
    1. EIP-1967 implementation slot
    2. EIP-1967 beacon slot
    3. EIP-1822 (older UUPS) slot
    4. EIP-897 implementation() function
    5. getImplementation() function
    6. EIP-1167 minimal proxy (clone) bytecode
`);
  process.exit(0);
}

let address = null;
let chainKey = 'base';
let jsonOutput = false;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--chain' && args[i + 1]) {
    chainKey = args[++i].toLowerCase();
  } else if (args[i] === '--json') {
    jsonOutput = true;
  } else if (args[i].startsWith('0x')) {
    address = args[i];
  }
}

if (!address) {
  console.error('Error: no address provided');
  process.exit(1);
}

const chain = CHAINS[chainKey];
if (!chain) {
  console.error(`Error: unknown chain "${chainKey}". Use: ${Object.keys(CHAINS).join(', ')}`);
  process.exit(1);
}

(async () => {
  try {
    const result = await detectProxy(chain.rpc, address);
    if (jsonOutput) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(formatResult(result, chain.name));
    }
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
})();
