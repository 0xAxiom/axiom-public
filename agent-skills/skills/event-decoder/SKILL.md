# event-decoder

Decode raw EVM event logs without ethers.js, web3, or any dependencies.

## When to use this skill

- You called `eth_getLogs` and got back hex blobs you need to parse
- You want to decode Transfer, Approval, Swap, or any custom event
- You're building a DeFi monitor and need typed values from raw log data
- You have a topic0 hash and want to extract the event parameters

## What it does NOT require

- ethers.js
- web3.js
- Any npm packages
- An API key
- A running node (just provide the RPC URL)

## Scripts

### `scripts/decode-event.js` (library + CLI)

Core decoder. Handles indexed params (from topics) and non-indexed params (from data field).

**Supported types:** `address`, `uint*`, `int*`, `bool`, `bytes`, `bytes32`, `bytesN`, `string`, `T[]` (dynamic arrays)

**As a library:**
```js
const { decodeEvent } = require('./scripts/decode-event');

const TRANSFER_ABI = {
  name: 'Transfer',
  inputs: [
    { name: 'from',  type: 'address', indexed: true },
    { name: 'to',    type: 'address', indexed: true },
    { name: 'value', type: 'uint256', indexed: false },
  ]
};

// rawLog is any log object from eth_getLogs
const decoded = decodeEvent(TRANSFER_ABI, rawLog);
// { event: 'Transfer', params: { from: '0x...', to: '0x...', value: 1000000n } }
```

**As a CLI:**
```bash
node scripts/decode-event.js \
  '{"name":"Transfer","inputs":[{"name":"from","type":"address","indexed":true},{"name":"to","type":"address","indexed":true},{"name":"value","type":"uint256","indexed":false}]}' \
  '["0xddf252...","0x000...abc","0x000...def"]' \
  '0x0000000000000000000000000000000000000000000000000de0b6b3a7640000'
```

### `scripts/decode-transfer.js`

Fetch and decode ERC-20 Transfer + Approval events for any token address.

```bash
# USDC on Base, last 1000 blocks
node scripts/decode-transfer.js 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913

# Custom RPC and block range
node scripts/decode-transfer.js 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 https://mainnet.base.org 500
```

### `scripts/decode-swap.js`

Fetch and decode Uniswap V2/V3 Swap events from any pool.

```bash
# V3 pool (default)
node scripts/decode-swap.js 0xd0b53D9277642d899DF5C87A3966A349A798F224 v3

# V2 pair
node scripts/decode-swap.js 0xPairAddress v2 https://mainnet.base.org 500
```

## References

- `references/common-topics.md` — keccak256 topic0 hashes for ERC-20, ERC-721, Uniswap V2/V3, Safe, WETH, Chainlink, and more

## ABI format

The skill accepts standard ABI event fragments (same format as ethers.js, viem, etc.):

```json
{
  "name": "Swap",
  "type": "event",
  "inputs": [
    { "name": "sender",    "type": "address", "indexed": true  },
    { "name": "recipient", "type": "address", "indexed": true  },
    { "name": "amount0",   "type": "int256",  "indexed": false },
    { "name": "amount1",   "type": "int256",  "indexed": false },
    { "name": "sqrtPriceX96", "type": "uint160", "indexed": false },
    { "name": "liquidity", "type": "uint128", "indexed": false },
    { "name": "tick",      "type": "int24",   "indexed": false }
  ]
}
```

## How ABI event decoding works

Events have two parts in the log:
- **topics[0]**: keccak256 hash of the event signature (not decoded, just for matching)
- **topics[1..n]**: indexed parameters, each padded to 32 bytes
- **data**: ABI-encoded non-indexed parameters (same encoding as function outputs)

Dynamic types (`string`, `bytes`, `T[]`) stored as indexed are impossible to recover — only their keccak256 hash is stored. This decoder returns the hash with a note when that occurs.

## Integration with onchain-event-watcher

This skill pairs directly with `onchain-event-watcher`, which fetches raw logs but does not decode them:

```js
// In your onchain-event-watcher callback:
const { decodeEvent } = require('../event-decoder/scripts/decode-event');

function onLog(rawLog) {
  const decoded = decodeEvent(TRANSFER_ABI, rawLog);
  console.log(decoded.params);
}
```

## Trigger phrases

- "decode event log"
- "parse eth_getLogs output"
- "decode Transfer event"
- "decode Swap event"
- "read event from raw log"
- "ABI decode log data"
- "no ethers event decode"
