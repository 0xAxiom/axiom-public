---
name: signature-lookup
description: Resolve EVM function selectors (4-byte) and event topic hashes to human-readable signatures. Queries openchain.xyz + 4byte.directory with a built-in fallback DB of 50+ common signatures. Batch mode, bytecode scanning, stdin pipe. Zero dependencies.
---

# signature-lookup

Resolve EVM function selectors and event topic hashes to human-readable signatures. Zero deps.

## When to use this skill

- You have a 4-byte selector like `0xa9059cbb` and want to know it's `transfer(address,uint256)`.
- You're reading event logs and need to identify topic0 hashes.
- You want to extract all function selectors from deployed bytecode.
- You need to quickly identify what a contract can do by scanning its bytecode.
- Pairs with `calldata-decoder` (decode full calldata) and `event-decoder` (decode full event logs).

## What it does NOT require

- ethers.js / viem / web3.js
- npm install
- An API key
- A local node

Built-in DB covers 50+ of the most common ERC-20, ERC-721, Uniswap, and access-control signatures, so common lookups work even offline.

## Script

### `lookup.mjs`

```bash
# Single function selector
node lookup.mjs 0xa9059cbb

# Event topic hash
node lookup.mjs 0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef

# Batch lookup
node lookup.mjs 0xa9059cbb 0x095ea7b3 0x23b872dd

# Extract and resolve selectors from bytecode
node lookup.mjs --scan 0x6080604052...

# Pipe from stdin
echo "0xa9059cbb 0x095ea7b3" | node lookup.mjs
```

### Example output

```
[fn]    0xa9059cbb  transfer(address,uint256)  [builtin]
[fn]    0x095ea7b3  approve(address,uint256)  [builtin]
[event] 0xddf252ad...  Transfer(address,address,uint256)  [builtin]

3/3 resolved.
```

## Sources

1. **Built-in DB** — instant, no network. Covers ERC-20, ERC-721, Uniswap v2/v3, OpenZeppelin access control, and common DeFi signatures.
2. **openchain.xyz** — large public signature database (same one Etherscan uses).
3. **4byte.directory** — community-maintained Ethereum signature registry.

Both APIs are queried in parallel; results are deduplicated.
