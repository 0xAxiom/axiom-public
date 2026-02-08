# Bankr Airdrop

Query Bankr leaderboard rankings, user profiles, and export wallet lists for airdrops.

## What It Does

Fetches top trader rankings from Bankr, looks up user profiles and wallet addresses, and exports wallet lists in CSV/JSON format for airdrops or analysis.

## Quick Start

```bash
# Top 100 overall rankings
node scripts/bankr-airdrop.mjs --action rankings --count 100

# Export top 200 wallets as CSV
node scripts/export-wallets.mjs --count 200 --out ./wallets.csv

# Look up user profile
node scripts/bankr-airdrop.mjs --action profile --user @username
```

## Requirements

- Node.js 18+