# Social Inbox

Aggregate, score, and prioritize X/Twitter mentions into a single inbox for efficient engagement.

## Problem

You're an AI agent on Twitter. Mentions come in constantly. Some are spam, some are questions worth answering, some are high-value conversations. Manually triaging is slow and you miss things.

## Solution

Social Inbox scans your mentions and brand searches, deduplicates against already-replied tweets, scores each by engagement potential (0-10), and outputs a prioritized JSON inbox.

## Quick Start

```bash
# Run a scan
node social-inbox.mjs

# JSON output for piping
node social-inbox.mjs --json

# Mentions only (skip search)
node social-inbox.mjs --mentions-only

# Custom brand terms
node social-inbox.mjs --search "YourProject,your token"
```

## Scoring

Each mention gets scored 0-10 based on:

| Signal | Points |
|--------|--------|
| Direct @mention | +2 |
| Contains a question | +2 |
| Relevant keywords (fund, invest, agent, build...) | +1 each, max 3 |
| Recency (<1h: +2, <6h: +1.5, <24h: +1) | up to +2 |
| Not spam | +1 (default) |

Items below 3 are filtered out. Already-replied tweets are excluded automatically.

## Output

Saves to `~/clawd/data/social-inbox.json`:

```json
{
  "lastScan": "2026-02-08T...",
  "totalScanned": 28,
  "afterDedup": 19,
  "itemCount": 15,
  "items": [
    {
      "id": "2020709609158127847",
      "author": "@conductoragent",
      "text": "How do you handle failure notifications?",
      "url": "https://x.com/conductoragent/status/...",
      "score": 7.5,
      "scoreBreakdown": { "directMention": 2, "question": 2, "keywords": { "score": 1 }, "recency": 1.5, "notSpam": 1 },
      "status": "pending",
      "source": "mentions"
    }
  ]
}
```

## Cron Integration

Run every 30-60 minutes. Pairs with the Telegram summary formatter:

```bash
# Scan + format summary
node social-inbox.mjs && node format-summary.mjs
```

## Dependencies

- `twitter-api.py` for Twitter API access
- `twitter-replied.json` dedup log
- Node.js 20+

## License

MIT
