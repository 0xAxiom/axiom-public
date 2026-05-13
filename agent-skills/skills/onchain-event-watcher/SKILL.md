# onchain-event-watcher

Watch for real-time EVM events via `eth_getLogs` polling. Zero dependencies. No indexer. No API key. Works on Base, Ethereum, Arbitrum, Optimism, Polygon.

## When to use

- Monitor incoming token transfers to a wallet
- Watch for swaps on a Uniswap pool
- Detect when a contract emits a specific event
- React to on-chain activity in agent workflows
- Audit historical events over a block range
- Verify that a transaction emitted the expected event

## Triggers

Use this skill when someone says: "watch for transfers", "monitor swaps", "alert when event fires", "detect incoming tokens", "scan for events", "react to onchain activity", "poll for contract events"

## Scripts

```
scripts/
├── watch.mjs   — real-time poller (loop or one-shot)
└── scan.mjs    — historical block range scan
```

## Quick start

```bash
# Real-time: watch incoming transfers to a contract (polls every 12s)
node scripts/watch.mjs --contract 0xf3Ce5dDAAb6C133F9875a4a46C55cf0b58111B07 --event Transfer --loop

# One-shot: check last 100 blocks for swaps on a Uniswap V3 pool
node scripts/watch.mjs --contract 0x... --event SwapV3 --from latest

# Historical scan: last 500 blocks
node scripts/scan.mjs --contract 0x... --event Transfer --blocks 500

# Custom event: provide topic hash directly
node scripts/watch.mjs --contract 0x... --topic 0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef --loop

# JSON output: pipe to jq or another script
node scripts/watch.mjs --contract 0x... --event Transfer --loop --json | jq '.parsed'

# Different chains
node scripts/watch.mjs --contract 0x... --event Transfer --chain ethereum
node scripts/watch.mjs --contract 0x... --event SwapV3 --chain arbitrum
node scripts/watch.mjs --contract 0x... --event SwapV3 --rpc https://your-rpc.com
```

## Known events

```
Transfer             ERC-20 / ERC-721 transfer
Approval             ERC-20 approval
SwapV2               Uniswap V2 swap
SwapV3               Uniswap V3 swap
SwapV4               Uniswap V4 swap
Mint_V3              Uniswap V3 LP add
Burn_V3              Uniswap V3 LP remove
Collect_V3           Uniswap V3 fee collect
OwnershipTransferred Ownable owner change
Upgraded             UUPS proxy upgrade
Paused / Unpaused    Pausable contract
ApprovalForAll       ERC-721 operator approval
```

For any other event: compute `keccak256("EventName(arg1type,arg2type,...)")` and pass with `--topic 0x...`

```bash
# Using Foundry cast
cast keccak "Swap(address,address,int256,int256,uint160,uint128,int24)"

# Or use viem/ethers
node -e "const {keccak256,toHex} = require('viem'); console.log(keccak256(toHex('Transfer(address,address,uint256)')))"
```

## Options

### watch.mjs

| Flag | Default | Description |
|------|---------|-------------|
| `--contract` | required | Contract address to watch |
| `--event` | — | Event shortcut name (see list above) |
| `--topic` | — | Raw topic0 hash (alternative to --event) |
| `--from` | `latest` | Start block (number or "latest") |
| `--interval` | `12` | Poll interval in seconds |
| `--loop` | off | Keep polling indefinitely |
| `--chain` | `base` | Chain preset: base, ethereum, arbitrum, optimism, polygon |
| `--rpc` | preset | Override RPC URL |
| `--json` | off | NDJSON output for piping |
| `--list-events` | — | Print all known event shortcuts |

### scan.mjs

| Flag | Default | Description |
|------|---------|-------------|
| `--contract` | required | Contract address |
| `--event` | — | Event shortcut name |
| `--topic` | — | Raw topic0 hash |
| `--from` | `latest - blocks` | Start block |
| `--to` | `latest` | End block |
| `--blocks` | `500` | How many recent blocks to scan |
| `--chain` | `base` | Chain preset |
| `--json` | off | NDJSON output |

## Notes

- Free public RPCs have rate limits. For production use a dedicated RPC (Alchemy, Infura, QuickNode).
- Most public RPCs cap `eth_getLogs` at 1000-2000 blocks per call. `scan.mjs` automatically chunks at 500 blocks.
- Event decoding is automatic for Transfer-shaped events (3 topics + 32-byte data). For other shapes, inspect the raw `indexed` and `data` fields and decode manually.
- For high-frequency monitoring (< 12s), use a WebSocket RPC and `eth_subscribe` instead of polling.

## Agent integration

```javascript
// In a cron job: check for new transfers every 15 minutes
const { execSync } = require('child_process');
const events = execSync(
  `node watch.mjs --contract 0x... --event Transfer --from ${lastCheckedBlock} --json`,
  { cwd: __dirname, encoding: 'utf8' }
).trim().split('\n').filter(Boolean).map(JSON.parse);

for (const e of events) {
  if (e.parsed?.to === MY_WALLET.toLowerCase()) {
    await notify(`Received ${e.parsed.amount} tokens from ${e.parsed.from}`);
  }
}
```
