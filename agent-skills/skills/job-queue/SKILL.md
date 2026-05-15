# job-queue

Simple file-based FIFO job queue for AI agents. Zero dependencies. No Redis. No database. Just atomic filesystem operations.

Agents run in crons, sometimes crash mid-pipeline, sometimes get triggered twice. A job queue gives you serialization, deduplication, and retry — built on plain NDJSON files your agent can read with `cat`.

## When to use

- Serialize agent operations so only one runs at a time
- Deduplicate tasks (prevent the same job from being enqueued twice)
- Retry failed steps without re-running completed ones
- Queue work across multiple cron invocations
- Buffer bursts: accept 100 jobs, process 10/minute
- Drain a backlog on startup
- Any pipeline with steps that should never repeat (airdrops, burns, claims)

## Triggers

Use this skill when someone says: "job queue", "task queue", "serialize tasks", "deduplicate jobs", "retry failed", "drain queue", "process one at a time", "queue agent work", "FIFO queue", "prevent duplicate runs"

## Scripts

```
scripts/
├── enqueue.mjs   — add a job to the queue
├── dequeue.mjs   — pop the next pending job and run it
├── status.mjs    — show queue state (pending/running/done/failed)
└── flush.mjs     — clean up done/expired jobs
```

## Quick start

```bash
# Enqueue a job
node scripts/enqueue.mjs --type "airdrop" --payload '{"wallet":"0x...","amount":100}'

# Enqueue with deduplication key (same key = no duplicate)
node scripts/enqueue.mjs --type "harvest" --key "harvest-2026-05-15" --payload '{}'

# Dequeue and process next job (prints job JSON to stdout)
node scripts/dequeue.mjs

# Run a job through a handler script
node scripts/dequeue.mjs --handler ./handlers/harvest.mjs

# Check queue state
node scripts/status.mjs

# JSON output for scripts
node scripts/status.mjs --json

# Retry all failed jobs (reset to pending)
node scripts/flush.mjs --retry-failed

# Clean up done + expired jobs older than 24h
node scripts/flush.mjs --prune
```

## Job lifecycle

```
enqueue → [pending] → dequeue → [running] → done / failed
                                           ↓
                                    retry-failed → [pending]
```

## Options

### enqueue.mjs

| Flag | Default | Description |
|------|---------|-------------|
| `--type` | required | Job type label (e.g. "airdrop", "harvest") |
| `--payload` | `{}` | JSON string with job data |
| `--key` | auto (uuid) | Dedup key — same key skips if job already pending/running |
| `--priority` | `0` | Higher = processed first |
| `--max-attempts` | `3` | Retry limit before marking failed |
| `--ttl` | `86400` | Seconds before job expires unprocessed |
| `--queue` | `queue.ndjson` | Path to queue file |
| `--json` | off | JSON output |

### dequeue.mjs

| Flag | Default | Description |
|------|---------|-------------|
| `--handler` | — | Script to `exec` with job JSON as stdin |
| `--queue` | `queue.ndjson` | Path to queue file |
| `--json` | off | Print job as JSON to stdout |
| `--dry-run` | off | Peek at next job without marking it running |

### status.mjs

| Flag | Default | Description |
|------|---------|-------------|
| `--queue` | `queue.ndjson` | Path to queue file |
| `--json` | off | JSON output |
| `--failed` | off | Show only failed jobs |
| `--pending` | off | Show only pending jobs |

### flush.mjs

| Flag | Default | Description |
|------|---------|-------------|
| `--retry-failed` | off | Reset all failed jobs to pending |
| `--prune` | off | Delete done + expired jobs older than `--age` seconds |
| `--age` | `86400` | Max age in seconds for pruning |
| `--queue` | `queue.ndjson` | Path to queue file |

## Queue file format

Plain NDJSON — one job per line. Human-readable. Appendable. Greppable.

```jsonl
{"id":"a1b2c3","type":"harvest","key":"harvest-2026-05-15","status":"done","payload":{},"attempts":1,"createdAt":1747000000,"updatedAt":1747000060}
{"id":"d4e5f6","type":"airdrop","key":"airdrop-0xabc","status":"pending","payload":{"wallet":"0xabc","amount":100},"attempts":0,"createdAt":1747000120,"updatedAt":1747000120}
```

## Agent integration

```javascript
// cron job: drain queue, process one per run
import { execSync } from 'child_process';

const job = JSON.parse(
  execSync('node /path/to/job-queue/scripts/dequeue.mjs --json', { encoding: 'utf8' }).trim()
);

if (!job) process.exit(0); // queue empty

try {
  await processJob(job);
  // mark done — dequeue.mjs handles this automatically on clean exit
} catch (err) {
  // dequeue.mjs marks failed on non-zero exit
  process.exit(1);
}
```

```bash
# In a bash pipeline: enqueue and walk away
node enqueue.mjs --type burn --key "burn-$(date +%F)" --payload '{"tokenAddress":"0x..."}'

# Later, cron drains it:
node dequeue.mjs --handler ./handlers/burn.mjs
```

## Notes

- Lock files (`queue.ndjson.lock`) prevent concurrent writers from corrupting the queue.
- On crash, jobs stay in `running` state. Use `flush.mjs --retry-failed` or check `--stale` to reset stuck jobs after a timeout.
- The queue file is append-only during normal operation; `flush.mjs --prune` rewrites it to compact it.
- For high-concurrency (>10 parallel workers), use a real queue. This is for serialized single-agent use.
