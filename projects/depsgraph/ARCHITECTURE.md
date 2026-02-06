# depsgraph — Dependency Topology Visualizer

> "See the hidden architecture of any npm package in seconds."

## Overview

`depsgraph` scans npm packages or local projects and generates interactive force-directed dependency graphs. It reveals the true topology hidden inside `node_modules` — showing size bloat, maintenance risk, version conflicts, and deeply nested chains that nobody thinks about until something breaks.

## Why This Matters

- Average npm package pulls in 200+ transitive dependencies
- Developers install packages blindly ("just npm install it")
- Security audits focus on CVEs but miss structural risk (abandoned packages, single-maintainer bottlenecks)
- No existing tool provides a **beautiful, shareable visualization** of dependency topology

## Architecture

```
┌───────────────────────────────────────────────────────────────┐
│                        depsgraph                               │
├───────────────┬──────────────┬─────────────┬─────────────────┤
│  Package      │  Graph       │  Risk       │  Web            │
│  Resolver     │  Engine      │  Analyzer   │  Dashboard      │
│               │              │             │                 │
│  - npm API    │  - D3 force  │  - Maint.   │  - Express      │
│  - lockfile   │  - Hierarchy │  - Size     │  - Interactive  │
│  - tree walk  │  - Cluster   │  - Depth    │  - Export SVG   │
│               │              │  - Outdated │  - Share link   │
└───────┬───────┴──────┬───────┴──────┬──────┴────────┬────────┘
        │              │              │               │
        ▼              ▼              ▼               ▼
   npm registry    graph.json    risk-report     localhost:3847
```

## Components

### 1. Package Resolver (`src/resolver/`)
**Purpose:** Fetch and walk the complete dependency tree for any npm package.

**Implementation:**
- `resolveFromRegistry(packageName)` — Calls npm registry API (`registry.npmjs.org/{pkg}`) to get metadata, then recursively resolves all dependencies
- `resolveFromLockfile(path)` — Parses `package-lock.json` or `yarn.lock` for exact installed versions
- `resolveFromLocal(projectPath)` — Scans local `node_modules` for actual installed tree
- Deduplication: tracks seen packages to handle circular deps
- Output: normalized dependency tree (JSON) with metadata per node

**Data model per node:**
```json
{
  "name": "express",
  "version": "4.18.2",
  "dependencies": ["body-parser@1.20.1", "cookie@0.5.0", ...],
  "metadata": {
    "description": "Fast web framework",
    "license": "MIT",
    "maintainers": 3,
    "lastPublish": "2023-10-12",
    "weeklyDownloads": 29000000,
    "unpackedSize": 214528,
    "deprecated": false
  }
}
```

### 2. Graph Engine (`src/graph/`)
**Purpose:** Transform the dependency tree into a renderable graph structure.

**Implementation:**
- Converts tree to nodes + edges format for D3
- Calculates layout metrics:
  - **Depth:** distance from root (deeper = more hidden)
  - **Fan-out:** number of dependents (higher = more important)
  - **Cluster detection:** groups of tightly connected packages
- Node sizing: proportional to `unpackedSize`
- Edge coloring: direct deps (strong) vs transitive (faded)

**Graph output format:**
```json
{
  "nodes": [
    { "id": "express@4.18.2", "depth": 0, "size": 214528, "risk": "low", "group": 1 },
    { "id": "body-parser@1.20.1", "depth": 1, "size": 45056, "risk": "medium", "group": 1 }
  ],
  "edges": [
    { "source": "express@4.18.2", "target": "body-parser@1.20.1", "type": "direct" }
  ],
  "stats": {
    "totalPackages": 57,
    "totalSize": "2.3 MB",
    "maxDepth": 8,
    "directDeps": 31,
    "transitiveDeps": 26
  }
}
```

### 3. Risk Analyzer (`src/analyzer/`)
**Purpose:** Score each dependency on maintenance and security risk.

**Risk factors (each 0-100, weighted average):**
| Factor | Weight | How |
|--------|--------|-----|
| Last publish age | 25% | >2yr = high risk, >1yr = medium |
| Maintainer count | 20% | 1 = high (bus factor), 2-5 = medium, 5+ = low |
| Weekly downloads | 15% | <1000 = high risk (potentially abandoned) |
| Dependency depth | 15% | Depth >5 = high (deeply hidden) |
| Package size | 10% | >1MB single package = elevated |
| Deprecation | 10% | Deprecated = critical |
| License | 5% | Missing/copyleft in prod = warning |

**Output:** Risk score per node (0-100) + overall project risk score + top-5 riskiest dependencies.

**Color mapping:**
- 🟢 0-25: Healthy (green)
- 🟡 26-50: Watch (yellow)
- 🟠 51-75: Concern (orange)
- 🔴 76-100: Critical (red)

### 4. Web Dashboard (`src/web/`)
**Purpose:** Interactive visualization with export capabilities.

**Stack:** Express + vanilla HTML/CSS/JS + D3.js (no React — keep it fast and simple)

**Views:**
1. **Force Graph** (default) — Interactive force-directed layout. Drag nodes. Hover for details. Zoom/pan. Click to highlight dependency chain.
2. **Tree View** — Collapsible hierarchy showing the full dependency tree
3. **Risk Report** — Table sorted by risk score with actionable recommendations
4. **Stats Bar** — Total packages, total size, max depth, direct vs transitive ratio

**Interactions:**
- Search: filter/highlight packages by name
- Click node: show details panel (version, size, risk factors, npm link)
- Right-click: "trace path from root" — highlights the shortest path from root to this dep
- Export: PNG screenshot, SVG vector, JSON data
- Share: generates a static HTML file with embedded data (no server needed)

**Design:**
- Dark theme (#0a0a0a background per Axiom design system)
- Inter font, muted accents
- Node colors by risk score
- Edge opacity by depth
- Smooth animations on layout changes

### 5. CLI Interface (`src/cli.js`)
**Purpose:** Entry point for command-line usage.

**Commands:**
```bash
# Analyze any npm package
depsgraph express

# Analyze a local project
depsgraph ./my-project

# Analyze from a lockfile
depsgraph --lockfile ./package-lock.json

# Output JSON only (no web UI)
depsgraph express --json > graph.json

# Output risk report
depsgraph express --risk

# Open web dashboard
depsgraph express --web  # default: opens browser to localhost:3847
```

### 6. API Server (`src/server.js`)
**Purpose:** REST API powering the web dashboard.

**Endpoints:**
```
GET  /api/analyze/:package    — Resolve + graph + risk for an npm package
GET  /api/analyze?path=...    — Resolve from local path
GET  /api/graph/:package      — Get graph data only
GET  /api/risk/:package       — Get risk report only
GET  /api/search?q=...        — Search within loaded graph
GET  /api/stats               — Summary statistics
POST /api/compare             — Compare two packages side-by-side
GET  /api/export/svg          — Export current graph as SVG
GET  /api/export/png          — Export as PNG (Puppeteer)
```

## Build Plan

| Phase | Component | Time | Output |
|-------|-----------|------|--------|
| 1 | Package resolver (npm API + lockfile parser) | 45 min | Working tree resolution |
| 2 | Risk analyzer (scoring engine) | 30 min | Risk scores per node |
| 3 | Graph engine (D3 data structures) | 30 min | Graph JSON |
| 4 | Express API server | 20 min | REST endpoints |
| 5 | Web dashboard (D3 force graph) | 60 min | Interactive visualization |
| 6 | CLI interface | 15 min | `depsgraph <pkg>` working |
| 7 | Polish (design, animations, export) | 20 min | Production quality |
| 8 | Tests + README | 20 min | Ship-ready |
| **Total** | | **~4 hours** | |

## Tech Stack

- **Runtime:** Node.js 20+
- **Server:** Express
- **Frontend:** D3.js v7, vanilla HTML/CSS/JS
- **Data:** In-memory (no database needed)
- **APIs:** npm registry (no auth), bundlephobia (size data)
- **CLI:** commander.js
- **Design:** Axiom design system (dark, Inter, muted)

## Visual Output (Tweet-worthy)

Imagine: a beautiful dark canvas with 200+ glowing nodes arranged in a force-directed layout. Express at the center, its 57 dependencies radiating outward. Green nodes (healthy), yellow (aging), red (deprecated `qs` version deep in the tree). Click any node — it lights up the entire dependency chain from root to that package.

**Example tweet:**
> "What does YOUR node_modules actually look like? 🔬
> 
> Built depsgraph — scan any npm package and see its full dependency topology.
> 
> express has 57 deps, max depth 8, 3 packages with a bus factor of 1.
> 
> Try it: npx depsgraph express
> 
> github.com/0xAxiom/daily-builds"

## Non-Goals (for today)
- Package.json editing/upgrading (just analysis)
- Other ecosystems (pip, cargo, go mod) — npm only for v1
- Historical version tracking
- Cloud/SaaS features
