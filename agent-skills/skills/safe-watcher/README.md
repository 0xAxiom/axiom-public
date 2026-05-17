# safe-watcher

Monitor Gnosis Safe multisig proposals across EVM chains. Detect new proposals, track signing progress, and alert when a transaction is ready to execute.

Zero dependencies. Pure Node.js. No API key required.

## The problem

Safe multisigs are silent by default. Proposals sit unsigned for days. Signers forget. Execution windows close. You only find out after the fact.

`safe-watcher` fixes that: check pending proposals on demand, or run as a cron watcher that fires alerts when new proposals appear or hit signing threshold.

## Scripts

| Script | What it does |
|--------|-------------|
| `check-safe.mjs` | One-shot: list pending proposals with signer status |
| `watch-safe.mjs` | Polling watcher with state tracking — alerts on new proposals and threshold crossings |

## Usage

### One-shot check

```bash
# List pending proposals
node scripts/check-safe.mjs 0xYourSafeAddress --chain base

# JSON output
node scripts/check-safe.mjs 0xYourSafeAddress --chain mainnet --json
```

**Output:**
```
 Safe: 0xAbc123...
 Chain: base | Threshold: 2/3 | Nonce: 7
 Owners: 0x1234...abcd, 0x5678...ef01, 0x9abc...2345

  2 pending proposal(s):

  [READY] nonce=7  transfer()
    to:   0xRecipient...
    hash: 0x1a2b3c4d5e6f7a8b9c0d...

  [1/2 sigs] nonce=8  approve()
    to:   0xTokenContract...
    hash: 0xdeadbeef1234...
    need: 0x9abc...2345

  ALERT: 1 proposal(s) ready to execute!
```

### Watcher (continuous)

```bash
# Watch every 60s (default)
node scripts/watch-safe.mjs 0xYourSafeAddress --chain base

# Custom interval, persist state between runs
node scripts/watch-safe.mjs 0xYourSafeAddress --chain mainnet --interval 120 --state ./safe-state.json

# One-shot poll — great for cron jobs
node scripts/watch-safe.mjs 0xYourSafeAddress --chain base --once
```

**Output:**
```
[2026-05-17T12:30:00Z] OK | safe=0xAbc... | pending=1 | threshold=2/3 | nonce=7
[2026-05-17T12:32:00Z] INFO | NEW_PROPOSAL | nonce=8 | approve() | to=0xToken... | sigs=0/2
[2026-05-17T12:34:00Z] ALERT | READY_TO_EXECUTE | nonce=8 | approve() | sigs=2/2
```

Exit code `2` when a proposal is ready to execute.

### Cron setup

```bash
# Alert every 5 minutes
*/5 * * * * node /path/to/safe-watcher/scripts/watch-safe.mjs 0xYourSafe --chain base --once >> ~/safe-watch.log 2>&1
```

## Supported chains

`mainnet` · `base` · `arbitrum` · `optimism` · `polygon` · `sepolia` · `base-sepolia`

## No setup required

Uses the public [Safe Transaction Service API](https://safe-global.github.io/safe-transaction-service/). No authentication. No API key. Works immediately.

## Install

```bash
cp -r safe-watcher ~/.openclaw/skills/
# or
cp -r safe-watcher ~/.clawdbot/skills/
```

## Pair with

- **notification-router** — route alerts to Telegram, Discord, or webhook
- **job-queue** — queue execution tx when threshold is crossed
- **circuit-breaker** — gate downstream actions on Safe approval status

---

Built by [@AxiomBot](https://x.com/AxiomBot) · MIT License
