# GitHub Pulse Dashboard

**Real-time GitHub activity monitoring for multiple repositories**

## Problem Statement

Project maintainers and teams need visibility into what's happening across their GitHub repos:
- When did the last commit happen?
- Are there PRs waiting for review?
- What's the commit velocity trend?
- Who's actively contributing?

Currently this requires visiting multiple GitHub pages or setting up complex CI pipelines.

## Solution

A lightweight, self-hosted dashboard that:
1. Monitors multiple repos via GitHub API
2. Receives webhook events for real-time updates
3. Displays activity metrics in a clean web UI
4. Runs locally with minimal dependencies

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        GitHub Pulse                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   ┌──────────────┐     ┌──────────────┐     ┌──────────────┐   │
│   │   GitHub     │     │   Express    │     │   Web UI     │   │
│   │   API        │────▶│   Server     │────▶│   (SSE)      │   │
│   │   Polling    │     │              │     │              │   │
│   └──────────────┘     └──────────────┘     └──────────────┘   │
│          │                    ▲                    │            │
│          │                    │                    │            │
│          ▼                    │                    ▼            │
│   ┌──────────────┐     ┌──────────────┐     ┌──────────────┐   │
│   │   Rate       │     │   Webhook    │     │   Charts.js  │   │
│   │   Limiter    │     │   Handler    │     │   Rendering  │   │
│   └──────────────┘     └──────────────┘     └──────────────┘   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Data Flow

1. **Initial Load**: API fetches recent activity for configured repos
2. **Live Updates**: SSE stream pushes new events to connected clients
3. **Webhook Path**: `/webhook` receives GitHub events, triggers SSE broadcast
4. **Polling Fallback**: Every 5 min, refresh data if webhooks unavailable

## Components

### 1. Server (`server.mjs`)
- Express server on port 3456
- GitHub API client with auth
- SSE endpoint for real-time updates
- Webhook handler for push/PR/issue events
- In-memory event store (last 100 events per repo)

### 2. GitHub Client (`github.mjs`)
- Octokit-based API client
- Rate limit aware (5000 req/hr with token)
- Fetches: commits, PRs, issues, contributors
- Caches responses with TTL

### 3. Web UI (`public/index.html`)
- Single HTML file with inline CSS/JS
- Chart.js for activity graphs
- EventSource for SSE connection
- Responsive grid layout

### 4. Config (`config.json`)
```json
{
  "repos": [
    "0xAxiom/axiom-public",
    "MeltedMindz/AppFactory"
  ],
  "port": 3456,
  "pollInterval": 300000,
  "maxEvents": 100
}
```

## Tech Stack

- **Runtime**: Node.js 20+
- **Server**: Express 4
- **GitHub API**: Octokit
- **Charts**: Chart.js (CDN)
- **Styling**: Tailwind (CDN)
- **Real-time**: Server-Sent Events

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | Dashboard UI |
| `/api/repos` | GET | List configured repos |
| `/api/activity/:owner/:repo` | GET | Activity for specific repo |
| `/api/stream` | GET | SSE stream for live updates |
| `/webhook` | POST | GitHub webhook receiver |

## Metrics Displayed

### Per Repository
- **Commit velocity**: commits/day over last 30 days
- **Open PRs**: count + oldest age
- **Open Issues**: count + labeled breakdown
- **Last activity**: time since last push
- **Top contributors**: by commits this month

### Aggregate
- **Total commits today**: across all repos
- **Pending reviews**: PRs awaiting review
- **Activity heatmap**: hour-of-day distribution

## Security

- GitHub token stored in env var `GITHUB_TOKEN`
- Webhook signature validation (if secret configured)
- No sensitive data in UI
- Local-only by default (bind to 127.0.0.1)

## File Structure

```
github-pulse/
├── ARCHITECTURE.md
├── README.md
├── package.json
├── config.json
├── server.mjs           # Main server
├── lib/
│   ├── github.mjs       # GitHub API client
│   └── events.mjs       # Event store + SSE
└── public/
    └── index.html       # Dashboard UI
```

## Build Phases

### Phase 1: Core Server (30 min)
- Express server setup
- GitHub API client
- Basic routes

### Phase 2: Data Layer (30 min)
- Fetch commits, PRs, issues
- Event store
- Rate limiting

### Phase 3: Real-time (30 min)
- SSE implementation
- Webhook handler
- Event broadcasting

### Phase 4: UI (45 min)
- Dashboard layout
- Charts integration
- Live update handling

### Phase 5: Polish (15 min)
- Error handling
- README
- Example output

## Example Output

```
┌─────────────────────────────────────────────────────────────┐
│  GITHUB PULSE                           [Live ●]            │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  0xAxiom/axiom-public                                       │
│  ├─ Last push: 2h ago                                       │
│  ├─ Commits today: 12                                       │
│  ├─ Open PRs: 3 (oldest: 2d)                               │
│  └─ Open Issues: 8                                          │
│                                                             │
│  MeltedMindz/AppFactory                                     │
│  ├─ Last push: 5h ago                                       │
│  ├─ Commits today: 4                                        │
│  ├─ Open PRs: 1 (oldest: 1d)                               │
│  └─ Open Issues: 15                                         │
│                                                             │
│  [═══════════════════░░░░░░░░░░] 72 commits this week      │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## Stretch Goals (if time)

- GitHub Actions status badges
- Contributor sparklines
- Customizable time ranges
- Dark/light theme toggle
- Export to JSON

---

*Designed: 2026-02-02 20:05 PT*
