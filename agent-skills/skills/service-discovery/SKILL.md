# Service Discovery & Health Check Skill

Discover, test, and monitor external service health before depending on them. Prevents agent failures from unavailable APIs and services.

## When to Use

Use this skill when:
- Agent needs to verify external APIs are available
- Testing service endpoints before making requests
- Monitoring service health over time
- Discovering service capabilities and rate limits
- Building dependency maps for critical services
- Setting up alerts for service degradation
- Validating service responses match expected format

## Quick Start

```bash
# Basic health check
node scripts/health-check.js https://api.github.com

# Test with authentication
node scripts/health-check.js https://api.coinbase.com/v2/exchange-rates --headers "Authorization: Bearer token"

# Batch testing
node scripts/batch-health.js services.json

# Service discovery
node scripts/discover-service.js https://api.example.com

# Monitor continuously
node scripts/monitor.js --config monitor.json --interval 300
```

## Core Scripts

### health-check.js
Single endpoint health verification with detailed diagnostics:
- Response time measurement
- Status code validation
- Response format checking
- SSL certificate validation
- Rate limit detection
- Error categorization

### batch-health.js
Test multiple services from JSON configuration:
- Parallel execution
- Failure aggregation
- Detailed reporting
- Retry logic
- Timeout handling

### discover-service.js
Automatic service capability discovery:
- Endpoint enumeration
- OpenAPI/Swagger detection
- Rate limit discovery
- Authentication method detection
- Available endpoints mapping

### monitor.js
Continuous service monitoring:
- Configurable intervals
- Alerting on failures
- Performance trend tracking
- Uptime statistics
- Health score calculation

## Configuration

Create `services.json` for batch operations:

```json
{
  "services": [
    {
      "name": "GitHub API",
      "url": "https://api.github.com",
      "critical": true,
      "timeout": 5000,
      "expectedStatus": 200
    },
    {
      "name": "CoinGecko",
      "url": "https://api.coingecko.com/api/v3/ping",
      "headers": {
        "User-Agent": "Agent-Health-Check"
      }
    }
  ]
}
```

## Integration Examples

### Before Making API Calls
```javascript
// Check service health first
const health = await checkHealth('https://api.service.com');
if (health.status !== 'healthy') {
    throw new Error(`Service unavailable: ${health.error}`);
}

// Now safely make requests
const data = await fetch('https://api.service.com/data');
```

### Cron Health Monitoring
```bash
# Add to crontab for continuous monitoring
*/5 * * * * cd /path/to/skill && node scripts/monitor.js --config critical.json
```

### Pre-deployment Checks
```bash
# Verify all dependencies before deployment
node scripts/batch-health.js production-services.json
if [ $? -ne 0 ]; then
    echo "Service dependencies failed, aborting deployment"
    exit 1
fi
```

## Response Format

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

## Triggers

- "check service health"
- "test API availability"  
- "verify external dependencies"
- "monitor service uptime"
- "discover API endpoints"
- "validate service response"
- "batch test services"
- "service discovery"

## Dependencies

- Node.js (built-in modules only)
- No external dependencies for core functionality

## Files

- `scripts/health-check.js` - Single service health verification
- `scripts/batch-health.js` - Multiple service testing
- `scripts/discover-service.js` - Service capability discovery
- `scripts/monitor.js` - Continuous monitoring
- `references/examples.json` - Example service configurations
- `README.md` - Detailed documentation

Built by [Axiom](https://x.com/AxiomBot) 🔬