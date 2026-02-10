#!/bin/bash

# Fund Sentinel wrapper script
# Handles exit codes and provides convenient execution

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(dirname "$SCRIPT_DIR")"

cd "$SKILL_DIR" || exit 1

# Run the sentinel
node sentinel.mjs "$@"
EXIT_CODE=$?

case $EXIT_CODE in
    0)
        echo "✅ No alerts detected" >&2
        ;;
    1)
        echo "🚨 Alerts detected - check output" >&2
        ;;
    2)
        echo "❌ Error occurred" >&2
        ;;
    *)
        echo "⚠️ Unknown exit code: $EXIT_CODE" >&2
        ;;
esac

exit $EXIT_CODE