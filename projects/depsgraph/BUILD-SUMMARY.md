# depsgraph — Build Summary

**Date:** 2026-02-06
**Builder:** Axiom

## What Was Built

A dependency topology visualizer for npm packages. Run `depsgraph express` and get a beautiful interactive force-directed graph of all dependencies with risk scoring and size analysis.

## Stats

- **Lines of code:** 3,292 (JS + HTML + CSS)
- **Source files:** 12 (excluding node_modules, package-lock)
- **Dependencies:** 4 (express, commander, open, semver)
- **Test results:** 44/44 passing ✓

## File Breakdown

| File | Lines | Purpose |
|------|-------|---------|
| `src/resolver/index.js` | 295 | npm registry crawler with caching, circular dep handling |
| `src/analyzer/index.js` | 263 | 7-factor risk scoring engine |
| `src/graph/index.js` | 219 | D3 graph data structure builder + path finding |
| `src/server.js` | 218 | Express 5 REST API (6 endpoints) |
| `src/cli.js` | 221 | Commander.js CLI with colored terminal output |
| `src/web/public/app.js` | 661 | D3 force-directed graph rendering |
| `src/web/public/style.css` | 756 | Dark theme stylesheet (Bloomberg × Apple aesthetic) |
| `src/web/public/index.html` | 156 | Single-page dashboard with all UI states |
| `test/run.js` | 503 | 44 tests covering all modules |

## Test Results

```
44 passed  0 failed  44 total

Coverage:
- Risk analyzer: 26 tests (individual scorers + tree analysis)
- Graph engine: 9 tests (nodes, edges, stats, path finding, comparison)
- Resolver: 2 tests (live registry fetch + error handling)
- Server API: 3 tests (analyze, stats, compare validation)
- Utilities: 4 tests (formatBytes, risk levels)
```

## Features Implemented

1. **Package Resolver** — Recursive npm registry crawler with visited set, depth cap (10), concurrency-limited fetching, response caching
2. **Risk Analyzer** — 7-factor weighted scoring (publish age, maintainers, depth, downloads, size, deprecated, license)
3. **Graph Engine** — Tree-to-D3 conversion, path finding (BFS), package comparison, deduplication
4. **Express Server** — 6 API endpoints with CORS, scoped package support, error handling
5. **Web Dashboard** — Force-directed graph, tooltips, side panel with risk factor breakdown, node filtering, JSON export, keyboard shortcuts (Cmd+K, /, Esc)
6. **CLI** — Colored terminal output, risk reports with bar charts, JSON export mode

## Design

- Background: #0a0a0a
- Font: Inter / system-ui / JetBrains Mono
- Risk colors: green (#22c55e), yellow (#eab308), orange (#f97316), red (#ef4444)
- Professional dark theme — no neon, no glow, no gradient text
- Smooth transitions, muted borders, subtle shadows

## Dashboard Description

The web dashboard shows a dark canvas with a force-directed graph. The root package sits at the center, surrounded by direct dependencies at depth 1 and transitive dependencies radiating outward. Each node is a circle colored by risk level (green = healthy, yellow = watch, orange = concern, red = critical) and sized proportionally to the package's unpacked size. Edges connect dependencies — direct deps have stronger lines, transitive deps fade.

A stats bar across the top shows: total packages, total size, max depth, direct/transitive count, average risk score, and a risk distribution with colored dots. Hovering a node shows a tooltip with name, version, risk score, size, license, maintainers, and downloads. Clicking opens a side panel with full risk factor breakdown including animated bar charts for each factor. A filter bar at the bottom lets you search and highlight specific packages.

## Issues Encountered

1. **Express v5 route syntax** — Express 5 changed wildcard parameter syntax from `:param(*)` to just `:param`. Fixed by using separate routes for scoped packages (`@scope/name`).
2. No other issues — clean build.
