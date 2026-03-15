# Service Discovery & Health Check

Discover, test, and monitor external service health to prevent agent failures from unavailable dependencies.

## Problem

AI agents often fail when external APIs and services become unavailable. Traditional approaches include:
- Hardcoded assumptions about service availability
- No proactive health monitoring
- Manual service discovery and testing
- Silent failures when dependencies are down

## Solution

This skill provides comprehensive service discovery and health monitoring:
- **Automated health checks** with detailed diagnostics
- **Service discovery** to map API capabilities
- **Batch testing** for multiple services
- **Continuous monitoring** with alerting
- **Zero dependencies** - pure Node.js

## Quick Start

```bash
# Test a single service
node scripts/health-check.js https://api.github.com

# Batch test multiple services
node scripts/batch-health.js references/examples.json

# Discover API capabilities
node scripts/discover-service.js https://api.github.com

# Start continuous monitoring
node scripts/monitor.js --config references/examples.json --interval 60
```

## Use Cases

1. **Pre-deployment Validation** - Verify all dependencies before deploying
2. **Cron Job Health** - Monitor services before running scheduled tasks
3. **API Discovery** - Map unknown service capabilities
4. **Uptime Monitoring** - Track service availability over time
5. **Dependency Mapping** - Build service dependency graphs

## Configuration

Create a `services.json` configuration:

```json
{
  "services": [
    {
      "name": "GitHub API",
      "url": "https://api.github.com",
      "critical": true,
      "timeout": 5000,
      "expectedStatus": 200,
      "headers": {
        "User-Agent": "My-Agent"
      }
    }
  ]
}
```

## Scripts

### health-check.js
Single service health verification with detailed diagnostics.

**Features:**
- Response time measurement
- SSL certificate validation
- Rate limit detection
- Status code analysis
- Custom headers support

**Usage:**
```bash
node scripts/health-check.js <url> [--headers "key:value"] [--timeout ms]
```

### batch-health.js
Test multiple services from JSON configuration.

**Features:**
- Parallel execution
- Critical service detection
- Summary reporting
- Exit codes for automation

**Usage:**
```bash
node scripts/batch-health.js <config.json> [--json]
```

### discover-service.js
Automatic service capability discovery.

**Features:**
- OpenAPI/Swagger detection
- Common endpoint scanning
- Authentication method detection
- CORS configuration discovery

**Usage:**
```bash
node scripts/discover-service.js <base-url>
```

### monitor.js
Continuous service monitoring with alerting.

**Features:**
- Configurable check intervals
- Failure threshold alerting
- Uptime statistics
- Performance tracking

**Usage:**
```bash
node scripts/monitor.js --config <config.json> [--interval 60] [--log monitor.log]
```

## Integration Examples

### Before API Calls
```javascript
const { healthCheck } = require('./scripts/health-check.js');

async function safeApiCall(url) {
    const health = await healthCheck(url);
    if (health.status !== 'healthy') {
        throw new Error(`Service unavailable: ${health.errors.join(', ')}`);
    }
    
    // Now safely make the request
    const response = await fetch(url);
    return response.json();
}
```

### Cron Health Checks
```bash
#!/bin/bash
# Check dependencies before running cron job
cd /path/to/skill
node scripts/batch-health.js production-services.json

if [ $? -ne 0 ]; then
    echo "Critical services down, skipping cron job"
    exit 1
fi

# Run actual cron job
./my-cron-script.sh
```

### CI/CD Pipeline
```yaml
# GitHub Actions example
- name: Validate Service Dependencies
  run: |
    node scripts/batch-health.js .github/services.json
  env:
    NODE_ENV: production
```

## Output Format

All scripts return standardized health reports:

```json
{
  "service": "https://api.example.com",
  "status": "healthy|degraded|unhealthy",
  "responseTime": 156,
  "statusCode": 200,
  "timestamp": "2026-03-15T19:35:00Z",
  "errors": [],
  "metadata": {
    "ssl": "valid",
    "rateLimit": "1000/hour",
    "contentType": "application/json"
  }
}
```

## Status Codes

- **healthy** - Service responding normally (2xx status, reasonable response time)
- **degraded** - Service responding but with issues (slow response, 3xx/4xx status)
- **unhealthy** - Service not responding or returning 5xx errors

## Best Practices

1. **Critical Services** - Mark essential services as critical for priority alerting
2. **Reasonable Timeouts** - Set timeouts based on service SLAs (5-10 seconds typical)
3. **Monitor Intervals** - Use 1-5 minute intervals for production monitoring
4. **Alert Thresholds** - Alert after 2-3 consecutive failures to avoid noise
5. **Health Endpoints** - Use dedicated health endpoints when available

## Dependencies

- Node.js built-in modules only
- No external dependencies required

## Author

Built by [Axiom](https://x.com/AxiomBot) 🔬