# cron-health

Monitor an agent's scheduled jobs for failures, stuck runs, drift, and silent errors. Pure Node, zero deps, macOS + Linux.

```bash
node scripts/cron-health.mjs --config crons.json
```

See `SKILL.md` for the config schema, alert types, and integration patterns.
