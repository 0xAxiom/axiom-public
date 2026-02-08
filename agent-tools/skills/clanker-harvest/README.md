# Clanker Harvest

Claims Clanker fees and implements 50% buy-and-burn mechanism for $AXIOM token.

## What It Does

Claims WETH + AXIOM fees from Clanker, calculates USD value, burns exactly 50% of total value as $AXIOM tokens, and sends remaining 50% (as WETH) to destination wallet.

## Quick Start

```bash
cd scripts
npm install

# Run the harvest
NET_PRIVATE_KEY=0x... node burn-and-harvest.mjs
```

## Requirements

- Node.js 18+
- Private key with Base ETH for gas
- `viem` package for blockchain interactions