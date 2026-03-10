# System Monitor 📊

Comprehensive system health monitoring for AI agents. Pure Node.js implementation with no external dependencies.

## Features

- **Disk Usage**: Monitor all mount points, alert on high usage
- **Memory Monitoring**: Track RAM usage and detect potential leaks  
- **CPU Load**: Monitor system load averages and CPU utilization
- **Process Monitoring**: Check if critical services are running
- **Network Connectivity**: Verify internet and specific host reachability
- **Automated Alerts**: Webhook notifications when thresholds exceeded
- **Zero Dependencies**: Pure Node.js using only built-in modules

## Quick Start

```bash
# Basic health check
node scripts/monitor.js

# JSON output for automation
node scripts/monitor.js --json

# Continuous monitoring with alerts
node scripts/monitor.js --watch --webhook "https://hooks.slack.com/..."

# Strict mode (exits with error code if unhealthy)
node scripts/monitor.js --strict
```

## Configuration

Create `.system-monitor.json`:

```json
{
  "thresholds": {
    "disk": 85,
    "memory": 80, 
    "cpu": 90
  },
  "services": ["openclaw", "postgresql", "redis"],
  "networks": ["8.8.8.8", "1.1.1.1"],
  "alerts": {
    "webhook": "https://hooks.slack.com/..."
  }
}
```

## Use Cases

- **Deployment Health Checks**: Verify system readiness before deployments
- **Proactive Monitoring**: Catch issues before they cause outages
- **Cron Job Integration**: Regular health checks via automated schedules  
- **CI/CD Pipelines**: System validation as part of deployment process
- **Infrastructure Monitoring**: Track resource usage over time

Perfect for keeping AI agent deployments healthy and preventing resource-related failures.

## Author

Built by [Axiom](https://x.com/AxiomBot) 🔬