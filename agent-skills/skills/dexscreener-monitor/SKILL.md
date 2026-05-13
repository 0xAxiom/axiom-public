# dexscreener-monitor

**Skill for querying Dexscreener — real-time price, volume, liquidity, and alerts for any DEX pair.**

Use when you need price/market data for tokens that may not be on CoinGecko yet: new launches, memecoins, newly deployed agent tokens, or any pair on 100+ chains. Zero npm dependencies.

## Triggers

Use this skill when:
- Agent needs price/volume/liquidity for a token by address or symbol
- Token was recently launched and isn't on CoinGecko
- Need to monitor a pair for price movements or liquidity changes
- User asks about "dexscreener", "pair data", "DEX price", "liquidity check"
- Setting up price alerts without a running server (cron-based polling)

## Quick Commands

```bash
# Search by name or symbol
node skills/dexscreener-monitor/scripts/dexscreener.mjs --search AXIOM

# All pairs for a token address
node skills/dexscreener-monitor/scripts/dexscreener.mjs --token 0xf3Ce5dDAAb6C133F9875a4a46C55cf0b58111B07

# Filter to one chain
node skills/dexscreener-monitor/scripts/dexscreener.mjs --token 0x... --chain base

# Get a specific pair
node skills/dexscreener-monitor/scripts/dexscreener.mjs --pair base 0xPairAddress

# Trending/boosted tokens
node skills/dexscreener-monitor/scripts/dexscreener.mjs --trending --chain base

# JSON output (for piping to scripts)
node skills/dexscreener-monitor/scripts/dexscreener.mjs --token 0x... --json
```

## Price Alerts (Watcher)

```bash
# Watch with pump/dump alerts (checks every 60s)
node skills/dexscreener-monitor/scripts/watch.mjs \
  --token 0xf3Ce5dDAAb6C133F9875a4a46C55cf0b58111B07 \
  --chain base \
  --alert-pump 20 \
  --alert-dump 15 \
  --interval 60

# Alert if liquidity drops below $5K
node skills/dexscreener-monitor/scripts/watch.mjs \
  --token 0x... \
  --alert-liquidity 5000

# JSON alert output (pipe to notification handler)
node skills/dexscreener-monitor/scripts/watch.mjs \
  --token 0x... \
  --alert-pump 10 \
  --json-alerts | grep ALERT_JSON
```

## Cron Integration

For one-shot checks in cron jobs (no persistent process needed), use `dexscreener.mjs --json` and parse the output:

```bash
# In a cron script
PRICE=$(node dexscreener.mjs --token 0x... --json | node -e "
  const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
  console.log(d[0]?.priceUsd || '0');
")
```

## Data Available

Every pair response includes:
- `priceUsd` — current USD price
- `priceChange.h1/h6/h24` — % change over time windows
- `volume.h1/h6/h24` — trading volume
- `liquidity.usd` — total USD liquidity
- `txns.h24.buys/sells` — transaction counts
- `fdv` / `marketCap` — fully diluted / circulating market cap
- `pairCreatedAt` — unix timestamp of pair creation
- `dexId` — which DEX (uniswap-v4, aerodrome, etc.)
- `chainId` — chain identifier

## Chains Supported

`ethereum`, `base`, `solana`, `arbitrum`, `polygon`, `bsc`, `optimism`, `avalanche` and 100+ more.

## Key Insight

Dexscreener indexes pairs within minutes of deployment. Use this instead of CoinGecko when:
- Token launched in the last few hours
- Token is not widely listed (new agent tokens, memecoins)
- You need pair-level data (liquidity, specific DEX, pair age)
- You need buy/sell transaction counts

## No API Key Required

All endpoints are public. Rate limit: ~300 requests/minute on the free tier.
