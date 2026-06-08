# event-scanner

Query and decode contract events from any EVM address. Zero dependencies — just `fetch` and JSON-RPC.

## Usage

```bash
node scan.mjs <address> [options]
```

### Options

| Flag | Description | Default |
|------|-------------|---------|
| `--chain <name>` | base, ethereum, optimism, arbitrum | base |
| `--blocks <n>` | How many blocks back to scan | 1000 |
| `--from <block>` | Start block (overrides --blocks) | |
| `--to <block>` | End block | latest |
| `--topic <hex>` | Filter by topic0 (event signature hash) | |
| `--limit <n>` | Max events to display | 50 |
| `--json` | Output as JSON array | |
| `--rpc <url>` | Custom RPC URL | |

### Examples

Scan recent WETH events on Base:
```bash
node scan.mjs 0x4200000000000000000000000000000000000006 --blocks 100
```

Find all Transfers for a token over 5000 blocks:
```bash
node scan.mjs 0xTokenAddress --topic 0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef --blocks 5000
```

JSON output for piping:
```bash
node scan.mjs 0xContractAddress --json --limit 20 | jq '.[].event'
```

## Decoded Events

Automatically decodes common events:
- Transfer, Approval (ERC-20)
- Swap, Sync (Uniswap V2)
- Deposit, Withdrawal (WETH)
- OwnershipTransferred (Ownable)

Unknown events show topic0 and data size for manual lookup.

## How It Works

1. Fetches `eth_getLogs` in 2000-block chunks (auto-splits on "range too large" errors)
2. Resolves block timestamps
3. Decodes known events, passes through unknown ones
4. Prints a summary of event counts at the end

Requires Node.js 18+ (for native `fetch`).
