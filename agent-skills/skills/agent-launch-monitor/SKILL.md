# Agent Launch Monitor

Track post-launch metrics for tokens deployed via Agent Launchpad (or any Base token).

## What It Does

- **Price tracking** — Current price, 1h/24h changes, ATH detection
- **Volume monitoring** — 24h volume, spike detection
- **Holder counts** — Via Etherscan V2 API, milestone alerts
- **Liquidity tracking** — Pool liquidity, low liquidity warnings
- **ROI from launch** — Track performance vs launch price
- **Historical state** — Persisted across runs for trend analysis

## Quick Start

```bash
# One-time check
./scripts/monitor.mjs check 0xf3ce5d9e5c2fba3d9f9fbac093b7c6c4e38bb07

# Add token to tracking
./scripts/monitor.mjs track 0xf3ce... "AXIOM"

# Check all tracked tokens
./scripts/monitor.mjs status

# Check for alerts (use in cron)
./scripts/monitor.mjs alerts
```

## Commands

| Command | Description |
|---------|-------------|
| `check <address>` | One-time token metrics check |
| `track <address> [name]` | Add token to persistent monitoring |
| `untrack <address>` | Remove token from monitoring |
| `status` | Display all tracked tokens with metrics |
| `alerts` | Check for alert conditions (price changes, milestones) |
| `json` | Output current status as JSON |

## Alert Types

| Alert | Trigger | Severity |
|-------|---------|----------|
| `PRICE_PUMP` | Price up ≥20% since last check | medium/high |
| `PRICE_DUMP` | Price down ≥20% since last check | medium/high |
| `NEW_ATH` | New all-time high reached | high |
| `VOLUME_SPIKE` | Volume 3x previous period | medium |
| `HOLDER_MILESTONE` | Reached 100/500/1K/5K/10K holders | medium |
| `LOW_LIQUIDITY` | Liquidity dropped below $1,000 | high |

## Configuration

Create `config.json` to customize thresholds:

```json
{
  "priceChangeAlertPct": 20,
  "volumeSpikeMultiple": 3,
  "holderMilestones": [100, 500, 1000, 5000, 10000],
  "liquidityMinUsd": 1000,
  "checkIntervalMs": 300000
}
```

## Cron Integration

Add to OpenClaw cron for automated monitoring:

```bash
# Check every 5 minutes
*/5 * * * * cd /path/to/skill && ./scripts/monitor.mjs alerts
```

Or via OpenClaw cron job:
```json
{
  "name": "token-monitor",
  "schedule": { "kind": "every", "everyMs": 300000 },
  "payload": { "kind": "systemEvent", "text": "Run token monitor alerts" },
  "sessionTarget": "main"
}
```

## Telegram Alerts

Pipe alerts to Telegram:

```bash
#!/bin/bash
OUTPUT=$(./scripts/monitor.mjs alerts)
if echo "$OUTPUT" | grep -q "🚨"; then
  # Send via OpenClaw message tool
  echo "$OUTPUT"
fi
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ETHERSCAN_API_KEY` | Optional | Enables holder count tracking |
| `OUTPUT_JSON` | Optional | Include JSON in alerts output |

## Data Sources

- **Dexscreener API** — Price, volume, liquidity, pairs (no key, 300 req/min)
- **Etherscan V2 API** — Holder counts (requires key)
- **Base RPC** — Token info (name, symbol, supply)

## State Files

- `state.json` — Tracked tokens, history, ATH prices
- `config.json` — Alert thresholds (optional)

## Example Output

```
📊 AXIOM (AXIOM)
   Address: 0xf3ce5d9e5c2fba3d9f9fbac093b7c6c4e38bb07

💰 Price: $0.00001234
   1h: +5.23%
   24h: -12.45%

📈 Market Cap: $123,456
   FDV: $1,234,567

💧 Liquidity: $45,678
📊 Volume 24h: $12,345
👥 Holders: 234

🔗 DEX: uniswap | Pair: 0x1234abcd...
⏰ Checked: 2026-02-01T20:00:00.000Z
   🚀 Launch: $0.00000500 | ROI: 146.8%
   🏆 ATH: $0.00002000
```

## Use Cases

1. **Track your own token** — Monitor $AXIOM or tokens from Agent Launchpad
2. **Watch competitors** — Track similar agent tokens
3. **LP management** — Know when liquidity is low
4. **Community updates** — Auto-post milestones to Twitter/Telegram
