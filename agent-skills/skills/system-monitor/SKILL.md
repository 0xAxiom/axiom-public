# System Monitor

Comprehensive system health monitoring for AI agents. Monitors disk usage, memory, processes, network connectivity, and service health.

## When to Use

Use this skill when you need to:
- Check overall system health
- Monitor disk space and prevent outages
- Track memory usage and detect leaks
- Verify critical services are running
- Monitor network connectivity
- Get system performance metrics
- Set up automated health alerts

## Triggers

- "check system health"
- "monitor disk space" 
- "check memory usage"
- "system status"
- "health check"
- "performance monitor"
- "service status"
- "system metrics"

## Quick Start

```bash
# Basic health check
node scripts/monitor.js

# With custom thresholds
node scripts/monitor.js --disk-threshold 90 --memory-threshold 85

# JSON output for automation
node scripts/monitor.js --json

# Monitor specific services
node scripts/monitor.js --services "openclaw,postgresql,redis"

# Continuous monitoring (5 min intervals)
node scripts/monitor.js --watch --interval 300
```

## Configuration

Create `.system-monitor.json` in your skill directory:

```json
{
  "thresholds": {
    "disk": 85,
    "memory": 80,
    "cpu": 90
  },
  "services": ["openclaw", "postgresql", "redis", "nginx"],
  "networks": ["8.8.8.8", "1.1.1.1"],
  "ports": [22, 80, 443, 18800],
  "alerts": {
    "webhook": "https://hooks.slack.com/...",
    "email": "admin@example.com"
  }
}
```

## Outputs

The skill provides:
- Disk usage by mount point
- Memory usage (total, used, free, cached)
- CPU load averages
- Running process count
- Network connectivity status
- Service health checks
- System uptime
- Temperature monitoring (if available)
- Alert notifications when thresholds exceeded

## Examples

```bash
# Morning health check
node scripts/monitor.js --summary

# Pre-deployment check
node scripts/monitor.js --strict

# Export metrics for logging
node scripts/monitor.js --json > system-metrics-$(date +%Y%m%d).json

# Watch for issues
node scripts/monitor.js --watch --alert-webhook "https://hooks.slack.com/..."
```

Perfect for cron jobs, deployment pipelines, and proactive monitoring.