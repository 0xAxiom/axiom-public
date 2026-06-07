# tx-simulator

Dry-run EVM transactions against Base (or any chain) before submitting. Shows success/revert status, gas cost, decoded return values, and optional state diffs.

Zero dependencies. Uses standard JSON-RPC (`eth_call`, `eth_estimateGas`, `debug_traceCall`).

## Why

Agents that submit transactions need to know if a call will succeed before signing and broadcasting. This tool simulates the call at the current block and reports exactly what would happen — including decoded revert reasons, gas costs, and return values.

## Usage

```bash
# Simulate a USDC balanceOf on Base
./simulate.mjs --to 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 \
  --data 0x70a08231000000000000000000000000d8dA6BF26964aF9D7eEd9e03E53415D37aA96045 \
  --returns uint256

# Simulate with a specific sender (checks their permissions/balance)
./simulate.mjs --to 0xContractAddress \
  --from 0xYourWallet \
  --data 0xa9059cbb... \
  --returns bool

# Full tx object as JSON
./simulate.mjs --raw '{"from":"0x...","to":"0x...","data":"0x...","value":"0x0"}'

# Use a different chain
./simulate.mjs --to 0x... --data 0x... --chain ethereum

# Get state diffs (requires debug RPC)
./simulate.mjs --to 0x... --data 0x... --trace

# JSON output for piping to other tools
./simulate.mjs --to 0x... --data 0x... --json
```

## Options

| Flag | Description |
|------|-------------|
| `--to <addr>` | Target contract address (required) |
| `--from <addr>` | Sender address (default: zero address) |
| `--data <hex>` | Calldata (hex encoded) |
| `--value <wei>` | Value in wei |
| `--raw <json>` | Full tx object as JSON |
| `--chain <name>` | base, base-sepolia, ethereum, sepolia |
| `--rpc <url>` | Custom RPC URL |
| `--returns <types>` | Comma-separated return types for decoding |
| `--trace` | Attempt debug_traceCall for state diffs |
| `--json` | Output as JSON |

## Output

```
✓ Transaction would SUCCEED
──────────────────────────────────────────────────
  Gas used: 26,421
  Gas price: 0.0012 gwei
  Estimated cost: 0.00000003 ETH
  Return values: ["1000000000"]
```

Or on failure:

```
✗ Transaction would REVERT
──────────────────────────────────────────────────
  Reason: Error: "Insufficient balance"
```

## Features

- Decodes `Error(string)`, `Panic(uint256)`, and custom error selectors
- Basic ABI return value decoding (uint, int, address, bool, bytes32)
- Gas estimation with cost in ETH
- Optional state diff tracing via `debug_traceCall`
- Exit code 0 on success, 1 on revert, 2 on fatal error

## Requirements

Node.js 18+ (uses native `fetch`)
