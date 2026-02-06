# PR Review Stream 🔍

**Streaming AI Code Review Pipeline**

GitHub PR webhook → Stream through local LLM → Incremental review comments

## Problem

Code review is manual and slow. Local LLMs are powerful but disconnected from workflow. No tool streams review comments as they generate.

## Solution

End-to-end automated pipeline:
1. GitHub webhook on PR open/sync
2. Smart diff chunking (AST-aware, not line-by-line)
3. Stream through local LLM (qwq for reasoning, gemma3 for speed)
4. Post incremental review comments as they generate
5. Handle rate limits, timeouts, partial reviews gracefully

## Architecture

```
┌─────────────┐     ┌───────────────┐     ┌─────────────────┐
│ GitHub      │────▶│ Webhook       │────▶│ Diff Parser     │
│ PR Event    │     │ Server        │     │ + AST Chunker   │
└─────────────┘     └───────────────┘     └────────┬────────┘
                                                    │
                           ┌────────────────────────┘
                           ▼
                    ┌─────────────────┐
                    │ Review Engine   │
                    │  - Model router │
                    │  - Streaming    │
                    │  - Rate limiter │
                    └────────┬────────┘
                             │
              ┌──────────────┴──────────────┐
              ▼                              ▼
       ┌─────────────┐              ┌───────────────┐
       │ Ollama      │              │ GitHub API    │
       │ (local LLM) │──stream────▶│ Review Comments│
       └─────────────┘              └───────────────┘
```

## Components

### 1. Webhook Server (`src/server.ts`)
- Hono framework (fast, TypeScript)
- Verify GitHub webhook signatures
- Queue management for concurrent PRs
- Health endpoint + status dashboard

### 2. Diff Parser (`src/diff.ts`)
- Parse unified diff format
- Extract file paths, hunks, context
- Handle binary files, renames, deletes

### 3. AST Chunker (`src/chunker.ts`)
- tree-sitter bindings for JS/TS/Python/Rust
- Chunk by semantic units (functions, classes)
- Preserve context window (imports, types)
- Fallback to line-based for unknown languages

### 4. Review Engine (`src/review.ts`)
- Model selection based on diff size
- Stream response handling
- Token counting + budget management
- Prompt engineering for actionable reviews

### 5. GitHub Client (`src/github.ts`)
- Octokit with rate limit handling
- Batch comment creation
- Review state management
- Error recovery + retries

### 6. Dashboard (`src/dashboard.tsx`)
- Real-time review status
- Token usage tracking
- Review history
- Config management

## Data Flow

```
PR Event
    │
    ▼
┌─────────────────────────────────────────────┐
│ 1. Receive webhook, verify signature        │
│ 2. Fetch full diff via GitHub API           │
│ 3. Parse diff into file changes             │
└────────────────────┬────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────┐
│ 4. For each file:                           │
│    a. Detect language                       │
│    b. Parse AST (tree-sitter)               │
│    c. Chunk into semantic units             │
│    d. Add surrounding context               │
└────────────────────┬────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────┐
│ 5. For each chunk:                          │
│    a. Build review prompt                   │
│    b. Stream through local LLM              │
│    c. Parse suggestions as they arrive      │
│    d. Batch into GitHub review comments     │
└────────────────────┬────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────┐
│ 6. Submit review:                           │
│    - COMMENT if suggestions                 │
│    - APPROVE if clean                       │
│    - REQUEST_CHANGES if critical issues     │
└─────────────────────────────────────────────┘
```

## Tech Stack

- **Runtime:** Bun (fast startup, native TS)
- **Framework:** Hono (minimal, fast)
- **LLM:** Ollama (local models)
- **Parser:** tree-sitter (AST)
- **GitHub:** Octokit
- **Dashboard:** React + Preact signals
- **Storage:** SQLite (review history)

## Models

| Model | Use Case | Context | Speed |
|-------|----------|---------|-------|
| qwq | Complex logic, security review | 32k | Slow |
| gemma3:27b | Code style, simple issues | 128k | Medium |
| deepseek-r1 | Quick feedback, obvious issues | 128k | Fast |

Router logic:
- < 50 lines changed → deepseek-r1 (quick)
- 50-200 lines → gemma3:27b (balanced)
- > 200 lines or security-related → qwq (thorough)

## API

### Webhook Endpoint
```
POST /webhook/github
Headers:
  X-GitHub-Event: pull_request
  X-Hub-Signature-256: sha256=...
Body: GitHub PR event payload
```

### Status Endpoint
```
GET /api/reviews/:prId
Response: { status, comments, tokens, duration }
```

### Dashboard
```
GET /
Response: HTML dashboard with live updates
```

## Configuration

```yaml
# config.yaml
github:
  app_id: env(GITHUB_APP_ID)
  private_key: env(GITHUB_PRIVATE_KEY)
  webhook_secret: env(GITHUB_WEBHOOK_SECRET)

ollama:
  host: http://localhost:11434
  models:
    fast: deepseek-r1
    balanced: gemma3:27b
    thorough: qwq

review:
  max_files: 50
  max_tokens_per_file: 4000
  timeout_seconds: 300
  languages:
    - typescript
    - javascript
    - python
    - rust

rate_limits:
  github_comments_per_minute: 30
  concurrent_reviews: 3
```

## Review Prompt Template

```
You are reviewing a code change. Provide specific, actionable feedback.

FILE: {{filename}}
LANGUAGE: {{language}}
CONTEXT: {{surrounding_code}}

CHANGE:
```diff
{{diff}}
```

Review for:
1. Bugs and logic errors
2. Security vulnerabilities
3. Performance issues
4. Code style and readability
5. Missing edge cases

For each issue, respond in this format:
LINE: <number>
SEVERITY: critical|warning|suggestion
ISSUE: <brief description>
FIX: <specific suggestion>

If the code is fine, respond: LGTM
```

## Error Handling

| Error | Handling |
|-------|----------|
| LLM timeout | Post partial review + note |
| GitHub rate limit | Queue + retry with backoff |
| Parse failure | Fall back to line-based chunking |
| Large PR | Skip files, add summary note |
| Network error | Retry 3x, then mark failed |

## Metrics

- Reviews completed
- Average review time
- Tokens used per review
- Comments per review
- Languages covered

## Directory Structure

```
pr-review-stream/
├── src/
│   ├── server.ts      # Main Hono server
│   ├── webhook.ts     # GitHub webhook handling
│   ├── diff.ts        # Diff parsing
│   ├── chunker.ts     # AST-aware chunking
│   ├── review.ts      # LLM review engine
│   ├── github.ts      # GitHub API client
│   ├── router.ts      # Model selection
│   ├── config.ts      # Configuration
│   └── types.ts       # TypeScript types
├── dashboard/
│   ├── App.tsx        # React dashboard
│   └── index.html     # Entry point
├── test/
│   ├── diff.test.ts
│   ├── chunker.test.ts
│   └── fixtures/
├── package.json
├── bunfig.toml
├── config.example.yaml
├── README.md
└── ARCHITECTURE.md
```

## MVP Scope (3 hours)

1. ✅ Webhook server with signature verification
2. ✅ Diff parsing + basic chunking
3. ✅ Ollama streaming integration
4. ✅ GitHub comment posting
5. ✅ Basic rate limiting
6. ⏳ Simple status dashboard

## Future Enhancements

- [ ] Full tree-sitter AST chunking
- [ ] Review memory (learn from dismissed comments)
- [ ] Custom rules per repository
- [ ] Slack/Discord notifications
- [ ] PR summary generation
- [ ] Multi-LLM consensus reviews
