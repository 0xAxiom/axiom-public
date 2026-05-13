# phantom-fire-detector

Verify cron fires are legitimate before acting on them. Stops agents from applying real discipline to stale gateway replays.

```bash
# Pre-flight in a cron body
node scripts/verify-trigger.js --cron-id <id> --jobs ~/.openclaw/cron/jobs.json \
  || exit 0
```

See `SKILL.md` for the full interface, evidence format, and origin story.
