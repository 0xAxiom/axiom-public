#!/usr/bin/env node
/**
 * contract-reader.mjs — Call any EVM contract view function via raw JSON-RPC
 *
 * Zero dependencies. Pure Node.js 18+. Works on any EVM chain.
 *
 * Usage:
 *   node contract-reader.mjs balance   <address> [chainId]
 *   node contract-reader.mjs erc20     <token> [wallet] [chainId]
 *   node contract-reader.mjs call      <contract> <selector> [arg1 arg2...] --out <types> --chain <chainId>
 *   node contract-reader.mjs slot      <contract> <slot> [chainId]
 *   node contract-reader.mjs block     [chainId]
 *   node contract-reader.mjs selectors
 *   node contract-reader.mjs help
 *
 * ENV:
 *   RPC_URL     Override RPC endpoint
 *   CHAIN_ID    Default chain (default: 8453 = Base)
 */

// ── Public RPC endpoints (free, no API key) ──────────────────────────────────
const RPCS = {
  '1':        'https://eth.llamarpc.com',
  '8453':     'https://mainnet.base.org',
  '42161':    'https://arb1.llamarpc.com',
  '10':       'https://mainnet.optimism.io',
  '137':      'https://polygon-rpc.com',
  '56':       'https://bsc-dataseed.binance.org',
  '43114':    'https://api.avax.network/ext/bc/C/rpc',
  '100':      'https://rpc.gnosischain.com',
  '11155111': 'https://rpc.sepolia.org',
  '84532':    'https://sepolia.base.org',
  '421614':   'https://sepolia-rollup.arbitrum.io/rpc',
};

// ── Built-in function selectors ───────────────────────────────────────────────
// These cover ERC-20, ERC-721, ERC-4626, Uniswap V2/V3, common DeFi reads.
// For custom functions: get selector with `cast sig "fn(type)"` from Foundry,
// or use https://sig.eth.samczsun.com/
const SEL = {
  // ERC-20
  name:              { sel: '0x06fdde03', out: ['string']  },
  symbol:            { sel: '0x95d89b41', out: ['string']  },
  decimals:          { sel: '0x313ce567', out: ['uint8']   },
  totalSupply:       { sel: '0x18160ddd', out: ['uint256'] },
  balanceOf:         { sel: '0x70a08231', out: ['uint256'], args: ['address'] },
  allowance:         { sel: '0xdd62ed3e', out: ['uint256'], args: ['address','address'] },
  // ERC-721
  ownerOf:           { sel: '0x6352211e', out: ['address'], args: ['uint256'] },
  tokenURI:          { sel: '0xc87b56dd', out: ['string'],  args: ['uint256'] },
  // Ownable
  owner:             { sel: '0x8da5cb5b', out: ['address'] },
  getOwner:          { sel: '0x893d20e8', out: ['address'] },
  // Pausable
  paused:            { sel: '0x5c975abb', out: ['bool']    },
  // Uniswap V2 pair
  token0:            { sel: '0x0dfe1681', out: ['address'] },
  token1:            { sel: '0xd21220a7', out: ['address'] },
  factory:           { sel: '0xc45a0155', out: ['address'] },
  getReserves:       { sel: '0x0902f1ac', out: ['uint112','uint112','uint32'] },
  price0CumulativeLast: { sel: '0x5909c0d5', out: ['uint256'] },
  price1CumulativeLast: { sel: '0x5a3d5493', out: ['uint256'] },
  // Uniswap V3 pool
  liquidity:         { sel: '0x1a686502', out: ['uint128'] },
  slot0:             { sel: '0x3850c7bd', out: ['uint160','int24','uint16','uint16','uint16','uint8','bool'] },
  fee:               { sel: '0xddca3f43', out: ['uint24']  },
  sqrtPriceX96:      { sel: '0xa34123a7', out: ['uint160','int24'] },
  // ERC-4626 vault
  totalAssets:       { sel: '0x01e1d114', out: ['uint256'] },
  convertToShares:   { sel: '0xc6e6f592', out: ['uint256'], args: ['uint256'] },
  convertToAssets:   { sel: '0x07a2d13a', out: ['uint256'], args: ['uint256'] },
  asset:             { sel: '0x38d52e0f', out: ['address'] },
  // Aave
  getReserveData:    { sel: '0x35ea6a75', out: ['uint256','uint128','uint128','uint128','uint128','uint128','uint40','uint16','address','address','address','address'], args: ['address'] },
  // Price feeds (Chainlink-style)
  latestAnswer:      { sel: '0x50d25bcd', out: ['int256'] },
  latestRoundData:   { sel: '0xfeaf968c', out: ['uint80','int256','uint256','uint256','uint80'] },
  description:       { sel: '0x7284e416', out: ['string'] },
  // Misc
  implementation:    { sel: '0x5c60da1b', out: ['address'] },
  admin:             { sel: '0xf851a440', out: ['address'] },
  pendingOwner:      { sel: '0xe30c3978', out: ['address'] },
  nonces:            { sel: '0x7ecebe00', out: ['uint256'], args: ['address'] },
  DOMAIN_SEPARATOR:  { sel: '0x3644e515', out: ['bytes32'] },
  cap:               { sel: '0x355274ea', out: ['uint256'] },
  version:           { sel: '0x54fd4d50', out: ['string'] },
};

// ── ABI helpers ───────────────────────────────────────────────────────────────

function padLeft(hex, len = 64) {
  return hex.replace(/^0x/i, '').padStart(len, '0');
}

function encodeArg(type, value) {
  const t = type.toLowerCase().trim();
  if (t === 'address') return padLeft(String(value).toLowerCase());
  if (t === 'bool')    return (value === 'true' || value === true ? 1n : 0n).toString(16).padStart(64, '0');
  if (t.startsWith('uint') || t.startsWith('int')) return BigInt(value).toString(16).padStart(64, '0');
  if (t === 'bytes32') return String(value).replace(/^0x/i, '').padEnd(64, '0');
  throw new Error(`Unsupported input type: ${type}. Use address, uint256, bool, or bytes32.`);
}

// Auto-detect type from value and encode
function encodeAuto(value) {
  if (/^0x[0-9a-f]{40}$/i.test(value)) return encodeArg('address', value);
  if (/^\d+$/.test(value))              return encodeArg('uint256', value);
  if (/^true|false$/i.test(value))      return encodeArg('bool', value);
  if (/^0x[0-9a-f]{1,64}$/i.test(value)) return padLeft(value);
  throw new Error(`Cannot auto-detect type for: ${value}. Use address:0x... or uint256:123`);
}

// Decode a single 32-byte word
function decodeWord(type, word) {
  const t = type.toLowerCase().trim();
  if (t === 'address')             return '0x' + word.slice(-40);
  if (t.startsWith('uint'))        return BigInt('0x' + word).toString();
  if (t.startsWith('int')) {
    const bits = parseInt(t.replace('int', '')) || 256;
    const n    = BigInt('0x' + word);
    const max  = 1n << BigInt(bits - 1);
    return (n >= max ? n - (1n << BigInt(bits)) : n).toString();
  }
  if (t === 'bool')                return word.slice(-1) !== '0';
  if (t === 'bytes32')             return '0x' + word;
  return '0x' + word;
}

// Decode ABI-encoded return data
function decodeReturn(hex, outputTypes) {
  if (!hex || hex === '0x' || !outputTypes?.length) return hex ?? null;
  const data = hex.replace(/^0x/i, '');
  if (data.length < 64) return hex;

  const results = outputTypes.map((type, i) => {
    const t = type.toLowerCase().trim();
    const word = data.slice(i * 64, i * 64 + 64);

    if (t === 'string' || t === 'bytes') {
      // Dynamic type: word is an offset (in bytes)
      const offset = parseInt(word, 16) * 2; // hex chars
      if (offset >= data.length) return null;
      const lenWord = data.slice(offset, offset + 64);
      const len     = parseInt(lenWord, 16);
      const raw     = data.slice(offset + 64, offset + 64 + len * 2);
      return t === 'string' ? Buffer.from(raw, 'hex').toString('utf8') : '0x' + raw;
    }
    return decodeWord(t, word);
  });

  return results.length === 1 ? results[0] : results;
}

// ── JSON-RPC ──────────────────────────────────────────────────────────────────

async function rpc(url, method, params) {
  const res  = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  const json = await res.json();
  if (json.error) throw new Error(`RPC error [${json.error.code}]: ${json.error.message}`);
  return json.result;
}

function getRpc(chainId) {
  const id  = String(chainId ?? process.env.CHAIN_ID ?? '8453');
  const url = process.env.RPC_URL ?? RPCS[id];
  if (!url) throw new Error(`No RPC for chain ${id}. Set RPC_URL env var. Known chains: ${Object.keys(RPCS).join(', ')}`);
  return url;
}

// ── Commands ──────────────────────────────────────────────────────────────────

async function cmdBalance([address, chainId]) {
  if (!address) throw new Error('Usage: balance <address> [chainId]');
  const url  = getRpc(chainId);
  const hex  = await rpc(url, 'eth_getBalance', [address, 'latest']);
  const wei  = BigInt(hex);
  const eth  = (Number(wei) / 1e18).toFixed(6);
  console.log(JSON.stringify({ address, chain: String(chainId ?? process.env.CHAIN_ID ?? '8453'), wei: wei.toString(), eth }));
}

async function cmdErc20([token, walletOrChain, chainIdArg]) {
  if (!token) throw new Error('Usage: erc20 <tokenAddress> [walletAddress] [chainId]');
  // Detect if 2nd arg is chainId (numeric) or wallet address (starts with 0x, 40+ hex chars)
  let wallet, chainId;
  if (!walletOrChain) {
    wallet = undefined; chainId = undefined;
  } else if (/^\d+$/.test(walletOrChain) || !/^0x[0-9a-f]{38,}/i.test(walletOrChain)) {
    wallet = undefined; chainId = walletOrChain;
  } else {
    wallet = walletOrChain; chainId = chainIdArg;
  }
  const url = getRpc(chainId);

  const ethCall = (sel, args = '') =>
    rpc(url, 'eth_call', [{ to: token, data: sel + args }, 'latest']).catch(() => null);

  const [nameHex, symHex, decHex, supplyHex] = await Promise.all([
    ethCall(SEL.name.sel),
    ethCall(SEL.symbol.sel),
    ethCall(SEL.decimals.sel),
    ethCall(SEL.totalSupply.sel),
  ]);

  const decimals = decHex ? Number(BigInt(decHex)) : 18;
  const supply   = supplyHex ? BigInt(supplyHex) : 0n;
  const fmt      = (raw, dec) => (Number(raw) / 10 ** dec).toFixed(dec > 6 ? 4 : dec);

  const result = {
    address:     token,
    chain:       String(chainId ?? process.env.CHAIN_ID ?? '8453'),
    name:        nameHex    ? decodeReturn(nameHex,    ['string']) : null,
    symbol:      symHex     ? decodeReturn(symHex,     ['string']) : null,
    decimals,
    totalSupply: fmt(supply, decimals),
  };

  if (wallet) {
    const balHex = await ethCall(SEL.balanceOf.sel, encodeArg('address', wallet));
    if (balHex) {
      const raw     = BigInt(balHex);
      result.wallet  = wallet;
      result.balance = fmt(raw, decimals);
      result.balanceRaw = raw.toString();
    }
  }

  console.log(JSON.stringify(result, null, 2));
}

async function cmdCall(rawArgs) {
  // call <contract> <selector|funcName> [arg1 arg2...] [--out type,type] [--chain id]
  const chainIdx  = rawArgs.indexOf('--chain');
  const outIdx    = rawArgs.indexOf('--out');
  const chainId   = chainIdx >= 0 ? rawArgs[chainIdx + 1] : undefined;
  const outStr    = outIdx   >= 0 ? rawArgs[outIdx   + 1] : undefined;
  const flagIdxs  = new Set();
  if (chainIdx >= 0) { flagIdxs.add(chainIdx); flagIdxs.add(chainIdx + 1); }
  if (outIdx   >= 0) { flagIdxs.add(outIdx);   flagIdxs.add(outIdx   + 1); }
  const pos = rawArgs.filter((_, i) => !flagIdxs.has(i));

  const [contract, selectorArg, ...callArgs] = pos;
  if (!contract || !selectorArg) {
    throw new Error('Usage: call <contract> <selector|funcName> [args...] [--out type,type] [--chain chainId]');
  }

  const builtin = SEL[selectorArg];
  const sel     = builtin?.sel ?? selectorArg;
  if (!sel.startsWith('0x') || sel.length !== 10) {
    throw new Error(`Unknown function "${selectorArg}". Use a built-in name (see selectors) or a 4-byte hex like 0x70a08231`);
  }

  let encoded = '';
  for (let i = 0; i < callArgs.length; i++) {
    const a = callArgs[i];
    if (a.includes(':')) {
      const colon = a.indexOf(':');
      encoded += encodeArg(a.slice(0, colon), a.slice(colon + 1));
    } else {
      encoded += encodeAuto(a);
    }
  }

  const url    = getRpc(chainId);
  const result = await rpc(url, 'eth_call', [{ to: contract, data: sel + encoded }, 'latest']);
  const types  = outStr ? outStr.split(',') : (builtin?.out ?? null);
  const decoded = types ? decodeReturn(result, types) : result;

  console.log(JSON.stringify({ contract, selector: sel, raw: result, decoded, types }, null, 2));
}

async function cmdSlot([contract, slot, chainId]) {
  if (!contract || slot === undefined) throw new Error('Usage: slot <contract> <slot> [chainId]');
  const url     = getRpc(chainId);
  const slotHex = '0x' + BigInt(slot).toString(16).padStart(64, '0');
  const value   = await rpc(url, 'eth_getStorageAt', [contract, slotHex, 'latest']);
  console.log(JSON.stringify({ contract, slot: Number(slot), slotHex, value }));
}

async function cmdBlock([chainId]) {
  const url    = getRpc(chainId);
  const block  = await rpc(url, 'eth_blockNumber', []);
  const num    = parseInt(block, 16);
  const details = await rpc(url, 'eth_getBlockByNumber', [block, false]);
  console.log(JSON.stringify({
    chain:    String(chainId ?? process.env.CHAIN_ID ?? '8453'),
    block:    num,
    hex:      block,
    timestamp: details?.timestamp ? parseInt(details.timestamp, 16) : null,
    time:      details?.timestamp ? new Date(parseInt(details.timestamp, 16) * 1000).toISOString() : null,
  }));
}

function cmdSelectors() {
  console.log('Built-in function selectors:\n');
  for (const [name, { sel, out, args }] of Object.entries(SEL)) {
    const argStr = args?.join(',') ?? '';
    const outStr = out.join(',');
    console.log(`  ${name.padEnd(22)} ${sel}  (${argStr || 'void'}) -> ${outStr}`);
  }
  console.log('\nFor custom selectors: cast sig "fn(type1,type2)" (Foundry)');
  console.log('Or online: https://sig.eth.samczsun.com/');
}

function cmdHelp() {
  console.log(`
contract-reader.mjs — Read any EVM contract view function via raw JSON-RPC
Zero dependencies. Pure Node.js 18+.

COMMANDS:
  balance <address> [chainId]
    Get native balance (ETH/MATIC/etc)

  erc20 <tokenAddress> [walletAddress] [chainId]
    Token info: name, symbol, decimals, totalSupply, balance

  call <contract> <selector|funcName> [args...] [--out types] [--chain chainId]
    Call any view function. selector: built-in name OR 4-byte hex (0x70a08231)
    args: auto-detected (0x address, integer) or typed (address:0x..., uint256:123)
    --out: comma-separated return types (address,uint256,bool,string,bytes32,int256)

  slot <contract> <slot> [chainId]
    Read a raw storage slot (EVM storage layout)

  block [chainId]
    Current block number and timestamp

  selectors
    List all built-in function selectors with signatures

ENV VARS:
  RPC_URL     Override RPC endpoint
  CHAIN_ID    Default chain (default: 8453 Base)

CHAIN IDs:
  1=Ethereum  8453=Base  42161=Arbitrum  10=Optimism  137=Polygon
  56=BSC  100=Gnosis  11155111=Sepolia  84532=Base Sepolia

EXAMPLES:
  # Native balance on Base
  node contract-reader.mjs balance 0x742d35Cc6634C0532925a3b8D4C9B0d3B8e5A2e4 8453

  # ERC-20 info + wallet balance
  node contract-reader.mjs erc20 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 0xYourWallet 8453

  # Call totalSupply by built-in name
  node contract-reader.mjs call 0xToken totalSupply --chain 8453

  # Call Chainlink price feed
  node contract-reader.mjs call 0xFeedAddress latestAnswer --chain 8453

  # Call a custom function with hex selector + auto-detected arg
  node contract-reader.mjs call 0xContract 0x70a08231 0xWalletAddress --out uint256 --chain 1

  # Call with typed args
  node contract-reader.mjs call 0xPair allowance address:0xOwner address:0xSpender --out uint256 --chain 8453

  # Read Uniswap V2 reserves
  node contract-reader.mjs call 0xPairAddress getReserves --chain 8453

  # Read storage slot 0 (often the owner or token address)
  node contract-reader.mjs slot 0xContract 0 8453

  # Current block on Arbitrum
  node contract-reader.mjs block 42161
`.trim());
}

// ── Main ──────────────────────────────────────────────────────────────────────

const [,, cmd, ...args] = process.argv;

const commands = {
  balance:   cmdBalance,
  erc20:     cmdErc20,
  call:      cmdCall,
  slot:      cmdSlot,
  block:     cmdBlock,
  selectors: cmdSelectors,
  help:      cmdHelp,
};

const fn = commands[cmd];
if (!fn) {
  if (cmd) console.error(`Unknown command: ${cmd}\n`);
  cmdHelp();
  process.exit(cmd ? 1 : 0);
}

fn(args).catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
