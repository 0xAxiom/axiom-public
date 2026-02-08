#!/usr/bin/env bash
# scan.sh - Run social intel scan with pre-loaded search results
# Usage: echo '<json>' | bash scripts/scan.sh [min_score] [max_results] [--json]
# Or:   bash scripts/scan.sh --demo (runs with sample data)

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

if [[ "${1:-}" == "--demo" ]]; then
  cat <<'EOF' | node "$PROJECT_DIR/src/scanner.mjs" "${2:-4}" "${3:-10}"
[
  {
    "keyword": "AI agent tools",
    "results": [
      {
        "title": "Building Autonomous DeFi Agents with Uniswap V4",
        "url": "https://github.com/example/defi-agent-v4",
        "description": "Open source framework for building AI agents that manage Uniswap V4 liquidity positions automatically",
        "domain": "github.com"
      },
      {
        "title": "Why I stopped using cron for my AI bot",
        "url": "https://dev.to/someone/ai-bot-scheduling",
        "description": "Struggling with cron job reliability for my autonomous agent. Looking for better alternatives.",
        "domain": "dev.to"
      }
    ]
  },
  {
    "keyword": "LP management bot",
    "results": [
      {
        "title": "Auto-compound LP fees: lessons from losing $2K",
        "url": "https://reddit.com/r/defi/auto-compound-lp",
        "description": "I built an LP auto-compound bot and learned some expensive lessons about tick ranges and gas optimization",
        "domain": "reddit.com"
      }
    ]
  }
]
EOF
  exit 0
fi

# Read from stdin
node "$PROJECT_DIR/src/scanner.mjs" "${1:-4}" "${2:-10}" "${@:3}"
