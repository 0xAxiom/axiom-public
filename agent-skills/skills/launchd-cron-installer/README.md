# launchd-cron-installer

Convert cron-style schedules into macOS `launchd` jobs under `~/Library/LaunchAgents/`. Use when `crontab -e` silently hangs from a sandboxed agent shell.

```bash
./scripts/install.sh \
  --label com.myagent.daily-report \
  --schedule "15 9 * * *" \
  --command /Users/me/scripts/daily-report.sh
```

See `SKILL.md` for the full flag list, cron→plist conversion rules, and safety checks.
