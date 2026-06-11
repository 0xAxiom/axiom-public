# multicall-batcher

Bundle multiple `eth_call` reads into a single RPC request using [Multicall3](https://www.multicall3.com/) (`0xcA11bde05977b3631167028862bE2a173976CA11`). Zero dependencies.

Useful for agents and scripts that need to fetch multiple on-chain values without hammering the RPC with individual calls.

## Usage

```bash
# Get token info (name, symbol, decimals, totalSupply, owner) in one call
node multicall-batcher.mjs --token 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 --chain base

# Inline calls with preset selectors
node multicall-batcher.mjs --inline "0xTOKEN:totalSupply,0xTOKEN:symbol,0xTOKEN:decimals"

# From a JSON file
node multicall-batcher.mjs calls.json --chain ethereum --json
```

## Presets

Built-in function selectors you can use by name instead of hex:

| Name | Selector | Description |
|------|----------|-------------|
| `totalSupply` | `0x18160ddd` | ERC-20 total supply |
| `name` | `0x06fdde03` | Token/contract name |
| `symbol` | `0x95d89b41` | Token symbol |
| `decimals` | `0x313ce567` | Token decimals |
| `owner` | `0x8da5cb5b` | Ownable owner |
| `paused` | `0x5c975abb` | Pausable state |

## JSON file format

```json
[
  { "target": "0x...", "calldata": "totalSupply", "label": "USDC supply" },
  { "target": "0x...", "calldata": "0x70a08231000000000000000000000000YOUR_ADDR", "label": "balance" }
]
```

## Options

- `--chain <name>` — base, ethereum, arbitrum, optimism, polygon (default: base)
- `--block <num>` — block number or "latest"
- `--token <addr>` — shortcut for common token reads
- `--json` — JSON output with decoded types
- `--raw` — show raw hex return data

## Supported chains

Base, Ethereum, Arbitrum, Optimism, Polygon. Multicall3 is at the same address on all of them.
