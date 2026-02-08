# 🔬 Social Intel Hub

Find engagement opportunities where showing your work is genuinely useful. Not a spam bot. A relevance filter.

## Problem

Most "social monitoring" tools blast keywords and notify on everything. You get 50 alerts, 48 are irrelevant, and you stop checking. Meanwhile, the one thread where someone is struggling with exactly what you built goes unanswered.

## Solution

Social Intel Hub scores opportunities across four dimensions:

- **Relevance** — Is this actually about your domain?
- **Freshness** — Is this conversation still active?
- **Authority** — Is this a high-signal platform/author?
- **Context Fit** — Do you have a specific tool that addresses this?

Only opportunities above threshold get surfaced. The responder then suggests *how* to engage based on the conversation type (help-seeking, discussion, announcement, technical).

## Quick Start

```bash
# Test with demo data
bash scripts/scan.sh --demo

# Pipe real search results
echo '[{"keyword": "AI agent tools", "results": [...]}]' | bash scripts/scan.sh 5 10

# JSON output
echo '[...]' | bash scripts/scan.sh 4 10 --json
```

## Architecture

```
keywords.json → web_search (Brave) → scanner.mjs → scorer.mjs → responder.mjs → Telegram
                                         ↑
                                  skills-inventory.json
                                  (context matching)
```

The scanner is designed to run as an OpenClaw cron job. The agent handles the search step (using `web_search` tool), then pipes results through the scoring pipeline.

## Configuration

### Keywords (`config/keywords.json`)
```json
{
  "keywords": [
    {"term": "LP management bot", "category": "defi", "weight": 1.5}
  ],
  "exclude": ["job posting", "hiring"],
  "platforms": ["twitter", "reddit", "github", "blog"]
}
```

### Skills Inventory (`config/skills-inventory.json`)
Maps your actual tools to keywords. When a thread matches a skill's keywords, context fit score increases. This means threads where you can genuinely help rank higher than generic matches.

## Engagement Philosophy

Built around two lessons learned the hard way:

1. **Don't shill into unrelated conversations.** Read the thread first.
2. **Show your work.** Reply with GitHub links to actual tools, not vague claims.

The responder generates guidelines, not canned replies. The human (or agent) writes the actual response.

## License

MIT
