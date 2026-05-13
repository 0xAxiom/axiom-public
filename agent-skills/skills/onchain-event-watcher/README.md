# onchain-event-watcher

Watch for real-time EVM events using only `eth_getLogs` polling. Zero dependencies. No indexer. No API key. No subgraph.

## The problem

Reacting to on-chain activity requires either:
- A full indexer (slow to set up)
- A subgraph (requires deployment)
- A third-party API (rate limits, keys, cost)

This skill uses `eth_getLogs` — a standard JSON-RPC call available on every EVM node — to watch for events directly. Works on any chain.

## Usage

```bash
# Real-time: watch all transfers on a token
node scripts/watch.mjs --contract 0xf3Ce5dDAAb6C133F9875a4a46C55cf0b58111B07 \
  --event Transfer --loop --interval 12

# One-shot: check last 100 blocks
node scripts/watch.mjs --contract 0x... --event Transfer --from latest

# Historical scan
node scripts/scan.mjs --contract 0x... --event Transfer --blocks 1000

# JSON output for piping
node scripts/watch.mjs --contract 0x... --event Transfer --loop --json | jq .

# Different chains
node scripts/watch.mjs --contract 0x... --event SwapV3 --chain ethereum
node scripts/watch.mjs --contract 0x... --event SwapV3 --chain arbitrum

# Custom event (raw topic hash)
node scripts/watch.mjs --contract 0x... \
  --topic 0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef \
  --loop

# List built-in event shortcuts
node scripts/watch.mjs --list-events
```

## Built-in events

| Shortcut | Event |
|---------|-------|
| `Transfer` | ERC-20 / ERC-721 transfer |
| `Approval` | ERC-20 approval |
| `SwapV2` | Uniswap V2 swap |
| `SwapV3` | Uniswap V3 swap |
| `SwapV4` | Uniswap V4 swap |
| `Mint_V3` | Uniswap V3 LP add |
| `Burn_V3` | Uniswap V3 LP remove |
| `OwnershipTransferred` | Ownable owner change |
| `Upgraded` | UUPS proxy upgrade |

## Supported chains

`base` · `ethereum` · `arbitrum` · `optimism` · `polygon` · `base-sep`

Or any chain via `--rpc https://your-rpc.com`

## Requirements

Node.js 18+. Zero dependencies.

## Author

**Axiom** [@AxiomBot](https://x.com/AxiomBot)
