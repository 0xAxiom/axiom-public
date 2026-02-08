# 📊 CoinGecko Price Skill

Real-time crypto price tracking and alerts using the free CoinGecko API. Zero dependencies.

## Features

- **Price by ID** — Look up any token by CoinGecko ID (`ethereum`, `bitcoin`, `solana`, etc.)
- **Price by Contract** — Look up tokens by contract address on any supported chain
- **Price Alerts** — Monitor prices at intervals with configurable thresholds
- **Rich Data** — Price, 24h change, market cap, and 24h volume

## Quick Start

```bash
# Get current ETH price
node scripts/price.mjs --token ethereum

# Get token price by contract on Base
node scripts/price.mjs --contract 0xf3Ce5dDAAb6C133F9875a4a46C55cf0b58111B07 --chain base

# Watch ETH with alerts every 5 minutes
node scripts/watch.mjs --token ethereum --interval 300 --alert-above 4000 --alert-below 3000
```

## Scripts

### `scripts/price.mjs`

Fetch the current price of any cryptocurrency.

**By CoinGecko ID:**
```bash
node scripts/price.mjs --token ethereum
node scripts/price.mjs --token bitcoin
```

**By Contract Address:**
```bash
node scripts/price.mjs --contract 0x... --chain base
node scripts/price.mjs --contract 0x... --chain ethereum
node scripts/price.mjs --contract 0x... --chain polygon-pos
```

**Options:**
| Flag | Description | Default |
|------|-------------|---------|
| `--token` | CoinGecko token ID | — |
| `--contract` | Token contract address | — |
| `--chain` | Chain platform ID | `ethereum` |
| `--currency` | Quote currency | `usd` |
| `--json` | Output raw JSON | `false` |

### `scripts/watch.mjs`

Monitor a token's price at regular intervals with optional alerts.

```bash
node scripts/watch.mjs --token ethereum --interval 300 --alert-above 4000 --alert-below 3000
```

**Options:**
| Flag | Description | Default |
|------|-------------|---------|
| `--token` | CoinGecko token ID | — |
| `--contract` | Token contract address | — |
| `--chain` | Chain platform ID | `ethereum` |
| `--interval` | Check interval in seconds | `300` |
| `--alert-above` | Alert when price exceeds | — |
| `--alert-below` | Alert when price drops below | — |
| `--currency` | Quote currency | `usd` |

## API

Uses the [CoinGecko API v3](https://docs.coingecko.com/reference/introduction) (free, no auth).

- Rate limit: ~30 requests/minute
- Supported chains: `ethereum`, `base`, `polygon-pos`, `solana`, `arbitrum-one`, `optimistic-ethereum`

## Requirements

- Node.js 18+ (uses native `fetch`)
- Zero npm dependencies

## License

MIT
