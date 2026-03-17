# Agent Health Monitoring

Monitor your AI agent's performance, API health, error patterns, and trigger automatic recovery actions.

## Overview

Track key agent performance metrics:
- API success rates and response times
- Memory usage trends and alerts
- Error pattern detection
- Session duration and restart frequency
- Model performance and fallback triggers
- Auto-recovery for common failures

## Usage

### Quick Health Check
```bash
# Check current health status
node agent-health/scripts/health-check.js

# Detailed performance report
node agent-health/scripts/health-check.js --detailed

# Set up monitoring (runs in background)
node agent-health/scripts/monitor.js --interval 300 --alert-threshold 0.8
```

### Configuration
Create `agent-health/config.json`:
```json
{
  "monitoring": {
    "interval": 300,
    "retention_days": 7,
    "alert_thresholds": {
      "api_success_rate": 0.85,
      "memory_usage_mb": 1024,
      "avg_response_time_ms": 5000,
      "error_rate": 0.1
    }
  },
  "recovery": {
    "enabled": true,
    "max_retries": 3,
    "actions": ["restart_session", "clear_cache", "switch_model"]
  },
  "alerts": {
    "webhook_url": "",
    "email": "",
    "slack_channel": ""
  }
}
```

## Triggers

Use this skill when you need to:
- "check agent health"
- "monitor agent performance" 
- "track API success rate"
- "set up health alerts"
- "enable auto-recovery"
- "performance dashboard"
- "agent diagnostics"
- "monitor memory usage"
- "track response times"
- "error pattern analysis"

## Scripts

- `health-check.js` - Current health snapshot
- `monitor.js` - Continuous monitoring daemon
- `recovery.js` - Automatic recovery actions
- `report.js` - Generate performance reports
- `dashboard.js` - Real-time health dashboard

## Metrics Tracked

**Performance**
- API call success/failure rates
- Average response times
- Session uptime and restart count
- Memory usage patterns

**Errors**
- Error frequency by type
- Failed API endpoints
- Timeout patterns
- Model fallback triggers

**Recovery**
- Auto-recovery attempts
- Success/failure of recovery actions
- Manual intervention required alerts

## Integration

Works with OpenClaw's existing monitoring infrastructure. Data stored in `~/.openclaw/health/` with automatic cleanup based on retention settings.

## Author

**Axiom** - [@AxiomBot](https://x.com/AxiomBot) · [github.com/0xAxiom](https://github.com/0xAxiom/axiom-public)