---
name: bankr-airdrop
description: Bankr leaderboard rankings, user profiles, wallet export, and score breakdowns
version: 1.0.0
author: Axiom
tags: [bankr, leaderboard, wallets, airdrop, crypto, defi]
---

# Bankr Airdrop Skill

Query the Bankr leaderboard, look up user profiles and wallets, and export wallet lists for airdrops or analysis.

## Usage

### Fetch Rankings

```bash
# Top 100 overall
node scripts/bankr-airdrop.mjs --action rankings --count 100

# Top 20 by PnL in last 24h
node scripts/bankr-airdrop.mjs --action rankings --count 20 --timeframe 24h --type pnl

# CSV output
node scripts/bankr-airdrop.mjs --action rankings --count 50 --output csv

# Save to file
node scripts/bankr-airdrop.mjs --action rankings --count 50 --output csv --out-file ./rankings.csv
```

### Look Up User Profile

```bash
# By account ID
node scripts/bankr-airdrop.mjs --action profile --user 1204220275543433217

# By @username (searches rankings)
node scripts/bankr-airdrop.mjs --action profile --user @thatdudeboz
```

Returns: `walletAddress`, `username`, `socials`, `rank`, `totalScore`

### Export Wallet Addresses

```bash
# Export top 200 wallets as CSV
node scripts/bankr-airdrop.mjs --action wallets --count 200 --output csv --out-file ./wallets.csv

# Convenience wrapper
node scripts/export-wallets.mjs --count 200 --out ./bankr-top200.csv

# JSON format
node scripts/export-wallets.mjs --count 100 --format json --out ./wallets.json

# Filter by type
node scripts/export-wallets.mjs --count 50 --type pnl --timeframe 7d --out ./top-pnl-7d.csv
```

CSV columns: `rank,username,wallet_address,account_id`

### Score Breakdown

```bash
node scripts/bankr-airdrop.mjs --action scores --user 1204220275543433217 --timeframe 24h
```

### Tree Map (Top Traders)

```bash
node scripts/bankr-airdrop.mjs --action treemap --timeframe 24h --count 10
```

## Options

| Option | Values | Default | Description |
|--------|--------|---------|-------------|
| `--action` | rankings, profile, wallets, scores, treemap | — | Required action |
| `--count` | 1-1000+ | 100 | Number of users to fetch |
| `--timeframe` | 24h, 7d, 30d, total | total | Time period filter |
| `--type` | total, staking, bnkr, earn, pnl, referral, nft, booster | total | Ranking category |
| `--output` | json, csv | json | Output format |
| `--out-file` | path | — | Save to file |
| `--user` | accountId or @username | — | User identifier |

## Pagination

The Bankr API uses **cursor-based pagination** (not offset). Each page returns up to 20 results. The cursor increments by 20 for each page. The scripts handle this automatically.

## Rate Limiting

Profile fetches are rate-limited to 80ms between requests to avoid overwhelming the API. Fetching 200 wallets takes ~16 seconds.

## Dependencies

None beyond Node.js 18+ (uses native `fetch`).
