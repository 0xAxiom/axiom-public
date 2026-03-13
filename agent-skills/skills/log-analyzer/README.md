# Log Analyzer 📊

Parse agent logs for errors, performance insights, and anomalies. Automatically detects patterns, tracks metrics, and generates actionable reports.

## Features

- **Multi-format Support**: JSON logs, Apache/Nginx combined format, timestamped logs, plain text
- **Error Categorization**: Groups errors by type (network, auth, database, API, validation, memory, file)
- **Performance Tracking**: Extracts response times, calculates averages, percentiles
- **Time Pattern Analysis**: Hourly distribution, peak usage detection
- **Flexible Filtering**: By log level, date range, keywords
- **Real-time Monitoring**: Watch mode for live log analysis
- **Export Options**: JSON, human-readable reports

## Quick Start

```bash
# Analyze recent errors
./scripts/analyze-logs.js --file /var/log/app.log --level error

# Performance analysis with metrics
./scripts/analyze-logs.js --file api.log --metrics --output report.json

# Date range analysis
./scripts/analyze-logs.js --file app.log --from "2024-01-01" --to "2024-01-31"

# Analyze all logs in directory
./scripts/analyze-logs.js --dir /var/log/ --level warn
```

## Sample Output

```json
{
  "summary": {
    "totalLines": 15420,
    "errors": 23,
    "warnings": 156,
    "analyzed": "2024-03-13T19:36:00.000Z"
  },
  "errors": {
    "total": 23,
    "byCategory": {
      "network": 8,
      "auth": 5,
      "database": 3,
      "api": 7
    },
    "recent": [
      {
        "timestamp": "2024-03-13T18:45:22.123Z",
        "message": "Database connection timeout after 30s",
        "category": "database"
      }
    ]
  },
  "performance": {
    "responseTime": {
      "average": 245,
      "p95": 890,
      "p99": 1250,
      "samples": 1847
    }
  },
  "patterns": {
    "hourlyDistribution": {
      "9": 1240,
      "10": 1850,
      "11": 2100
    },
    "peakHour": "11"
  }
}
```

## Log Format Support

### JSON Logs
```json
{"timestamp": "2024-03-13T19:36:00Z", "level": "error", "message": "API timeout"}
```

### Apache/Nginx Combined
```
127.0.0.1 - - [13/Mar/2024:19:36:00 +0000] "GET /api/users" 200 1234
```

### Timestamped
```
2024-03-13 19:36:00.123 ERROR Database connection failed
```

### Simple Level
```
ERROR: Authentication failed for user 12345
```

## Performance Patterns

The analyzer recognizes these performance indicators:
- `123ms`, `1.5s` - Response times
- `response_time: 245` - Explicit metrics  
- `took 180ms` - Duration statements
- `duration: 340` - Timing logs

## Use Cases

- **Error Monitoring**: Track error rates and categorize issues
- **Performance Analysis**: Identify slow endpoints and bottlenecks  
- **Capacity Planning**: Understand usage patterns and peak hours
- **Debugging**: Find patterns in failures and anomalies
- **SLA Monitoring**: Track response time percentiles
- **Security Analysis**: Detect auth failures and suspicious activity

## Requirements

- Node.js 18+
- Read access to log files/directories
- Logs in supported formats

## Author

Built by [Axiom](https://x.com/AxiomBot) · Part of the [Axiom Agent Skills](https://github.com/0xAxiom/axiom-public) collection