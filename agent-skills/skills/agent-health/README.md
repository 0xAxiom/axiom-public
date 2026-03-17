# Agent Health Monitoring 🩺

Comprehensive health monitoring for AI agents with automatic recovery capabilities.

## Overview

Monitor key performance metrics and detect issues before they impact agent operation:

- **Performance Tracking**: API success rates, response times, error patterns
- **Resource Monitoring**: Memory usage, CPU load, system metrics  
- **Health Scoring**: Weighted health score with status indicators
- **Auto-Recovery**: Automatic recovery actions for common failures
- **Alerting**: Configurable alerts via webhook, file, or console

## Quick Start

```bash
# Check current health status
node scripts/health-check.js

# Detailed report with recommendations  
node scripts/health-check.js --detailed

# Start continuous monitoring (5-minute intervals)
node scripts/monitor.js --interval 300 --alert-threshold 0.8

# Run diagnostics and get recovery suggestions
node scripts/recovery.js diagnose

# Execute specific recovery actions
node scripts/recovery.js clear-cache
node scripts/recovery.js restart-request
node scripts/recovery.js cleanup
```

## Configuration

Create `config.json` to customize monitoring:

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
    "webhook_url": "https://hooks.slack.com/...",
    "file_alert": true
  }
}
```

## Health Score Calculation

Weighted scoring system (0-100):

- **API Success Rate** (30%): Percentage of successful API calls
- **Error Rate** (25%): Inverse of error frequency  
- **Memory Usage** (20%): Memory efficiency vs threshold
- **Response Time** (15%): Average API response times
- **Uptime** (10%): System uptime stability

Status levels:
- 90-100: EXCELLENT 💚
- 80-89: GOOD 🟢  
- 70-79: FAIR 🟡
- 60-69: POOR 🟠
- <60: CRITICAL 🔴

## Data Storage

All data stored in `~/.openclaw/health/`:

- `metrics.json` - Historical performance data
- `alerts.json` - Alert history (last 100)
- `restart_requested` - Recovery restart signals
- `current_alert.json` - Active alert state

## Integration

Works seamlessly with OpenClaw's monitoring infrastructure:

- Automatic metric collection during agent operation
- Recovery signals that OpenClaw can detect and act on
- Health data accessible to other monitoring tools
- Graceful cleanup with configurable retention

## Example Output

```
🔍 Agent Health Report
=====================
Status: GOOD (87/100)
Memory: 234MB (0.23%)
Load: 0.45
Uptime: 12.4h

📊 Breakdown:
  API Success Rate: 92/100 (weight: 0.3)
  Error Rate: 85/100 (weight: 0.25)
  Memory Usage: 88/100 (weight: 0.2)
  Response Time: 79/100 (weight: 0.15)
  Uptime: 95/100 (weight: 0.1)

📈 Recent Activity (24h):
  API Calls: 847
  Errors: 23
```

## Files

- `SKILL.md` - OpenClaw integration instructions
- `scripts/health-check.js` - Core health monitoring
- `scripts/monitor.js` - Continuous monitoring daemon  
- `scripts/recovery.js` - Diagnostics and recovery actions
- `config.json` - Configuration (create your own)

## Author

**Axiom** - [@AxiomBot](https://x.com/AxiomBot) · [github.com/0xAxiom](https://github.com/0xAxiom/axiom-public)