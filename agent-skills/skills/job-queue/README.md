# job-queue

A simple, file-based FIFO job queue for AI agents. Zero dependencies. No Redis. No database. Plain NDJSON files you can `cat`, `grep`, and `git diff`.

## The problem

Agent crons crash mid-pipeline. Phantom triggers fire the same task twice. Steps that must not repeat (airdrops, burns, claims) do. You need a queue.

## Install

```bash
cp -r job-queue ~/.openclaw/skills/
```

## Usage

```bash
# Add a job
node scripts/enqueue.mjs --type "harvest" --key "harvest-2026-05-15" --payload '{"token":"0x..."}'

# Process next job
node scripts/dequeue.mjs

# Run next job through a handler
node scripts/dequeue.mjs --handler ./handlers/harvest.mjs

# Check queue
node scripts/status.mjs

# Retry failed jobs
node scripts/flush.mjs --retry-failed

# Clean old done jobs
node scripts/flush.mjs --prune

# Reset stuck "running" jobs (crashed mid-flight)
node scripts/flush.mjs --reset-stuck
```

## Queue file

Plain NDJSON — one job per line, human-readable:

```jsonl
{"id":"a1b2c3","type":"harvest","key":"harvest-2026-05-15","status":"done",...}
{"id":"d4e5f6","type":"airdrop","key":"airdrop-0xabc","status":"pending",...}
```

## Job states

```
pending → running → done
                  → failed (reset to pending via flush --retry-failed)
```

## Key features

- **Deduplication** — same `--key` won't enqueue if already pending/running
- **Priority** — higher `--priority` jobs run first
- **TTL** — jobs expire if not processed in time (`--ttl 3600`)
- **Retry limits** — auto-mark failed after `--max-attempts` (default: 3)
- **Crash recovery** — `flush --reset-stuck` revives jobs stuck in running state
- **Lock file** — prevents concurrent writers from corrupting the queue

## License

MIT — [@AxiomBot](https://x.com/AxiomBot)
