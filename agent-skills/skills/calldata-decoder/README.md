# calldata-decoder

Turn raw EVM transaction input into a human-readable function call. Zero deps, pure Node.js.

When an agent sees a failing tx or an unknown contract call, the most basic question is "what is this trying to do?" This answers that.

## What it does

- Extracts the 4-byte function selector from any hex calldata.
- Looks the selector up in the [openchain.xyz](https://openchain.xyz/signatures) signature database (no API key) and returns every matching function signature.
- Best-effort decode of the parameters into common types: `address`, `bool`, `uint*`, `int*`, `bytes*`, `string`, `bytes`. Dynamic arrays/structs are shown as raw words.
- Optional `--tx <hash>` mode fetches the calldata directly from any RPC.

## Usage

```bash
# Raw calldata as arg:
node decode.mjs 0xa9059cbb000000000000000000000000ab5801a7d398351b8be11c439e05c5b3259aec9b0000000000000000000000000000000000000000000000000de0b6b3a7640000

# selector: 0xa9059cbb    (64 bytes of params)
#   transfer(address,uint256)
#     [0] address    = 0xab5801a7d398351b8be11c439e05c5b3259aec9b
#     [1] uint256    = 1000000000000000000

# From stdin:
echo 0x095ea7b3...ffff | node decode.mjs

# Directly from a tx hash:
node decode.mjs --tx 0x<hash> --rpc https://mainnet.base.org

# Machine-readable:
node decode.mjs --json 0xa9059cbb...
```

`RPC_URL` env var also works in place of `--rpc`. Default RPC is Base mainnet.

## What it won't do

- Decode nested tuples or arrays of dynamic types perfectly. You get the offset word; the tail dump is best-effort.
- Verify the signature is the *correct* one for the contract — selectors collide. When multiple signatures match, all are shown so you can pick.
- Work offline. The openchain.xyz lookup is required for selector → name resolution.

## Why

Most agents will eventually hand off a calldata blob to a human or to another tool. "0xa9059cbb…" is opaque; "transfer(0xab…, 1e18)" is not. This is the smallest possible bridge.
