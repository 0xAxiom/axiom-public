# dexscreener-monitor

Real-time DEX price, volume, and liquidity monitoring via Dexscreener. Zero npm dependencies.

**The problem:** CoinGecko lists tokens days after launch. New agent tokens, memecoins, and freshly deployed contracts have no price data there. Dexscreener indexes DEX pairs within minutes.

## Install

```bash
cp -r agent-skills/skills/dexscreener-monitor ~/.openclaw/skills/
# No npm install needed — zero dependencies
```

## Usage

```bash
# Search by name or symbol
node scripts/dexscreener.mjs --search AXIOM

# Get all pairs for a token (sorted by liquidity)
node scripts/dexscreener.mjs --token 0xf3Ce5dDAAb6C133F9875a4a46C55cf0b58111B07

# Filter to one chain
node scripts/dexscreener.mjs --token 0x... --chain base --limit 3

# Specific pair
node scripts/dexscreener.mjs --pair base 0xPairAddress

# Trending / boosted tokens
node scripts/dexscreener.mjs --trending --chain base

# JSON for scripting
node scripts/dexscreener.mjs --token 0x... --json
```

**Example output:**
```
Token: AXIOM (0xf3Ce5dDAAb6C133F9875a4a46C55cf0b58111B07)

[1] AXIOM/WETH on BASE (uniswap-v4)
  Price:     $0.001234  (1h: +2.45%  24h: -3.12%)
  Volume:    1h: $12.34K  24h: $145.67K
  Liquidity: $89.23K  (base: $44.61K  quote: $44.62K)
  Txns 24h:  234 buys / 187 sells
  FDV:       $1.23M  MCap: $987.65K
  Pair age:  15d ago
```

## Price Alert Watcher

```bash
# Alert on 20% pump or 15% dump, check every 60s
node scripts/watch.mjs \
  --token 0xf3Ce5dDAAb6C133F9875a4a46C55cf0b58111B07 \
  --chain base \
  --alert-pump 20 \
  --alert-dump 15

# Alert if liquidity drops below $5K
node scripts/watch.mjs --token 0x... --alert-liquidity 5000

# JSON alerts (pipe to notification handler)
node scripts/watch.mjs --token 0x... --alert-pump 10 --json-alerts
```

## Data Fields

| Field | Description |
|-------|-------------|
| `priceUsd` | Current USD price |
| `priceChange.h1/h24` | % price change |
| `volume.h24` | 24h volume |
| `liquidity.usd` | Total pair liquidity in USD |
| `txns.h24.buys/sells` | 24h transaction counts |
| `fdv` | Fully diluted valuation |
| `marketCap` | Circulating market cap |
| `pairCreatedAt` | When the pair was created |
| `dexId` | Which DEX (uniswap-v4, aerodrome, etc.) |

## vs CoinGecko

| | Dexscreener | CoinGecko |
|--|--|--|
| New tokens | Within minutes | Days to weeks |
| Pair-level data | Yes | No |
| Liquidity depth | Yes | No |
| Buy/sell counts | Yes | No |
| API key required | No | No (free tier) |
| Chains | 100+ | ~50 |

## No Dependencies

Pure Node.js `fetch`. Works with Node 18+.

## Author

Built by [Axiom](https://x.com/AxiomBot) — an AI agent with onchain identity.
