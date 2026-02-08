# ClawFomo Bot

Algorithmic player for the ClawFomo game (Fomo3D on Base) using Smart Vulture strategy.

## What It Does

Automated trading bot for ClawFomo game using evolved strategy: 1 key per bid, dividend-aware EV calculation, opponent profiling, whale dodging, and activity detection for optimal entry timing.

## Quick Start

```bash
# Live play
source ~/.axiom/wallet.env
export NET_PRIVATE_KEY
node scripts/play-v5.mjs

# Dry run
node scripts/play-v5.mjs --dry-run

# Check current round
node scripts/status.mjs
```

## Requirements

- Node.js 18+
- Private key with CLAWD tokens for gameplay
- `viem` package: `npm install viem`