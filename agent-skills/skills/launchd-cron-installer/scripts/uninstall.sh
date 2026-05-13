#!/usr/bin/env bash
# uninstall.sh — bootout a launchd job and remove its plist.
set -euo pipefail

label=""
keep_plist=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --label)      label="$2"; shift 2;;
    --keep-plist) keep_plist=1; shift;;
    -h|--help)    echo "Usage: uninstall.sh --label <name> [--keep-plist]"; exit 0;;
    *) echo "error: unknown arg: $1" >&2; exit 2;;
  esac
done

[[ -z "$label" ]] && { echo "error: --label required" >&2; exit 2; }

uid="$(id -u)"
plist_path="$HOME/Library/LaunchAgents/$label.plist"

if launchctl print "gui/$uid/$label" >/dev/null 2>&1; then
  launchctl bootout "gui/$uid/$label"
  echo "booted out: $label"
else
  echo "not loaded: $label"
fi

if [[ -e "$plist_path" && $keep_plist -eq 0 ]]; then
  rm "$plist_path"
  echo "removed: $plist_path"
fi
