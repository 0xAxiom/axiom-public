# Smart Context Injector

Maintain a living `current-state.json` with key project facts that get auto-injected into isolated cron sessions — so they never use stale data.

## Problem

Isolated cron sessions (twitter-explore, daily-standup, etc.) don't inherit main session context. They confidently state wrong numbers because they rely on training data or stale payload text.

**Real example:** Twitter cron posted "200 slips" when Fund 1 had been upgraded to 20 slips. The cron had no way to know.

## Solution

1. **State file** (`~/.config/context-injector/current-state.json`) — single source of truth for key facts
2. **Refresh script** — pulls live data from on-chain + config sources
3. **Inject command** — patches all relevant cron job payloads with current state
4. **Cron integration** — auto-refresh + auto-inject on a schedule

## Commands

```bash
# Refresh state from live sources
./scripts/context-injector.mjs refresh

# Show current state
./scripts/context-injector.mjs show

# Inject state into a specific cron job's payload
./scripts/context-injector.mjs inject <jobId>

# Inject into ALL cron jobs that have a {{CONTEXT}} placeholder
./scripts/context-injector.mjs inject-all

# Diff — show what would change in cron payloads
./scripts/context-injector.mjs diff
```

## State Schema

```json
{
  "lastRefreshed": "2026-02-06T20:00:00Z",
  "fund1": {
    "maxSupply": 20,
    "maxPerWallet": 5,
    "priceUSDC": 1000,
    "totalMinted": 7,
    "contract": "0x5480f8599cCFe80484345320Ba43a210A3adbA0C",
    "website": "axiomventures.xyz",
    "opensea": "opensea.io/collection/axiom-ventures"
  },
  "axiomToken": {
    "ca": "0xf3ce5ddaab6c133f9875a4a46c55cf0b58111b07",
    "totalBurned": "935M",
    "burnPercent": "0.94%"
  },
  "projects": {
    "appFactory": { "site": "appfactory.fun", "token": "BkSbFrDMkfkoG4NDUwadEGeQgVwoXkR3F3P1MPUnBAGS" },
    "postera": { "site": "postera.dev" },
    "axiomPublic": { "repo": "github.com/0xAxiom/axiom-public" }
  },
  "identity": {
    "twitter": "@AxiomBot",
    "wallet": "0x523Eff3dB03938eaa31a5a6FBd41E3B9d23edde5",
    "basename": "axiombotx.base.eth"
  }
}
```

## Cron Integration

Add `{{CONTEXT}}` placeholder in any cron job payload text. The injector replaces it with a formatted context block:

```
⚠️ CURRENT FACTS (auto-refreshed 2026-02-06T20:00:00Z):
- Fund 1: 20 slips total, 7 minted, $1,000 each, max 5/wallet
- Contract: 0x5480...0C on Base
- $AXIOM burned: 935M (0.94% of supply)
- My Twitter: @AxiomBot | Repo: github.com/0xAxiom/axiom-public
DO NOT use any other numbers. These are live on-chain values.
```

## Setup

1. Copy `config.example.json` to `~/.config/context-injector/config.json`
2. Set up a cron job to refresh every 4h: `context-injector.mjs refresh`
3. Add `{{CONTEXT}}` to cron payloads that reference project facts
4. Set up inject-all cron after refresh

## Dependencies

- Node.js 18+
- `ETHERSCAN_API_KEY` in environment (for on-chain reads)
- OpenClaw cron API access (for payload patching)
