---
name: social-inbox
description: Aggregate, score, and prioritize social mentions across X/Twitter. Outputs a ranked inbox with engagement scores and draft context for efficient reply batching.
---

# Social Inbox

Fetches X/Twitter mentions and brand searches, deduplicates against already-replied tweets, scores by engagement potential, and outputs a prioritized inbox.

## Usage

```bash
# Full scan: mentions + brand search
node ~/Github/axiom-public/agent-skills/skills/social-inbox/social-inbox.mjs

# Mentions only
node ~/Github/axiom-public/agent-skills/skills/social-inbox/social-inbox.mjs --mentions-only

# Output as JSON (for piping)
node ~/Github/axiom-public/agent-skills/skills/social-inbox/social-inbox.mjs --json

# Custom search terms
node ~/Github/axiom-public/agent-skills/skills/social-inbox/social-inbox.mjs --search "AppFactory,axiom ventures"
```

## Output

Saves to `~/clawd/data/social-inbox.json` with structure:
```json
{
  "lastScan": "2026-02-08T...",
  "items": [
    {
      "id": "tweet_id",
      "author": "@handle",
      "text": "...",
      "url": "https://x.com/...",
      "score": 8.5,
      "scoreBreakdown": { "relevance": 3, "question": 2, "directMention": 2, "recency": 1.5 },
      "status": "pending",
      "source": "mentions"
    }
  ]
}
```

## Scoring (0-10)

| Signal | Points |
|--------|--------|
| Direct @mention | +2 |
| Question mark (asking us something) | +2 |
| Keywords: fund, invest, agent, build, LP, token | +1 each (max 3) |
| Recency (<1h: +2, <6h: +1.5, <24h: +1) | up to +2 |
| Not a bot/spam pattern | +1 (default, -1 if detected) |

Items scoring <3 are filtered out. Already-replied tweets are excluded.

## Cron Integration

Add to OpenClaw cron for periodic scanning:
```json
{
  "kind": "agentTurn",
  "message": "Run social inbox scan: node ~/Github/axiom-public/agent-skills/skills/social-inbox/social-inbox.mjs\nReview the top 3 items and draft replies if valuable."
}
```

## Dependencies

- `twitter-api.py` (already installed)
- `twitter-replied.json` dedup log (already exists)
- Node.js 20+
