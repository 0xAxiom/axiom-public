# ◈ depsgraph

**Dependency topology visualizer for npm packages.**

See the hidden architecture inside any npm package — interactive force-directed graphs with risk scoring, size analysis, and dependency chain tracing.

```
  ◈ depsgraph — Dependency Topology Visualizer

  ✓ Resolved express in 4.2s

  Summary
  ────────────────────────────────────────────
  Packages      57
  Total Size    2.1 MB
  Max Depth     8
  Direct Deps   31
  Transitive    26
  Avg Risk      28 medium

  ● 34 low  ● 18 medium  ● 4 high  ● 1 critical
```

## Install & Run

```bash
# Analyze any npm package
npx depsgraph express

# Or install globally
npm install -g depsgraph
depsgraph react
```

## Features

- **Force-directed graph** — Interactive D3.js visualization of the full dependency tree
- **Risk scoring** — Every package scored 0-100 across 7 risk factors
- **Size analysis** — See which dependencies contribute to bloat
- **Dependency chain tracing** — Click any node to highlight the path from root
- **Package comparison** — Compare two packages side by side
- **Export** — Download analysis as JSON
- **Zero config** — Just point it at a package name

## Risk Factors

Each package is scored on a weighted average of:

| Factor | Weight | Scoring |
|--------|--------|---------|
| Last publish age | 25% | >2yr=80, >1yr=50, >6mo=20 |
| Maintainer count | 20% | 1=80, 2=50, 3-5=20, 5+=0 |
| Tree depth | 15% | depth×12, capped at 100 |
| Weekly downloads | 15% | <1K=80, <10K=50, <100K=20 |
| Package size | 10% | >1MB=80, >500KB=50, >100KB=20 |
| Deprecated | 10% | deprecated=100, else 0 |
| License | 5% | none=80, copyleft=50, permissive=0 |

Risk levels: 🟢 Low (0-25) · 🟡 Medium (26-50) · 🟠 High (51-75) · 🔴 Critical (76-100)

## CLI Usage

```bash
# Open interactive web dashboard (default)
depsgraph express

# Output JSON analysis
depsgraph express --json > analysis.json

# Print risk report to terminal
depsgraph express --risk

# Custom port
depsgraph express --port 8080

# Custom resolution depth
depsgraph express --depth 5
```

## Web Dashboard

The dashboard opens at `http://localhost:3847` with:

- **Force-directed graph** — Nodes colored by risk level, sized by package size
- **Stats bar** — Total packages, size, depth, risk distribution
- **Tooltips** — Hover any node for package info, risk score, downloads
- **Side panel** — Click a node for detailed risk factor breakdown
- **Filter** — Type `/` to filter and highlight specific packages
- **Search** — `Cmd+K` to search for a new package
- **Export** — Download the full analysis as JSON

### Design

Dark theme (#0a0a0a), Inter font, Bloomberg × Apple aesthetic. Nodes colored by risk: green (healthy), yellow (watch), orange (concern), red (critical). Edges fade by depth.

## API

The server exposes a REST API:

```
GET  /api/analyze/:package    Full analysis (resolve + risk + graph)
GET  /api/risk/:package       Risk report only
GET  /api/stats               Summary stats for current analysis
POST /api/compare             Compare two packages
     Body: { "packages": ["express", "fastify"] }
POST /api/clear-cache         Clear registry cache
```

### Example Response

```json
{
  "package": "ms",
  "graph": {
    "nodes": [
      { "id": "ms@2.1.3", "name": "ms", "version": "2.1.3", "riskScore": 22, "riskLevel": "low", "size": 5623 }
    ],
    "edges": [],
    "stats": {
      "totalPackages": 1,
      "totalSize": 5623,
      "totalSizeFormatted": "5.5 KB",
      "maxDepth": 0,
      "directDeps": 0,
      "transitiveDeps": 0
    }
  }
}
```

## Architecture

```
src/
├── resolver/index.js   — npm registry crawler with caching
├── analyzer/index.js   — 7-factor risk scoring engine
├── graph/index.js      — D3 graph data structure builder
├── server.js           — Express REST API
├── cli.js              — Commander.js CLI interface
└── web/public/
    ├── index.html      — Single-page dashboard
    ├── style.css       — Dark theme stylesheet
    └── app.js          — D3 force graph rendering
```

## Development

```bash
# Run tests
npm test

# Start server only
npm run server

# Run CLI
node bin/depsgraph express
```

## Tech Stack

- **Runtime:** Node.js
- **Server:** Express 5
- **Visualization:** D3.js v7
- **CLI:** Commander.js
- **Design:** Custom dark theme, Inter font

## License

MIT
