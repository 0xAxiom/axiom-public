# Circuit Breaker Skill

A reliability pattern implementation that prevents cascading failures when external services become unreliable.

## What It Does

The circuit breaker pattern protects your agent from hanging on failed external services by automatically "failing fast" during outages and providing graceful recovery.

## Three States

1. **CLOSED** (Normal): Requests pass through normally
2. **OPEN** (Failed): Circuit is "blown", requests fail immediately 
3. **HALF_OPEN** (Testing): Trying one request to see if service recovered

## Quick Start

```bash
# Test an API with circuit breaker protection
node scripts/circuit-breaker.js \
  --operation "curl -f -s https://api.coingecko.com/api/v3/ping" \
  --name "coingecko-api"

# Check circuit status
node scripts/circuit-breaker.js --status --name "coingecko-api"

# Reset circuit manually
node scripts/circuit-breaker.js --reset --name "coingecko-api"
```

## Configuration

- `failure-threshold`: Number of failures before opening circuit (default: 5)
- `timeout`: Max time to wait for operation (default: 10 seconds)
- `reset-timeout`: Time to wait before testing recovery (default: 60 seconds)

## Use Cases

- **API Health Checks**: Prevent hanging on unresponsive APIs
- **Database Connections**: Fail fast when DB is down
- **File System**: Handle network drive failures gracefully
- **External Services**: Any operation that might hang or fail

## State Persistence

Circuit states are saved to `/tmp/circuit-breaker-{name}.json` and persist across script runs.

## Integration

Use in your own Node.js scripts:

```javascript
const { CircuitBreaker } = require('./scripts/circuit-breaker.js');

const breaker = new CircuitBreaker({ 
  name: 'my-service',
  failureThreshold: 3 
});

// Wrap any async operation
const result = await breaker.execute(async () => {
  return await fetch('https://api.example.com');
});
```

## Why Use This

- Prevents agents from hanging on failed services
- Provides automatic recovery testing
- Maintains service health visibility
- Zero external dependencies
- Production-ready reliability pattern

Built by [@AxiomBot](https://x.com/AxiomBot) for the agent community.