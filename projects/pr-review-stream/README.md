# PR Review Stream 🔍

**Streaming AI Code Review Pipeline with Local LLMs**

Transform GitHub PRs into actionable reviews using your local models. No API costs, full privacy, incremental feedback.

![PR Review Stream](https://img.shields.io/badge/build-passing-brightgreen) ![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue) ![Bun](https://img.shields.io/badge/Bun-1.0-black)

## Features

- 🔌 **GitHub Webhook Integration** — Auto-review on PR open/sync
- 🤖 **Smart Model Selection** — Routes to fast/balanced/thorough models based on complexity
- 🔐 **Security-Aware** — Extra scrutiny for auth, crypto, and permission code
- 📝 **Inline Comments** — Posts review comments directly on affected lines
- ⚡ **Streaming** — Reviews stream through local LLM for fast feedback
- 📊 **Dashboard** — Real-time review status and history

## Architecture

```
┌─────────────┐     ┌───────────────┐     ┌─────────────────┐
│ GitHub PR   │────▶│ Webhook       │────▶│ Diff Parser     │
│ Event       │     │ Server        │     │ + AST Chunker   │
└─────────────┘     └───────────────┘     └────────┬────────┘
                                                    │
                    ┌───────────────────────────────┘
                    ▼
             ┌─────────────────┐
             │ Model Router    │
             │ (fast/balanced/ │
             │  thorough)      │
             └────────┬────────┘
                      │
       ┌──────────────┴──────────────┐
       ▼                              ▼
┌─────────────┐              ┌───────────────┐
│ Ollama      │──stream────▶│ GitHub Review │
│ (local LLM) │              │ Comments      │
└─────────────┘              └───────────────┘
```

## Quick Start

### Prerequisites

1. **Ollama** with models installed:
   ```bash
   ollama pull deepseek-r1
   ollama pull gemma3:27b
   ollama pull qwq
   ```

2. **GitHub Token** with `repo` scope

### Setup

```bash
# Clone
git clone https://github.com/0xAxiom/daily-builds
cd daily-builds/builds/2026-02-03-pr-review-stream

# Install
bun install

# Configure
export GITHUB_TOKEN="ghp_..."
export GITHUB_WEBHOOK_SECRET="your-secret"

# Run
bun run dev
```

### Webhook Setup

1. Go to your repo → Settings → Webhooks → Add webhook
2. Payload URL: `https://your-server/webhook/github`
3. Content type: `application/json`
4. Secret: Your `GITHUB_WEBHOOK_SECRET`
5. Events: Pull requests

For local development, use a tunnel:
```bash
bun run tunnel  # Creates https://pr-review.loca.lt
```

## Usage

### Automatic (via webhook)

PRs trigger reviews automatically on:
- `opened` — New PR created
- `synchronize` — New commits pushed
- `reopened` — PR reopened

### Manual

```bash
# Trigger review via API
curl -X POST http://localhost:3456/api/review \
  -H "Content-Type: application/json" \
  -d '{"owner": "MeltedMindz", "repo": "AppFactory", "pr": 42}'
```

### Dashboard

Open `http://localhost:3456` to see:
- Queue status
- Recent reviews
- Token usage

## Model Selection

The router picks models based on PR complexity:

| Criteria | Model | Why |
|----------|-------|-----|
| < 50 lines | `deepseek-r1` | Quick feedback |
| 50-200 lines | `gemma3:27b` | Balanced review |
| > 200 lines | `qwq` | Thorough analysis |
| Security keywords | `qwq` | Extra scrutiny |
| Async/concurrent code | `qwq` | Logic complexity |

Keywords that trigger thorough review:
- `auth`, `password`, `token`, `credential`
- `encrypt`, `hash`, `permission`
- `eval`, `exec`, `sql`
- `async`, `await`, `thread`, `mutex`

## Configuration

Environment variables:

| Variable | Description | Default |
|----------|-------------|---------|
| `GITHUB_TOKEN` | GitHub PAT with repo scope | Required |
| `GITHUB_WEBHOOK_SECRET` | Webhook signature secret | `dev-secret` |
| `OLLAMA_HOST` | Ollama server URL | `http://localhost:11434` |
| `PORT` | Server port | `3456` |
| `MAX_FILES` | Max files per review | `50` |
| `TIMEOUT` | Review timeout (seconds) | `300` |

## Review Format

The LLM outputs structured comments:

```
===COMMENT===
FILE: src/auth.ts
LINE: 42
SEVERITY: critical
ISSUE: Password is logged in plaintext, exposing credentials
FIX: Remove console.log or redact sensitive data
===END===
```

Severity levels:
- 🚨 **critical** — Security issues, bugs that cause data loss
- ⚠️ **warning** — Logic errors, potential bugs
- 💡 **suggestion** — Improvements, best practices
- ✨ **praise** — Good patterns worth noting

## API

### `POST /webhook/github`
GitHub webhook endpoint. Verifies signature and queues reviews.

### `POST /api/review`
Manual review trigger.
```json
{ "owner": "string", "repo": "string", "pr": 123 }
```

### `GET /api/reviews/:owner/:repo/:pr`
Get review status and results.

### `GET /api/reviews`
List recent reviews (last 50).

### `GET /health`
Server health and queue status.

## Example Output

PR comment:

```markdown
## 🔍 AI Code Review

**Files reviewed:** 5 (+127 -34)
**Model:** `gemma3:27b`
**Duration:** 12.3s

### Summary

- 🚨 **1** critical issue
- ⚠️ **2** warnings
- 💡 **3** suggestions

---
*Powered by PR Review Stream • Local LLM review*
```

Inline comment:

```markdown
🚨 **CRITICAL**

SQL query constructed with string concatenation allows injection attacks.

**Suggestion:** Use parameterized queries:
`db.query('SELECT * FROM users WHERE id = ?', [userId])`
```

## Limitations

- AST chunking not yet implemented (TODO: tree-sitter)
- No review memory (doesn't learn from dismissed comments)
- Single-threaded processing (queue-based)

## Stack

- **Runtime:** Bun
- **Framework:** Hono
- **LLM:** Ollama (local)
- **GitHub:** Octokit

## Contributing

PRs welcome! Key areas:
- [ ] tree-sitter AST chunking
- [ ] Review memory/learning
- [ ] Multi-LLM consensus
- [ ] More language support

## License

MIT

---

Built by [@AxiomBot](https://twitter.com/AxiomBot) • Part of [Daily Builds](https://github.com/0xAxiom/daily-builds)
