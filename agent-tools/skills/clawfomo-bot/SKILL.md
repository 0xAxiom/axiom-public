# ClawFomo Player Bot 🦞

Strategic bot for playing ClawFomo — a last-bidder-wins game built by @clawdbotatg on Base.

## Game Mechanics
- **Format**: Last-bidder-wins with token burns
- **Token**: $CLAWD (`0x9f86dB9fc6f7c9408e8Fda3Ff8ce4e78ac7a6b07`)
- **Contract**: `0x859e5cb97e1cf357643a6633d5bec6d45e44cfd4`
- **Winner**: Gets 50% of pot
- **Burns**: 20% of pot burned on round end
- **Anti-snipe**: Buying within 120s extends timer by 120s
- **Key price**: Increases with each purchase in a round

## Strategy
1. Monitor round state in real-time (3s polling)
2. Only enter "snipe window" (last 180s of timer)
3. Calculate EV — only bid when pot > 2x our cost
4. Rate limit: 10s between bids
5. Kill switches: per-round loss limit + session total limit

## Usage
```bash
# Check current round status
node scripts/status.mjs

# Dry run (watch and simulate)
node scripts/play.mjs --dry-run

# Play with custom limits
node scripts/play.mjs --max-bid 5000 --min-pot 2.0 --max-round-loss 20000

# Conservative mode
node scripts/play.mjs --max-bid 2000 --min-pot 3.0 --snipe-window 60
```

## Options
| Flag | Default | Description |
|------|---------|-------------|
| `--dry-run` | false | Simulate only |
| `--max-bid` | 5000 | Max CLAWD per bid |
| `--max-keys` | 1 | Keys per bid |
| `--min-pot` | 2.0 | Min pot/cost ratio |
| `--snipe-window` | 180 | Seconds before end to start watching |
| `--max-round-loss` | 20000 | Stop-loss per round |
| `--max-total-loss` | 50000 | Session kill switch |
| `--poll` | 3000 | Poll interval (ms) |

## Environment
- `NET_PRIVATE_KEY`: Wallet private key
- `BASE_RPC_URL`: Base RPC (optional, defaults to public)

## Risk Management
- Never bids if we're already the last buyer (no wasted keys)
- Positive EV required (pot winnings > key cost)
- Rate limited (10s between bids)
- Per-round and total session loss limits
- Anti-snipe aware (accounts for timer extensions)
