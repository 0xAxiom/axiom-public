---
name: calldata-decoder
description: Decode raw EVM transaction calldata into a human-readable function call. Resolves 4-byte selectors via openchain.xyz and best-effort decodes parameters. Zero dependencies, works from raw hex or a tx hash. Use when an agent needs to understand what an arbitrary `0x…` blob is actually doing.
---

# calldata-decoder

Turn raw EVM transaction input into a function call you can read. Zero deps.

## When to use this skill

- A transaction failed and you have the calldata but no idea what it called.
- You're inspecting a multisig proposal or pending tx and the wallet UI just shows `0xa9059cbb…`.
- A contract is calling out to another contract and you want to know which function.
- An agent needs to verify that a calldata blob it's about to send matches the intended function.

## What it does NOT require

- ethers.js / viem / web3.js
- npm install
- An API key
- A local node

It uses Node 18+'s built-in `fetch` and the public openchain.xyz signature database.

## Script

### `decode.mjs`

```bash
# Raw calldata:
node decode.mjs 0xa9059cbb000000000000000000000000ab5801a7d398351b8be11c439e05c5b3259aec9b0000000000000000000000000000000000000000000000000de0b6b3a7640000

# From stdin:
cat calldata.hex | node decode.mjs

# Directly from a tx hash on any RPC:
node decode.mjs --tx 0x<hash> --rpc https://mainnet.base.org

# JSON output (machine-readable):
node decode.mjs --json 0xa9059cbb...
```

Environment variable `RPC_URL` is honored when `--rpc` is omitted. Default RPC is Base mainnet.

## Output

```
selector: 0xa9059cbb    (64 bytes of params)

  transfer(address,uint256)
    [0] address    = 0xab5801a7d398351b8be11c439e05c5b3259aec9b
    [1] uint256    = 1000000000000000000
```

When multiple signatures share a selector (selector collisions are real), all candidates are listed. The agent picks based on context (the `to` address, surrounding logs, etc.).

When the selector isn't in the openchain database, the script prints the raw 32-byte parameter words so you still have something to work with.

## Supported parameter types

- `address`, `bool`, `bytes1..32`
- `uint8..256`, `int8..256` (signed values handled with two's complement)
- `string` and dynamic `bytes` (decoded from the tail section)
- Dynamic arrays and tuples: shown as offset + raw tail dump (best-effort)

For perfect ABI decoding of complex nested types, hand off to viem/ethers. This skill is the fast 90% case.

## Why this skill

`0xa9059cbb…` is opaque; `transfer(0xab…, 1e18)` is not. Every agent that touches transactions eventually needs to translate one to the other, and the answer should not require pulling in a 100kB ABI parser.
