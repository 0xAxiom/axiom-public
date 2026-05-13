#!/usr/bin/env bash
# install.sh — generate a launchd plist and bootstrap it.
# See SKILL.md for full usage. Exits non-zero on any failure.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LAUNCH_AGENTS="$HOME/Library/LaunchAgents"

label=""
schedule=""
interval=""
command_path=""
stdout_path=""
stderr_path=""
run_at_load=""
force=0
dry_run=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --label)        label="$2"; shift 2;;
    --schedule)     schedule="$2"; shift 2;;
    --interval)     interval="$2"; shift 2;;
    --command)      command_path="$2"; shift 2;;
    --stdout)       stdout_path="$2"; shift 2;;
    --stderr)       stderr_path="$2"; shift 2;;
    --run-at-load)  run_at_load="--run-at-load"; shift;;
    --force)        force=1; shift;;
    --dry-run)      dry_run=1; shift;;
    -h|--help)
      cat <<EOF
Usage: install.sh --label <name> --command <path> (--schedule "<cron>" | --interval <sec>) [opts]

Required:
  --label <name>       reverse-DNS label (e.g. com.me.daily-report)
  --command <path>     absolute path to executable

One of:
  --schedule "<cron>"  five-field cron expression
  --interval <sec>     repeat every N seconds

Options:
  --stdout <path>      StandardOutPath (recommended for debugging)
  --stderr <path>      StandardErrorPath
  --run-at-load        run once when the job loads (in addition to schedule)
  --force              overwrite existing plist with the same label
  --dry-run            print the plist + bootstrap command, do not install
EOF
      exit 0
      ;;
    *) echo "error: unknown arg: $1" >&2; exit 2;;
  esac
done

[[ -z "$label"        ]] && { echo "error: --label required" >&2; exit 2; }
[[ -z "$command_path" ]] && { echo "error: --command required" >&2; exit 2; }
if [[ -z "$schedule" && -z "$interval" ]]; then
  echo "error: provide --schedule or --interval" >&2; exit 2
fi
if [[ -n "$schedule" && -n "$interval" ]]; then
  echo "error: --schedule and --interval are mutually exclusive" >&2; exit 2
fi
if [[ ! -x "$command_path" && ! "$command_path" =~ ^/ ]]; then
  echo "error: --command must be an absolute path" >&2; exit 2
fi
if [[ ! -x "$command_path" ]]; then
  echo "warning: $command_path is not executable; launchd will fail at run time" >&2
fi

plist_path="$LAUNCH_AGENTS/$label.plist"
mkdir -p "$LAUNCH_AGENTS"

if [[ -e "$plist_path" && $force -eq 0 ]]; then
  echo "error: $plist_path already exists. Pass --force to overwrite." >&2
  exit 3
fi

# Compose conversion args
conv_args=("--label" "$label" "--command" "$command_path")
[[ -n "$stdout_path" ]] && conv_args+=("--stdout" "$stdout_path")
[[ -n "$stderr_path" ]] && conv_args+=("--stderr" "$stderr_path")
[[ -n "$run_at_load" ]] && conv_args+=("$run_at_load")

if [[ -n "$schedule" ]]; then
  plist_xml="$(node "$SCRIPT_DIR/cron-to-plist.js" "$schedule" "${conv_args[@]}")"
else
  plist_xml="$(node "$SCRIPT_DIR/cron-to-plist.js" --interval "$interval" "${conv_args[@]}")"
fi

uid="$(id -u)"
bootstrap_cmd=(launchctl bootstrap "gui/$uid" "$plist_path")

if [[ $dry_run -eq 1 ]]; then
  echo "--- plist ($plist_path) ---"
  printf '%s\n' "$plist_xml"
  echo "--- bootstrap ---"
  printf '%s\n' "${bootstrap_cmd[*]}"
  exit 0
fi

# If already loaded, bootout first (force path)
if launchctl print "gui/$uid/$label" >/dev/null 2>&1; then
  launchctl bootout "gui/$uid/$label" || true
fi

printf '%s' "$plist_xml" > "$plist_path"
chmod 644 "$plist_path"

"${bootstrap_cmd[@]}"

# Verify
if launchctl print "gui/$uid/$label" >/dev/null 2>&1; then
  echo "installed: $label  ($plist_path)"
else
  echo "error: launchctl bootstrap appeared to succeed but the job is not visible" >&2
  exit 4
fi
