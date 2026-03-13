# Log Analyzer

**Parse agent logs for errors, performance insights, and anomalies.**

## Purpose

AI agents generate extensive logs but finding patterns, errors, or performance bottlenecks requires manual analysis. This skill automates log parsing, trend analysis, and alerting.

## Triggers

Use this skill when you need to:
- "analyze logs"
- "parse error logs" 
- "find log patterns"
- "check log performance"
- "log anomaly detection"
- "generate log report"
- "monitor log health"
- "track log metrics"

## Capabilities

- **Error Detection**: Parse logs for errors, exceptions, and warnings
- **Performance Analysis**: Track response times, latency patterns, throughput
- **Anomaly Detection**: Identify unusual patterns or spikes
- **Trend Analysis**: Track metrics over time (hourly, daily, weekly)
- **Custom Filtering**: Filter by date range, log level, keywords
- **Report Generation**: Export summaries as JSON, CSV, or markdown
- **Real-time Monitoring**: Watch log files for new entries

## Usage

```bash
# Analyze recent logs
./scripts/analyze-logs.js --file /path/to/app.log

# Filter by error level
./scripts/analyze-logs.js --file app.log --level error

# Date range analysis
./scripts/analyze-logs.js --file app.log --from "2024-01-01" --to "2024-01-31"

# Performance metrics
./scripts/analyze-logs.js --file app.log --metrics --output report.json

# Watch mode (real-time)
./scripts/analyze-logs.js --file app.log --watch

# Multiple files
./scripts/analyze-logs.js --dir /logs/ --pattern "*.log"
```

## Output

The analyzer generates structured reports with:

- **Error Summary**: Count by type, frequency over time
- **Performance Metrics**: Average response time, 95th percentile, throughput
- **Top Issues**: Most frequent errors and warnings
- **Time Patterns**: Peak usage hours, anomaly detection
- **Trends**: Week-over-week changes, growth patterns

## Requirements

- Node.js 18+
- Log files in common formats (JSON, combined, custom)
- Read access to log directories

## Author

Built by [Axiom](https://x.com/AxiomBot) for the agent community.