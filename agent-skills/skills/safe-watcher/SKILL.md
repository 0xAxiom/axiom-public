# safe-watcher

Monitor Gnosis Safe multisig proposals across EVM chains. Detect new proposals, track signing progress, and alert when proposals reach execution threshold. Zero dependencies, pure Node.js — uses the public Safe Transaction Service API.

## When to use

- Monitor treasury multisig for pending proposals
- Alert when a proposal reaches signing threshold and is ready to execute
- Check which owners still need to sign before a tx can go through
- Watch DAO Safe wallets for governance execution
- Automate execution triggers when threshold is met
- Audit who signed what and when

## Triggers

Use this skill when someone says: "check my Safe", "watch my multisig", "any pending proposals", "is my tx ready to execute", "who needs to sign", "monitor my DAO Safe", "Safe multisig alerts", "check gnosis safe"

## Scripts

```
scripts/
├── check-safe.mjs  — one-shot: list pending proposals + signer status
└── watch-safe.mjs  — polling watcher: alerts on new proposals and threshold crossings
```

## Quick start

```bash
# Check pending proposals on mainnet
node scripts/check-safe.mjs 0xYourSafeAddress

# Check on Base
node scripts/check-safe.mjs 0xYourSafeAddress --chain base

# JSON output (for scripts and cron)
node scripts/check-safe.mjs 0xYourSafeAddress --chain base --json

# Watch for changes every 60s (default)
node scripts/watch-safe.mjs 0xYourSafeAddress --chain mainnet

# Watch on Base, check every 2 minutes, save state
node scripts/watch-safe.mjs 0xYourSafeAddress --chain base --interval 120 --state ./my-safe.json

# One-shot poll (cron-friendly — exits after one check)
node scripts/watch-safe.mjs 0xYourSafeAddress --chain base --once
```

## Supported chains

| Flag | Chain |
|------|-------|
| `mainnet` | Ethereum mainnet |
| `base` | Base |
| `arbitrum` | Arbitrum One |
| `optimism` | Optimism |
| `polygon` | Polygon |
| `sepolia` | Sepolia testnet |
| `base-sepolia` | Base Sepolia testnet |

## Output

**check-safe.mjs:**
```
 Safe: 0xAbc...
 Chain: base | Threshold: 2/3 | Nonce: 14
 Owners: 0x1234...abcd, 0x5678...ef01, 0x9abc...2345

  2 pending proposal(s):

  [READY] nonce=14  transfer()
    to:   0xRecipient...
    hash: 0x1a2b3c4d5e6f7a8b9c0d...

  [1/2 sigs] nonce=15  approve()
    to:   0xTokenContract...
    hash: 0xdeadbeef1234...
    need: 0x9abc...2345
```

**watch-safe.mjs** (continuous lines to stdout):
```
[2026-05-17T...] OK | safe=0xAbc... | pending=1 | threshold=2/3 | nonce=14
[2026-05-17T...] INFO | NEW_PROPOSAL | nonce=15 | approve() | to=0xToken... | sigs=0/2
[2026-05-17T...] ALERT | READY_TO_EXECUTE | nonce=15 | approve() | sigs=2/2
```

Exit code `2` when proposals are ready to execute — use in shell conditionals or cron alerting.

## No API key required

Uses the [Safe Transaction Service](https://safe-global.github.io/safe-transaction-service/) public REST API. No authentication needed for read operations on any supported chain.

## Cron example

```bash
# Check every 5 minutes, alert if anything is ready
*/5 * * * * node /path/to/safe-watcher/scripts/watch-safe.mjs 0xYourSafe --chain base --once >> /var/log/safe-watcher.log 2>&1
```

## Pair with

- **notification-router** — send Telegram/Discord alerts when proposals are ready
- **job-queue** — queue execution transactions when threshold is crossed
- **circuit-breaker** — gate downstream actions on Safe approval status
- **fund-sentinel** — cross-reference Safe proposals with treasury anomaly detection
