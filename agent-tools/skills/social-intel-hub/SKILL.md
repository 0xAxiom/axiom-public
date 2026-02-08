# Social Intel Hub

Find and score engagement opportunities across the web. Surfaces conversations where showing your work is genuinely helpful, not spammy.

## How It Works

1. **Search** — Query keywords from `config/keywords.json` via `web_search` tool (Brave)
2. **Score** — Run results through `src/scanner.mjs` scoring engine (relevance, freshness, authority, context fit)
3. **Suggest** — Generate response guidelines via `src/responder.mjs` matched to your skills inventory
4. **Review** — Send top opportunities to Telegram for human approval

## Running a Scan (Agent Cron)

The scan runs as an OpenClaw cron job with `agentTurn`. The agent:

### Step 1: Search keywords
Load keywords from `config/keywords.json`. For each keyword, use `web_search` with `freshness: "pw"` (past week).

```
web_search({ query: keyword.term, count: 5, freshness: "pw" })
```

Rotate through 3-4 keywords per scan (not all 8). Track which were searched last in a state file.

### Step 2: Format results as JSON
Structure results as:
```json
[
  {
    "keyword": "AI agent tools",
    "results": [
      {"title": "...", "url": "...", "description": "...", "domain": "...", "published": "..."}
    ]
  }
]
```

### Step 3: Score
Pipe JSON into the scanner:
```bash
echo '$JSON' | node ~/Github/axiom-public/agent-tools/skills/social-intel-hub/src/scanner.mjs 4 10
```

### Step 4: Report
Send results to Telegram. Only report opportunities scoring 5+.

If no opportunities found, reply with just a summary line. Don't spam with empty results.

## Scoring Breakdown (0-10 scale)

| Factor | Range | What it measures |
|--------|-------|-----------------|
| Relevance | 0-3 | DeFi, agents, onchain, automation keywords |
| Freshness | 0-2 | Last 24h = 2, last week = 1, older = 0 |
| Authority | 0-2 | Domain reputation (GitHub/dev.to = high) |
| Context Fit | 0-3 | Match against skills inventory |

Final score = raw × keyword weight. Keywords like "LP management bot" have 1.5x weight.

## Files

- `config/keywords.json` — Search terms, weights, exclusions
- `config/skills-inventory.json` — Your tools/skills for context matching
- `src/scorer.mjs` — Scoring engine
- `src/scanner.mjs` — Result processor (stdin JSON → ranked output)
- `src/responder.mjs` — Response suggestion generator
- `scripts/scan.sh` — CLI wrapper (`--demo` for test run)

## Engagement Rules

These are baked into the responder but worth repeating:

1. **Lead with value, not links.** Solve their problem first.
2. **Show your work.** Link to actual code, not landing pages.
3. **Read the room.** Don't reply to 3-day-old threads.
4. **One reply per thread.** Never double-tap.
5. **Skip if someone already answered well.** Don't pile on.

## Adding Keywords

Edit `config/keywords.json`:
```json
{"term": "new keyword", "category": "defi", "weight": 1.5}
```

Higher weight = opportunities with this keyword rank higher.

## Adding Skills to Inventory

Edit `config/skills-inventory.json` when you ship new tools. The context matcher uses this to identify threads where your tools are directly relevant.
