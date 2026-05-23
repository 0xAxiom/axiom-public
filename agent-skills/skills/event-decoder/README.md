# event-decoder 🔍

**Decode raw EVM event logs — zero dependencies, pure Node.js.**

`eth_getLogs` returns hex blobs. This turns them into real values.

No ethers.js. No web3. No npm install. Just Node.js.

---

## The problem

Every DeFi agent eventually needs to read event logs. `eth_getLogs` returns this:

```json
{
  "topics": [
    "0xddf252ad...",
    "0x000000000000000000000000abcdef...",
    "0x000000000000000000000000fedcba..."
  ],
  "data": "0x000000000000000000000000000000000000000000000006f05b59d3b2000000"
}
```

Decoding that without pulling in a 2MB library is annoying. This skill does it.

---

## Usage

### Library (embed in your agent)

```js
const { decodeEvent } = require('./scripts/decode-event');

const decoded = decodeEvent({
  name: 'Transfer',
  inputs: [
    { name: 'from',  type: 'address', indexed: true  },
    { name: 'to',    type: 'address', indexed: true  },
    { name: 'value', type: 'uint256', indexed: false },
  ]
}, rawLog);

console.log(decoded.params.from);    // '0xabc...'
console.log(decoded.params.to);      // '0xdef...'
console.log(decoded.params.value);   // 500000000000000000n (BigInt)
```

### CLI

```bash
# Decode any event
node scripts/decode-event.js '<abiJson>' '<topicsJson>' '<dataHex>'

# Fetch and decode ERC-20 transfers for a token
node scripts/decode-transfer.js 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913

# Fetch and decode Uniswap V3 swaps
node scripts/decode-swap.js 0xd0b53D9277642d899DF5C87A3966A349A798F224 v3
```

---

## Supported types

| Solidity type | Notes |
|---------------|-------|
| `address` | Returns checksummed hex |
| `uint8` ... `uint256` | Returns BigInt |
| `int8` ... `int256` | Returns signed BigInt |
| `bool` | Returns true/false |
| `bytes32` | Returns 0x-prefixed hex |
| `bytesN` | Returns 0x-prefixed hex, N bytes |
| `bytes` | Returns 0x hex (dynamic, from data field) |
| `string` | Returns decoded UTF-8 string (from data field) |
| `T[]` | Returns array of decoded elements |
| Dynamic indexed | Returns keccak256 hash with note (unrecoverable) |

---

## Common topic0 hashes

See `references/common-topics.md` for a reference table covering:
- ERC-20 Transfer, Approval
- ERC-721 Transfer, ApprovalForAll
- ERC-1155 TransferSingle, TransferBatch
- Uniswap V2 Swap, Mint, Burn, Sync
- Uniswap V3 Swap, Mint, Burn, Collect
- Gnosis Safe ExecutionSuccess
- WETH Deposit, Withdrawal
- Chainlink AnswerUpdated

---

## How it works

ABI encoding stores event params in two places:
1. **topics[1..n]** — indexed params, each padded to 32 bytes
2. **data** — non-indexed params, ABI-encoded as a tuple

This decoder reads indexed params from topics, then walks the ABI encoding rules for the data field (static types in-place, dynamic types via pointer offsets).

No keccak256 needed for decoding — you provide the ABI, we handle the rest.

---

## Pairs well with

- `onchain-event-watcher` — fetch raw logs, decode with this skill
- `contract-reader` — read view functions, use this for events
- `fund-sentinel` — monitor transfers to/from treasury

---

## Author

**Axiom** [@AxiomBot](https://x.com/AxiomBot) | [github.com/0xAxiom](https://github.com/0xAxiom/axiom-public)
