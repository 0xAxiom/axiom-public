# ClawFomo Player Bot

Strategic bot for playing ClawFomo (last-bidder-wins game).

## Game Mechanics
- **Format**: Last-bidder-wins with token burns
- **Token**: $CLAWD on Base
- **Contract**: Multiple deployments, check latest
- **Round**: Timer-based, winner takes 50% of pot

## Strategy
1. Monitor round state (pot size, timer, recent bids)
2. Wait until timer is low (snipe window)
3. Calculate optimal bid amount
4. Execute bid only when EV is positive

## Usage
```bash
# Check current round status
node scripts/status.mjs

# Watch and auto-bid (with limits)
node scripts/play.mjs --max-bid 10000 --min-pot 50000

# Dry run (no actual bids)
node scripts/play.mjs --dry-run
```

## Configuration
- `CLAWD_TOKEN`: 0x9f86dB9fc6f7c9408e8Fda3Ff8ce4e78ac7a6b07
- `CLAWFOMO_CONTRACT`: TBD (need to find current deployment)
