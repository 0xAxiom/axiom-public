# Cron Fleet Manager

Health monitor and fleet manager for OpenClaw cron jobs. Detect failures, duplicates, cost waste, stale jobs, and get actionable recommendations — all from one CLI.

Built because we had 30+ cron jobs and zero visibility. The harvest cron silently stopped running for 34 hours. Duplicate Twitter replies went unnoticed. This tool catches all of that.

## Quick Start

```bash
# Full fleet report (Telegram-friendly)
node src/cli.mjs report

# Quick health check (exit code 1 if problems)
node src/cli.mjs health

# Cost breakdown by job
node src/cli.mjs cost

# Check for duplicate jobs
node src/cli.mjs dupes
```

## Commands

| Command | Description |
|---------|-------------|
| `report` | Full fleet health report (Telegram-friendly format) |
| `health` | Quick health check — exit 1 if problems found |
| `dupes` | Detect duplicate/similar jobs |
| `cost` | Cost breakdown by job with model and frequency data |
| `detail` | Full markdown report (for file output) |
| `json` | Raw JSON report (for automation) |
| `list` | Simple list of all jobs with status emoji |
| `stale` | Show only stale/overdue jobs |
| `expensive` | Show jobs costing >$1/day |

## Options

```
--file <path>    Path to jobs.json (default: ~/.openclaw/cron/jobs.json)
--output <path>  Write report to file instead of stdout
--quiet          Suppress output if no issues found (useful for cron gates)
```

## What It Detects

### Health Classification
- 🟢 **Healthy** — running on schedule, no errors
- 🔴 **Failing** — last run had error status
- 🟠 **Stale** — overdue by >1 hour
- 🟡 **Skipped** — last run was skipped (concurrent execution)
- 🐢 **Slow** — last run took >10 minutes
- ⚪ **Never ran** — enabled but has never executed
- ⏸️ **Disabled** — explicitly disabled

### Duplicate Detection
- **Name similarity** — catches `daily-report` and `daily-report-2`
- **Schedule overlap** — same cron expression on different jobs
- **Interval + name match** — same polling interval AND shared terms

### Cost Estimation
- Estimates daily/monthly cost per job based on:
  - Model used (Opus vs Sonnet pricing)
  - Run duration (from last execution)
  - Schedule frequency
- Top spender breakdown
- Fleet total projection

### Recommendations
- Critical: failing jobs requiring immediate attention
- Warning: stale, overdue, or never-ran jobs
- Info: expensive jobs, slow runners, disabled cleanup

## Example Output

```
📊 Cron Fleet Report
2026-02-06

Fleet: 34 jobs (30 active, 4 disabled)
🟢 22 healthy  🔴 0 failing  🟠 0 stale  🐢 1 slow  ⚪ 7 never-ran

⚠️ Issues:
  ⚪ substack-tuesday: Job has never executed
  ⚪ daily-burn: Job has never executed

💰 Estimated cost: ~$132/day (~$3974/mo)
Top spenders:
  twitter-explore: $48/day (opus, 48x/day, ~67s each)
  hourly-harvest: $29/day (sonnet, 24x/day, ~240s each)

💡 Recommendations:
  ⚠️ 7 enabled job(s) never ran
     → Check schedule configuration or trigger manually
```

## Use with OpenClaw Cron

Add as a health gate that runs every 6 hours:

```bash
# Health check — sends Telegram alert only on problems
node ~/Github/axiom-public/projects/cron-fleet-manager/src/cli.mjs health --quiet
```

Or replace the existing `cron-error-monitor` job for more comprehensive monitoring.

## Architecture

```
src/
  analyzer.mjs    Core analysis engine (health, cost, dupes, recommendations)
  cli.mjs         CLI interface with 9 commands
tests/
  analyzer.test.mjs  33 tests (unit + integration against real jobs.json)
```

Zero dependencies — just Node.js standard library. Reads directly from OpenClaw's `cron/jobs.json` file.

## Tests

```bash
node --test tests/analyzer.test.mjs
# 33 tests, 10 suites, 0 failures
```

## License

MIT
