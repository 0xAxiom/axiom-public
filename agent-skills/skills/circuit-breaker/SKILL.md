# Circuit Breaker Skill

Implements the circuit breaker pattern to prevent cascading failures when external services become unreliable. Automatically fails fast during outages and provides graceful recovery.

## When to Use

- Making API calls to external services
- Database connections
- File system operations
- Network requests that might fail
- Any operation where you want to "fail fast" instead of hanging

Use when you see phrases like:
- "API keeps timing out"
- "service is unreliable"
- "prevent cascading failures"
- "fail fast"
- "graceful degradation"
- "service mesh"
- "reliability patterns"

## How It Works

Circuit breaker has three states:
- **CLOSED**: Normal operation, requests pass through
- **OPEN**: Circuit is "blown", requests fail immediately
- **HALF_OPEN**: Testing if service has recovered

## Usage

```bash
# Basic usage with retry logic
node scripts/circuit-breaker.js --operation "curl -s https://api.example.com/data" --name "example-api"

# With custom thresholds
node scripts/circuit-breaker.js \
  --operation "your-command-here" \
  --name "service-name" \
  --failure-threshold 5 \
  --timeout 30000 \
  --reset-timeout 60000

# Check circuit status
node scripts/circuit-breaker.js --status --name "example-api"

# Reset circuit manually
node scripts/circuit-breaker.js --reset --name "example-api"
```

## Parameters

- `--operation`: Command to execute
- `--name`: Circuit identifier (required)
- `--failure-threshold`: Failures before opening circuit (default: 5)
- `--timeout`: Operation timeout in ms (default: 10000)
- `--reset-timeout`: Time before trying HALF_OPEN in ms (default: 60000)
- `--status`: Show circuit status
- `--reset`: Manually reset circuit to CLOSED

## Examples

### API Health Check
```bash
# Check if API is responding
node scripts/circuit-breaker.js \
  --operation "curl -f -s --max-time 5 https://api.coingecko.com/api/v3/ping" \
  --name "coingecko-api" \
  --failure-threshold 3 \
  --timeout 5000
```

### Database Connection
```bash
# Test database connectivity
node scripts/circuit-breaker.js \
  --operation "pg_isready -h localhost -p 5432" \
  --name "postgres-db" \
  --failure-threshold 2 \
  --reset-timeout 30000
```

### File System Operation
```bash
# Check if network drive is available
node scripts/circuit-breaker.js \
  --operation "ls /mnt/network-drive" \
  --name "network-storage" \
  --failure-threshold 1
```

## Integration with Other Scripts

```javascript
// In your Node.js scripts
const { CircuitBreaker } = require('./scripts/circuit-breaker.js');

const apiBreaker = new CircuitBreaker({
  name: 'my-api',
  failureThreshold: 5,
  timeout: 10000,
  resetTimeout: 60000
});

// Use in async functions
async function callAPI() {
  return await apiBreaker.execute(async () => {
    const response = await fetch('https://api.example.com/data');
    if (!response.ok) throw new Error('API failed');
    return response.json();
  });
}
```

## State Persistence

Circuit states are persisted to `/tmp/circuit-breaker-{name}.json` to maintain state across script runs.

## Outputs

- **Success**: Returns command output with exit code 0
- **Circuit Open**: Returns error with exit code 1 and "Circuit breaker is OPEN"
- **Operation Failed**: Returns error with exit code corresponding to underlying failure

## Triggers

Use this skill when you need:
- Reliable external API calls
- Graceful service degradation
- Fail-fast behavior
- Prevention of cascade failures
- Service health monitoring
- Automatic recovery testing