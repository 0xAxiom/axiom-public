# block-time-analyzer

Measure actual block production timing on any EVM chain. Detects congestion, empty-block runs, timing anomalies, and gas utilization patterns.

Zero dependencies. Uses public RPC directly.

## Usage

```bash
# Analyze last 100 blocks on Base (default)
node analyze.mjs

# Analyze more blocks for better statistical picture
node analyze.mjs --blocks 500

# Use any EVM chain
node analyze.mjs --rpc https://eth.llamarpc.com --target 12

# Detailed percentile breakdown
node analyze.mjs --percentiles

# JSON output for piping
node analyze.mjs --json | jq '.timing'
```

## What it measures

- **Timing**: mean, median, std dev, min/max, percentiles (p5-p99)
- **Target drift**: how far actual block time deviates from expected
- **Anomalies**: instant blocks (0s), slow blocks (>3x target), longest gap
- **Throughput**: transactions per block, gas utilization, empty block runs
- **Health**: overall chain health rating (HEALTHY / OK / DEGRADED)

## Example output

```
  Block Time Analysis
  ──────────────────────────────────────────────────
  Range:     #30,000,001 → #30,000,100
  Span:      3m 18s
  Blocks:    100

  Timing
  ──────────────────────────────────────────────────
  Mean:      2.000s
  Median:    2s
  Std dev:   0.000s
  Min / Max: 2s / 2s

  Target: 2s
  ──────────────────────────────────────────────────
  On target: 99 (100.0%)
  Drift:     +0.000s
  Health:    HEALTHY
```

## Options

| Flag | Description | Default |
|------|-------------|---------|
| `--blocks N` | Number of blocks to analyze | 100 |
| `--rpc URL` | RPC endpoint | Base mainnet |
| `--target N` | Expected block time (seconds) | 2 |
| `--percentiles` | Show p5/p25/p50/p75/p95/p99 | off |
| `--json` | Output as JSON | off |
