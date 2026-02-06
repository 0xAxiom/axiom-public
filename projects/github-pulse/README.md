# GitHub Pulse 📊

**Real-time GitHub activity dashboard for multiple repositories**

![Screenshot](https://img.shields.io/badge/status-production-green) ![License](https://img.shields.io/badge/license-MIT-blue)

## Features

- 📈 **Live Activity**: Real-time updates via Server-Sent Events
- 📊 **Commit Velocity**: 30-day commit history charts per repo
- 🔀 **PR Tracking**: Open pull requests with age indicators
- 🎫 **Issue Overview**: Open issues at a glance
- 🪝 **Webhook Support**: Instant updates when you push
- ⚡ **Lightweight**: No database, minimal dependencies

## Quick Start

```bash
# Clone
git clone https://github.com/0xAxiom/daily-builds
cd daily-builds/builds/2026-02-02-github-pulse

# Install
npm install

# Configure repos in config.json
cat config.json

# Run (with GitHub token for higher rate limits)
GITHUB_TOKEN=your_token npm start

# Open dashboard
open http://localhost:3456
```

## Configuration

Edit `config.json`:

```json
{
  "repos": [
    "your-org/repo-one",
    "your-org/repo-two"
  ],
  "port": 3456,
  "pollIntervalMs": 300000
}
```

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /` | Dashboard UI |
| `GET /api/activity` | All repos activity data |
| `GET /api/activity/:owner/:repo` | Single repo activity |
| `GET /api/stream` | SSE event stream |
| `POST /webhook` | GitHub webhook receiver |
| `GET /api/status` | Server status |

## Webhook Setup (Optional)

For instant updates, configure a GitHub webhook:

1. Go to repo → Settings → Webhooks → Add webhook
2. Payload URL: `https://your-domain/webhook`
3. Content type: `application/json`
4. Events: Push, Pull requests, Issues, Stars

## Example Output

```
╔═══════════════════════════════════════════════════════════════╗
║                      GITHUB PULSE                              ║
╠═══════════════════════════════════════════════════════════════╣
║  Commits Today: 16    Open PRs: 4    Open Issues: 23          ║
╠═══════════════════════════════════════════════════════════════╣
║  0xAxiom/axiom-public                     Last push: 2h ago   ║
║  ├─ Commits today: 12                                         ║
║  ├─ Open PRs: 3 (oldest: 2d)                                 ║
║  └─ Open Issues: 8                                            ║
║                                                               ║
║  MeltedMindz/AppFactory                   Last push: 5h ago   ║
║  ├─ Commits today: 4                                          ║
║  ├─ Open PRs: 1                                               ║
║  └─ Open Issues: 15                                           ║
╚═══════════════════════════════════════════════════════════════╝
```

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        GitHub Pulse                              │
├─────────────────────────────────────────────────────────────────┤
│   GitHub API ──▶ Express Server ──▶ SSE Stream ──▶ Web UI      │
│        ▲              ▲                              │          │
│        │              │                              ▼          │
│   Rate Limiter    Webhook Handler              Chart.js        │
└─────────────────────────────────────────────────────────────────┘
```

## Tech Stack

- **Runtime**: Node.js 20+
- **Server**: Express 4
- **GitHub API**: Octokit
- **Charts**: Chart.js (CDN)
- **Styling**: Tailwind CSS (CDN)
- **Real-time**: Server-Sent Events

## Why?

GitHub's activity graphs are per-repo and not real-time. For teams monitoring multiple repos, this provides:

1. **Single pane of glass** - All repos in one view
2. **Real-time updates** - See commits as they happen
3. **Self-hosted** - Your data stays on your machine
4. **No vendor lock-in** - Just Node.js and GitHub API

## License

MIT © [Axiom](https://twitter.com/AxiomBot)

---

*Part of [daily-builds](https://github.com/0xAxiom/daily-builds) - Production-quality tools built by AI agents.*
