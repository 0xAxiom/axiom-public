---
name: revert-decoder
description: Turn raw EVM revert data into a readable error. Decodes Error(string), Panic(uint256) with code meanings, and custom errors via openchain.xyz selector lookup. Zero dependencies. With --tx, replays a failed transaction via eth_call to extract the revert data automatically. Use when an agent's tx reverted and the only signal is an opaque 0x… blob.
---

# revert-decoder

When an EVM transaction fails, all you usually get is a hex blob and the word "reverted." This skill turns that blob into:

- `Error(string)` → the actual `require()` message
- `Panic(uint256)` → the panic code AND what it means (overflow, div/0, OOB, etc.)
- Custom errors → resolved against the openchain.xyz signature database, with params decoded

Zero deps. Works on raw hex or directly from a failed tx hash.

## When to use this skill

- An agent submitted a tx, it reverted, and you need to know why before retrying.
- You have a simulation result with revert data and want to understand it.
- A failing `eth_call` returns revert hex and you need the error name.
- You're debugging a contract integration and the error is a custom 4-byte selector.

## What it does NOT require

- ethers.js / viem / web3.js
- npm install
- An API key
- A node with `debug_traceTransaction`

It uses Node 18+'s built-in `fetch` and the public openchain.xyz signature database.

## Script

### `decode.mjs`

```bash
# Raw revert data (an Error(string)):
node decode.mjs 0x08c379a0000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000054552433a30000000000000000000000000000000000000000000000000000000

# Panic — arithmetic overflow:
node decode.mjs 0x4e487b710000000000000000000000000000000000000000000000000000000000000011

# From stdin:
echo 0x08c379a0... | node decode.mjs

# Replay a failed tx directly (fetches tx, re-runs via eth_call, decodes):
node decode.mjs --tx 0x<hash> --rpc https://mainnet.base.org

# JSON output (machine-readable):
node decode.mjs --json 0x08c379a0...
```

`RPC_URL` env var is honored when `--rpc` is omitted. Default RPC is Base mainnet.

## Output

### Error(string)
```
Error(string)  0x08c379a0
  reason: "ERC20: transfer amount exceeds balance"
```

### Panic(uint256)
```
Panic(uint256) 0x4e487b71
  code:    0x11
  meaning: arithmetic over/underflow (unchecked)
```

### Custom error
```
custom error  selector=0xfb8f41b2  (64 bytes of params)

  ERC20InsufficientAllowance(address,uint256,uint256)
    [0] address    = 0xabc...
    [1] uint256    = 100
    [2] uint256    = 1000
```

### Empty revert
```
empty revert (require() with no message, or out-of-gas)
```

## Panic codes recognized

| Code | Meaning |
|------|---------|
| 0x00 | generic compiler-inserted panic |
| 0x01 | `assert(false)` |
| 0x11 | arithmetic over/underflow (unchecked) |
| 0x12 | division or modulo by zero |
| 0x21 | conversion to non-existent enum value |
| 0x22 | incorrectly encoded storage byte array |
| 0x31 | `.pop()` on empty array |
| 0x32 | array index out of bounds |
| 0x41 | memory allocation too large or out of memory |
| 0x51 | called a zero-initialized variable of internal function type |

## How `--tx` works

Replays the failed call against the block *before* the tx, via `eth_call`. Most RPC providers return the revert data inside the JSON-RPC error object. The script handles:

- geth-style `error.data` (hex string)
- nested `error.data.data`
- providers that embed the hex inside `error.message`

If your RPC strips revert data entirely (rare), use a node with `debug_traceTransaction` for a full trace.

## Why this skill

`0x08c379a0…00054552433a` is opaque. `Error("ERC20: transfer amount exceeds balance")` is not. Pairs naturally with `calldata-decoder`, `event-decoder`, and `tx-simulator`.
