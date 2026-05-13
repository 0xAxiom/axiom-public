# launchd Cron Installer

Convert cron-style schedules into macOS launchd jobs and install them under `~/Library/LaunchAgents/`. Use when an agent running inside a sandboxed harness needs scheduled jobs but `crontab -e` silently hangs or fails.

## The Problem

On modern macOS (Ventura+ with full-disk-protection / sandboxed shells), `crontab` writes from an automated agent often:

- Hang indefinitely without an error
- Succeed in the buffer but never reach `/var/at/tabs/`
- Fail without TCC permission, with no actionable prompt
- Get reverted on reboot

`launchd` via `~/Library/LaunchAgents/*.plist` + `launchctl bootstrap gui/<uid>` works from the same sandbox and survives reboots. This skill packages that workflow.

## Usage

```bash
# Install a job that runs daily at 9:15 AM
./scripts/install.sh \
  --label com.myagent.daily-report \
  --schedule "15 9 * * *" \
  --command "/Users/me/scripts/daily-report.sh" \
  --stdout /Users/me/logs/daily-report.log

# Install a job that runs every 30 minutes
./scripts/install.sh \
  --label com.myagent.heartbeat \
  --interval 1800 \
  --command "/Users/me/scripts/heartbeat.sh"

# List installed jobs created by this skill
./scripts/list.sh

# Remove a job
./scripts/uninstall.sh --label com.myagent.daily-report

# Convert a cron line to a plist without installing (dry-run)
./scripts/cron-to-plist.js "15 9 * * *" --label com.myagent.test --command /tmp/foo.sh
```

## Triggers

Use this skill when:

- "crontab -e hangs"
- "cron job not firing on macOS"
- "schedule a job on Mac"
- "launchd plist"
- "StartCalendarInterval"
- A user pastes a cron line and asks how to install it on a Mac
- An agent needs a scheduled task that survives reboots

## How It Works

The installer:

1. Parses the cron spec (`m h dom mon dow`) into one or more `StartCalendarInterval` dict entries.
2. Generates a minimal `.plist` at `~/Library/LaunchAgents/<label>.plist`.
3. Runs `launchctl bootstrap gui/$(id -u) <plist>` to load the job.
4. Verifies with `launchctl print gui/$(id -u)/<label>` and exits non-zero if the job isn't visible.

Unsupported cron features (step values like `*/5`, ranges, lists with hyphens) are expanded into multiple `StartCalendarInterval` entries, or rejected with a clear message if the expansion would exceed 100 entries (use `--interval <seconds>` for those cases).

## Why launchd over cron on macOS

| Feature | cron | launchd |
|---|---|---|
| Survives reboot | Sometimes | Always |
| Sandbox-friendly install | No | Yes |
| Per-job stdout/stderr paths | Manual | Built-in |
| Run-at-load | No | Yes |
| Visible to TCC | No | Yes |
| Easy to uninstall | Edit-in-place | Single file |

## Files

- `scripts/install.sh` — main entry, validates args, calls `cron-to-plist.js`, bootstraps
- `scripts/uninstall.sh` — `launchctl bootout` + remove plist
- `scripts/list.sh` — `launchctl print-disabled` + filtered `ls`
- `scripts/cron-to-plist.js` — pure converter; emit plist XML to stdout

## Safety

- Refuses to install a label that already exists unless `--force` is passed.
- Refuses commands that contain unquoted shell metacharacters; wrap multi-step work in a shell script and point `--command` at that script.
- `--dry-run` prints the generated plist and the bootstrap command without executing.
