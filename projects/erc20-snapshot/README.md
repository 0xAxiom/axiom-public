# erc20-snapshot

Zero-dep Node.js CLI that produces a holder balance snapshot for any EVM ERC-20 at a target block. Built for airdrop prep, governance snapshots, and quick on-chain distribution audits.

No SDK, no API key, no install — just `node snapshot.mjs`.

## How it works

1. Walks `Transfer` event logs from `--start` (default 0) to `--block` in chunks of `--step` blocks (default 5000).
2. Collects the unique `from`/`to` set as the candidate holder list.
3. Batches `eth_call balanceOf(holder)` at the target block via JSON-RPC batch requests (100 per call).
4. Filters zero balances and sorts by amount descending.
5. Emits CSV (default) or JSON to stdout or `--out` file.

If the RPC rejects a wide log range, the script halves and retries automatically.

## Usage

```bash
# Snapshot AXIOM on Base at a specific block, write CSV to file
node snapshot.mjs \
  --token 0xf3Ce5d... \
  --block 28800000 \
  --out axiom-snapshot.csv

# JSON output
node snapshot.mjs --token 0xToken --block 12345678 --json

# Custom RPC (e.g. private node, or another EVM chain)
node snapshot.mjs --token 0xToken --block N --rpc https://eth.llamarpc.com

# Speed up: skip blocks before deployment
node snapshot.mjs --token 0xToken --block N --start 28000000

# Tune chunk size for stricter RPCs
node snapshot.mjs --token 0xToken --block N --step 2000
```

## Flags

| Flag | Default | Purpose |
|------|---------|---------|
| `--token` | required | ERC-20 contract address |
| `--block` | required | Target block number for the snapshot |
| `--rpc` | `https://mainnet.base.org` | JSON-RPC endpoint |
| `--start` | `0` | Earliest block to scan (set to deployment block to skip work) |
| `--step` | `5000` | Blocks per `eth_getLogs` chunk |
| `--out` | stdout | Output file path |
| `--json` | off | JSON instead of CSV |

## Output (CSV)

```
address,raw,amount
0xabc...,123456789000000000000,123.456789
0xdef...,98000000000000000000,98
...
```

## Notes

- Works for any EVM chain — Base, Ethereum, Arbitrum, Optimism, etc. Just point `--rpc` at the right endpoint.
- Public RPCs (like `mainnet.base.org`) are rate-limited; for large tokens use a private endpoint and tune `--step`.
- The script auto-detects `decimals()`; falls back to 18 if the call reverts.
- Burn address (`0x000...000`) is excluded from the holder set automatically.

## License

MIT
