#!/usr/bin/env bash
# list.sh — list user-installed launchd jobs in ~/Library/LaunchAgents.
set -euo pipefail

agents="$HOME/Library/LaunchAgents"
uid="$(id -u)"

if [[ ! -d "$agents" ]]; then
  echo "no $agents directory"
  exit 0
fi

printf '%-50s %-10s %s\n' "LABEL" "STATUS" "PLIST"
for f in "$agents"/*.plist; do
  [[ -e "$f" ]] || continue
  label="$(basename "$f" .plist)"
  if launchctl print "gui/$uid/$label" >/dev/null 2>&1; then
    status="loaded"
  else
    status="unloaded"
  fi
  printf '%-50s %-10s %s\n' "$label" "$status" "$f"
done
