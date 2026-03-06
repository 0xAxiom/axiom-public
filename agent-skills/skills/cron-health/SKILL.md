# Cron Health Monitor

Monitor your agent's scheduled jobs — detect failures, stuck runs, drift, and silent errors. Built for AI agents running periodic tasks (heartbeats, trading loops, social posting, data syncing).

## Why

Cron jobs fail silently. A stuck heartbeat at 3 AM means hours of missed signals. This skill gives your agent self-awareness about its own operational health.

## Usage

### Check All Crons
```bash
node scripts/cron-health.mjs --config crons.json
```

### Check Specific Job
```bash
node scripts/cron-health.mjs --job trading-monitor --max-age 300
```

### Output Format
```json
{
  "healthy": 12,
  "warning": 1,
  "critical": 2,
  "jobs": [
    {
      "name": "trading-monitor",
      "status": "critical",
      "reason": "Last run 47 minutes ago (max: 5 minutes)",
      "lastRun": "2026-03-06T14:23:00Z",
      "lastExitCode": 1,
      "lastDuration": "34s"
    }
  ]
}
```

## Configuration

Create `crons.json`:
```json
{
  "jobs": [
    {
      "name": "trading-monitor",
      "command": "python3 main_loop.py monitor",
      "maxAgeSeconds": 300,
      "maxDurationSeconds": 120,
      "logPath": "~/logs/trading.log",
      "alertOn": ["late", "failed", "slow"]
    },
    {
      "name": "heartbeat",
      "command": "node heartbeat.mjs",
      "maxAgeSeconds": 14400,
      "logPath": "~/logs/heartbeat.log",
      "alertOn": ["late", "failed"]
    }
  ]
}
```

## Alert Types

| Alert | Trigger | Severity |
|-------|---------|----------|
| `late` | Job hasn't run within `maxAgeSeconds` | warning → critical (2x) |
| `failed` | Last exit code ≠ 0 | critical |
| `slow` | Duration exceeded `maxDurationSeconds` | warning |
| `drift` | Actual interval drifting >20% from expected | warning |
| `silent` | Job ran but produced no output | warning |

## Integration

### With OpenClaw Heartbeats
Add to your HEARTBEAT.md:
```bash
node ~/agent-skills/skills/cron-health/scripts/cron-health.mjs --config ~/crons.json
```
Report any critical/warning jobs to your human.

### With Notifications
```bash
# Pipe to any notification system
node scripts/cron-health.mjs --config crons.json --format slack
node scripts/cron-health.mjs --config crons.json --format telegram
node scripts/cron-health.mjs --config crons.json --format discord
```

## Zero Dependencies

Pure Node.js — no npm install needed. Reads process lists, log files, and timestamps. Works on macOS and Linux.
