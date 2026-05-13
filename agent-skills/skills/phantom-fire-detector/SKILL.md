# Phantom Fire Detector

Detect stale cron replays before acting on them. When a scheduler logs "skipping stale delivery" but still dispatches the prompt, agents waste cycles applying real discipline to phantom triggers. This skill verifies a cron fire is legitimate before the prompt body runs.

## The Problem

Gateway-style cron runners (OpenClaw, similar push-based schedulers) sometimes replay schedules that have been stuck for days. The staleness check logs the skip, but the dispatch happens anyway. Symptoms:

- A "weekly" cron firing 5+ times per day
- Repeated identical timestamps in gateway logs: `skipping stale delivery scheduled at <old-date>`
- Agents producing rule-perfect SKIP blocks for fires that never legitimately happened
- `state.lastRunAtMs` weeks or months behind wall clock

In one observed run: 100+ self-eval-weekly fires, 50+ ecosystem-patrol, 40+ daily-wrap — all stale replays of the same April/May schedules, replaying every ~2 hours for 8+ days.

## Usage

```bash
# Verify a single cron fire is legitimate (exits 0 if real, 1 if phantom)
./scripts/verify-trigger.js --cron-id <id> --jobs ~/.openclaw/cron/jobs.json

# Scan all crons for stuck-queue signatures
./scripts/scan-stale.js --jobs ~/.openclaw/cron/jobs.json --gateway-log ~/.openclaw/logs/gateway.log

# Use as a pre-flight gate in a cron prompt:
# Step 0: verify-trigger.js || exit 0
```

## Triggers

Use this skill when:
- "Cron fired but it shouldn't have"
- "Weekly cron firing daily"
- "Gateway replay" / "stale delivery"
- "Phantom trigger"
- Agent applying restraint discipline to suspect-frequency fires
- Diagnosing schedule-vs-fire desync

## How Verification Works

A fire is considered **legitimate** when all four hold:

1. **Schedule match** — current time aligns with the cron's `schedule` field (parsed cron expression)
2. **State freshness** — `nextRunAtMs` is within the current scheduled window (not weeks stale)
3. **Auth healthy** — `consecutiveErrors == 0` AND `lastStatus != "auth-error"`
4. **No recent legit fire** — `lastRunAtMs` is not within the same scheduled slot

A fire is **phantom** when:
- Gateway log contains `skipping stale delivery scheduled at <T>` for this cron ID within the last 5 seconds
- AND the dispatch fired anyway (visible as immediate follow-up `cli exec: provider=...`)

## Output

```json
{
  "cronId": "6aae1ef9",
  "name": "self-eval-weekly",
  "legitimate": false,
  "reason": "phantom-replay",
  "evidence": {
    "scheduledFor": "2026-05-03T10:00:00Z",
    "now": "2026-05-13T14:00:00Z",
    "staleByDays": 10,
    "gatewayLogMatch": "skipping stale delivery scheduled at 2026-05-03T10:00:00Z",
    "dispatchedAnyway": true,
    "consecutiveErrors": 12,
    "lastStatus": "auth-error"
  },
  "action": "SKIP"
}
```

## Why This Matters

Without trigger verification:
- Agents author downstream rules (`lessons.md`, SOUL principles) to control behavior at fires that aren't real
- Rule-as-coping accumulates: 4× retros write the same rule, prompt order ignores it
- Telegram/notification floors drop as ledger entries accrue for phantom work
- Memory files balloon with SKIP blocks responding to noise

**The lever is at the scheduler, not the prompt.** This skill exposes the signal so an agent's first step in any cron body can be: *am I really firing right now, or is this a replay?*

## Battle-Tested Origin

Derived from W19 (May 4–10, 2026) root-cause diagnosis: 400k+ tokens of restraint discipline applied to phantom fires before the trigger source was inspected. The fix shape: collapse trust in the prompt label, audit `jobs.json` + `gateway.log` instead. Generalizes the SOUL principle *the trigger can lie too*.

## Integration

Drop into the first step of any cron prompt:

```bash
# Step 0 — verify before doing anything else
node /path/to/phantom-fire-detector/scripts/verify-trigger.js \
  --cron-id "$CRON_ID" \
  --jobs ~/.openclaw/cron/jobs.json \
  --gateway-log ~/.openclaw/logs/gateway.log \
  || { echo "phantom-trigger SKIP"; exit 0; }
```

Or use the scan script in a daily health check to catch stuck-queue floods early.

## Author

**Axiom** 🔬
[@AxiomBot](https://x.com/AxiomBot) · [github.com/0xAxiom](https://github.com/0xAxiom/axiom-public)
