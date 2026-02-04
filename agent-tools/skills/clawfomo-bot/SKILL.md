# ClawFomo Player Bot 🦞

Open-source strategic bot for [ClawFomo](https://clawfomo.com/) — a last-bidder-wins game by [@clawdbotatg](https://x.com/clawdbotatg) on Base.

Built by [@AxiomBot](https://x.com/AxiomBot) — an autonomous AI agent.

## Game Mechanics

ClawFomo is an onchain auction game using **$CLAWD** tokens:

- **Last buyer wins** — when the timer hits zero, the last person to buy keys takes **50% of the pot**
- **Anti-snipe** — buying within 120s of round end extends the timer by 120s
- **Key pricing** — price increases with each purchase in a round
- **Burns** — 20% of pot burned on round end (deflationary)
- **Dividends** — key holders earn dividends from buys during the round

## What This Skill Does

Two scripts:

### `status.mjs` — Round Monitor
Read-only. Shows current round state, pot size, timer, key price, and EV calculation.

```bash
node scripts/status.mjs
```

### `play.mjs` — Strategic Player
Watches the game and places bids using **expected value (EV) calculations**:

1. Polls round state every 3 seconds
2. Waits for the snipe window (last 120s of timer)
3. Calculates if pot winnings > bid cost (positive EV)
4. Only bids when it's +EV and we're not already the leader
5. Includes frontrun protection (rejects 50%+ cost spikes between read and write)

```bash
# Dry run — watch and simulate, no real bids
node scripts/play.mjs --dry-run

# Live — play to win
node scripts/play.mjs

# Custom settings
node scripts/play.mjs --min-pot 2.0 --snipe-window 60
```

## Options

| Flag | Default | Description |
|------|---------|-------------|
| `--dry-run` | false | Simulate only, no transactions |
| `--max-keys` | 1 | Keys per bid |
| `--min-pot` | 1.5 | Min pot/cost ratio for +EV |
| `--snipe-window` | 120 | Seconds before round end to start bidding |
| `--poll` | 3000 | Poll interval in milliseconds |

## Setup

```bash
# Install dependencies
cd scripts && npm install viem

# Set environment variables
export NET_PRIVATE_KEY="0x..."         # Your wallet private key
export BASE_RPC_URL="https://..."      # Base RPC endpoint (optional)
```

**Requirements:**
- Node.js 18+
- $CLAWD tokens in your wallet
- A Base RPC endpoint (public works, private recommended)

## Contracts

| Contract | Address |
|----------|---------|
| ClawFomo | `0x859e5cb97e1cf357643a6633d5bec6d45e44cfd4` |
| $CLAWD | `0x9f86dB9fc6f7c9408e8Fda3Ff8ce4e78ac7a6b07` |

## Risk Management

- ✅ Only bids when EV is positive (pot winnings > cost)
- ✅ Skips if we're already the last buyer (no wasted keys)
- ✅ Frontrun protection — re-checks cost before execution
- ✅ Rate limited (10s between bids)
- ✅ Anti-snipe aware (accounts for timer extensions)
- ⚠️ This is a game — you can lose tokens. Use at your own risk.

## How It Works

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│ Poll Round   │────▶│ Calculate EV │────▶│ Bid or Wait │
│ State (3s)   │     │ pot×50%/cost │     │ if +EV, bid │
└─────────────┘     └──────────────┘     └─────────────┘
       │                                        │
       │         ┌──────────────────┐           │
       └────────▶│ Frontrun Check   │◀──────────┘
                 │ re-read cost     │
                 │ reject if +50%   │
                 └──────────────────┘
```

## License

MIT — use it, fork it, improve it.
