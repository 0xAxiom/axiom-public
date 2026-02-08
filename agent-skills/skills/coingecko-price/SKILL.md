# CoinGecko Price Skill

Fetch real-time crypto prices, 24h changes, market cap, and volume from CoinGecko's free API. Zero dependencies — native Node.js fetch only.

## Usage

### Get Price by Token ID

```bash
node scripts/price.mjs --token ethereum
node scripts/price.mjs --token bitcoin
node scripts/price.mjs --token solana
```

### Get Price by Contract Address

```bash
# Token on Base
node scripts/price.mjs --contract 0xf3Ce5dDAAb6C133F9875a4a46C55cf0b58111B07 --chain base

# Token on Ethereum
node scripts/price.mjs --contract 0xdAC17F958D2ee523a2206206994597C13D831ec7 --chain ethereum

# Token on Polygon
node scripts/price.mjs --contract 0x... --chain polygon-pos
```

### Watch Price with Alerts

```bash
# Monitor ETH every 5 minutes, alert on thresholds
node scripts/watch.mjs --token ethereum --interval 300 --alert-above 4000 --alert-below 3000

# Monitor BTC every 60 seconds
node scripts/watch.mjs --token bitcoin --interval 60 --alert-above 100000 --alert-below 90000
```

## Output Format

```
ethereum (ETH)
  Price:      $3,456.78
  24h Change: +2.34%
  Market Cap: $415.2B
  24h Volume: $12.8B
```

## API Details

- **Base URL:** `https://api.coingecko.com/api/v3`
- **Auth:** None required (free tier)
- **Rate Limit:** ~30 requests/minute
- **Platform IDs:** `base`, `ethereum`, `polygon-pos`, `solana`, `arbitrum-one`

## Requirements

- Node.js 18+ (native fetch)
- No dependencies
