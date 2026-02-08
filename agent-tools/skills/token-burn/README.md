# Token Buy & Burn

Open-source pipeline for claiming Clanker protocol fees and executing 50/50 buy-and-burn strategy.

## What It Does

Claims WETH + token fees from Clanker, calculates USD value using live prices, swaps to rebalance for exactly 50% split, burns 50% to dead address, and keeps remaining 50% as WETH for treasury.

## Quick Start

```bash
# Dry run (recommended first)
node scripts/burn-and-harvest.mjs --dry-run

# Execute burn
node scripts/burn-and-harvest.mjs
```

## Requirements

- Node.js 18+
- Private key with Base ETH for gas (`NET_PRIVATE_KEY` env var)
- `viem` package for blockchain interactions