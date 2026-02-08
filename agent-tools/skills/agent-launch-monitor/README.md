# Agent Launch Monitor

Track post-launch metrics for tokens deployed via Agent Launchpad or any Base token.

## What It Does

Monitors token prices, volume, holder counts, liquidity, and ROI from launch price. Provides real-time alerts for price pumps/dumps, volume spikes, holder milestones, and low liquidity warnings.

## Quick Start

```bash
# Check a token's metrics
./scripts/monitor.mjs check 0xf3ce5d9e5c2fba3d9f9fbac093b7c6c4e38bb07

# Add token to tracking
./scripts/monitor.mjs track 0xf3ce... "AXIOM"

# Check all tracked tokens
./scripts/monitor.mjs status

# Check for alerts (use in cron)
./scripts/monitor.mjs alerts
```

## Requirements

- Node.js 18+
- Optional: `ETHERSCAN_API_KEY` for holder count tracking