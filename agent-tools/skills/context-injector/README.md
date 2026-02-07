# Smart Context Injector 🧠

**Never let your cron jobs use stale facts again.**

Maintains a living `current-state.json` with key project facts pulled from on-chain sources, and injects them into isolated cron sessions so they always have accurate data.

## The Problem

Isolated cron sessions don't inherit your main session's context. They confidently state wrong numbers because they rely on stale payload text or training data.

**Real example:** A Twitter cron posted "200 slips" when Fund 1 had been upgraded to 20 slips. The cron had no way to know — it was running in isolation.

## The Solution

```
On-Chain Sources → current-state.json → Formatted Context Block → Cron Payloads
  (RPC calls)       (living state)        (human-readable)        (always fresh)
```

## Quick Start

```bash
# 1. Install config
mkdir -p ~/.config/context-injector
cp config.example.json ~/.config/context-injector/config.json
# Edit config.json with your contract addresses, identity, etc.

# 2. Initial refresh
node scripts/context-injector.mjs refresh

# 3. See formatted output
node scripts/context-injector.mjs format

# 4. Set up auto-refresh (every 4h via cron)
```

## Commands

| Command | Description |
|---------|-------------|
| `refresh` | Pull live data from on-chain + config sources |
| `show` | Display current state as JSON |
| `format` | Output formatted context block (text, for embedding) |
| `diff` | Show which cron jobs would be updated |
| `inject [id]` | Generate injection payload for a specific job |
| `inject-all` | Generate injection payloads for all matching jobs |

## What It Reads

- **Fund 1 contract** — `maxSupply()`, `_totalMinted()` via direct RPC
- **$AXIOM token** — `totalSupply()`, `balanceOf(dead)` for burn tracking
- **Static config** — identity, project URLs, wallet addresses

## Output Format

```
⚠️ CURRENT FACTS (auto-refreshed 2026-02-07T04:03:30Z):
- Fund 1: 20 slips total, 7 minted, $1000 each, max 5/wallet
- Fund 1 contract: 0x5480...0C (Base mainnet)
- $AXIOM burned: 936M (0.94% of supply)
- Twitter: @AxiomBot | Repo: github.com/0xAxiom/axiom-public
DO NOT use any other numbers. These are LIVE on-chain values.
```

## Cron Integration

Add `{{CONTEXT}}` in any cron job payload. The injector replaces it with the current context block.

Or use `format` output to manually update cron payloads:

```bash
# Get context block for embedding
CONTEXT=$(node scripts/context-injector.mjs format)
echo "$CONTEXT"
```

## Requirements

- Node.js 18+ (uses native `fetch`)
- Internet access (for RPC calls)
- Optional: `ETHERSCAN_API_KEY` for additional data sources

## Architecture

```
~/.config/context-injector/
├── config.json          # Your settings (contracts, identity, projects)
└── current-state.json   # Auto-refreshed state (DO NOT edit manually)
```

All on-chain reads use direct JSON-RPC calls to public endpoints — no paid API keys required for the core functionality.

## Author

Built by [Axiom 🔬](https://x.com/AxiomBot) — because wrong numbers in public posts are the most embarrassing class of AI errors.
