# ClawFomo Bot Skill

Play ClawFomo (Fomo3D on Base) with algorithmic strategy.

## Overview

Automated player for the ClawFomo game on Base chain. Evolved through 5 strategy iterations in 2 hours based on game theory research, on-chain data analysis, and live P&L feedback.

## Strategy Evolution

| Version | Strategy | Keys/Bid | Result |
|---------|----------|----------|--------|
| V1 | Aggressive | 25 | Massive losses — bonding curve destroys you |
| V2 | Capped (3 bids) | 5 | Lost — cap meant we could never defend |
| V3 | Cumulative EV | 5 | Won 3/5 rounds but still net negative — 5 keys too expensive |
| V4 | Vulture (1 key, capped) | 1 | Right idea, wrong cap — folded every contested round |
| **V5** | **Smart Vulture** | **1** | **Dividend-aware EV, opponent profiling, whale dodging** |

## V5 — Smart Vulture Strategy

Core principles learned from game theory + on-chain analysis:

1. **1 key per bid** — same win probability as 25, fraction of the cost
2. **No arbitrary bid caps** — pure EV math controls all decisions
3. **Opponent profiling** — track active bidders, dodge known whales
4. **Dividend-aware EV** — factor earned dividends into round profitability
5. **Activity detection** — wait for quiet moments before entering (30s minimum)
6. **Round selection** — skip rounds with 4+ opponents or whale activity
7. **Frontrun protection** — reject if cost spikes >50% between calculation and execution

### Why 1 Key?

The game rewards the **last buyer**, regardless of how many keys they bought. Buying 5 keys costs 5x more but gives the same win probability. The only benefit of more keys is dividends, but the math doesn't justify the cost increase.

With 1 key at ~5K CLAWD, you can defend 10+ times for less than one old 5-key bid cost (~50K).

### EV Calculation

```
projectedPot = currentPot + (bidCost × 0.65)  // 65% of bid reaches pot
projectedWin = projectedPot × 0.50             // winner gets 50%
dividendEstimate = (ourKeys / totalKeys) × avgBidCost × 0.225 × expectedBids
netEV = projectedWin + dividendEstimate - totalRoundSpend - thisBidCost

// Only bid when netEV > 0
```

### Entry Conditions (ALL required)

- In snipe window (timer ≤ 120s)
- Timer > 5s (TX needs time to land)
- Pot:cost ratio ≥ 4x
- No known whales in round
- ≤ 4 active opponents
- Round quiet for ≥ 30s (first entry only)
- Net EV > 0 after all round spending

## Game Mechanics

- **Contract:** `0x859e5cb97e1cf357643a6633d5bec6d45e44cfd4` (Base)
- **Token:** CLAWD (`0x9f86dB9fc6f7c9408e8Fda3Ff8ce4e78ac7a6b07`)
- **Timer:** 300s max, resets on buy
- **Anti-snipe:** Buy within 120s extends timer TO 120s
- **On buy:** 10% burned, 25% of rest → dividends, 65% → pot
- **On win:** 50% pot → winner, 20% burned, 25% → key holders, 5% → team
- **Key price:** `1000 + totalKeys × 110` CLAWD (bonding curve)

## Scripts

| Script | Purpose |
|--------|---------|
| `scripts/play-v5.mjs` | Live bot — Smart Vulture strategy |
| `scripts/status.mjs` | Check current round state |
| `scripts/check-pnl.mjs` | P&L tracking for cron monitoring |

## Usage

```bash
source ~/.axiom/wallet.env
export NET_PRIVATE_KEY

# Live play
node scripts/play-v5.mjs

# Dry run
node scripts/play-v5.mjs --dry-run

# Custom params
node scripts/play-v5.mjs --ratio 6 --quiet 60 --poll 3000

# Check status
node scripts/status.mjs

# P&L check (for cron)
node scripts/check-pnl.mjs
```

## Key Lessons

1. **Bonding curves are exponential traps** — buying more keys costs quadratically more
2. **The 10% burn is the house edge** — every bid loses 10% immediately. You MUST be selective.
3. **Arbitrary caps lose money** — if the math says bid, bid. If it says stop, stop. No in-between.
4. **1 key = optimal** — same win probability, minimum cost, maximum flexibility
5. **Opponent awareness matters** — whales will outspend you. Don't fight them.
6. **Dividends are real income** — factor them into every decision
7. **Patience is the edge** — most players overbid. The patient vulture wins.

## Dependencies

- `viem` (Ethereum client)
- `NET_PRIVATE_KEY` environment variable
- Base RPC (defaults to https://mainnet.base.org)

## Open Source

Part of [axiom-public](https://github.com/0xAxiom/axiom-public) — open-source agent tools for on-chain operations.
