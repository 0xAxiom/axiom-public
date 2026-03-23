# Error Recovery

**Robust error recovery with exponential backoff, jitter, and failure handling**

## Overview

The Error Recovery skill provides production-ready retry logic for AI agents that need to handle external API failures, network issues, and temporary service outages gracefully. Instead of failing on the first error, operations are automatically retried with intelligent backoff strategies.

## Key Features

- **Exponential Backoff**: Automatically increases delays between retries (1s → 2s → 4s → 8s...)
- **Jitter**: Adds randomness to prevent thundering herd when multiple agents retry simultaneously
- **Circuit Breaker**: Stops retrying failing services to prevent resource exhaustion
- **Dead Letter Queue**: Captures permanently failed operations for manual review
- **Configurable Policies**: Different retry strategies for APIs, databases, payments, etc.
- **Batch Processing**: Handle multiple operations with partial failure tolerance
- **Comprehensive Monitoring**: Success rates, retry statistics, circuit breaker status

## Installation

```bash
cp -r error-recovery ~/.clawdbot/skills/
```

## Quick Start

### Basic Retry

```javascript
const { withRetry } = require('./scripts/error-recovery.js');

// API call that will retry on network failures
const data = await withRetry(async () => {
    const response = await fetch('https://api.example.com/data');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
});
```

### Custom Policy

```javascript
const customPolicy = {
    maxRetries: 5,
    initialDelay: 2000,     // Start with 2 seconds
    maxDelay: 30000,        // Cap at 30 seconds
    backoffFactor: 2,       // Double each time
    jitter: true,           // Add randomness
    retryOn: ['ECONNRESET', 'ETIMEDOUT', '503', '502'],
    noRetryOn: ['401', '404'] // Never retry these
};

const result = await withRetry(myOperation, customPolicy);
```

### Batch Operations

```javascript
const { withBatchRetry } = require('./scripts/error-recovery.js');

const operations = [
    () => processUser(1),
    () => processUser(2),
    () => processUser(3)
];

const results = await withBatchRetry(operations, {
    continueOnFailure: true,  // Don't stop on single failure
    maxConcurrency: 3,        // Limit concurrent operations
    failureThreshold: 0.8     // Fail if >80% operations fail
});
```

## Configuration

Create `error-recovery-config.json` in your skill directory:

```json
{
  "policies": {
    "api": {
      "maxRetries": 3,
      "initialDelay": 1000,
      "maxDelay": 15000,
      "retryOn": ["ECONNRESET", "ETIMEDOUT", "429", "500", "502", "503", "504"]
    },
    "database": {
      "maxRetries": 5,
      "initialDelay": 2000,
      "maxDelay": 60000,
      "retryOn": ["ECONNRESET", "ER_LOCK_WAIT_TIMEOUT"]
    },
    "payment": {
      "maxRetries": 2,
      "initialDelay": 5000,
      "noRetryOn": ["invalid_signature", "unauthorized"]
    }
  }
}
```

## Command Line Tools

### Test Operations

```bash
# Test a shell command with retry
node scripts/retry-cli.js --operation "curl -f https://api.example.com/health"

# Test an HTTP endpoint
node scripts/retry-cli.js --test-url https://httpstat.us/503 --policy api

# Show current metrics
node scripts/retry-cli.js --metrics
```

### Manage Dead Letter Queue

```bash
# List failed operations
node scripts/dlq-processor.js --list

# Show statistics
node scripts/dlq-processor.js --stats

# Cleanup old entries
node scripts/dlq-processor.js --cleanup --older-than 72

# Export for analysis
node scripts/dlq-processor.js --export failed-ops.json
```

## Use Cases

### Trading Bot

```javascript
// Critical payment operations - limited retries
const txHash = await withRetry(
    () => submitTransaction(trade), 
    'payment'
);

// Confirmation can be retried aggressively
const receipt = await withRetry(
    () => waitForConfirmation(txHash),
    'api'
);
```

### Data Pipeline

```javascript
// Database operations with connection retry
await withRetry(() => saveResults(data), 'database');

// API calls with exponential backoff
const enrichedData = await withRetry(() => enrichWithAPI(data), 'api');
```

### Batch Processing

```javascript
// Process 1000 users with partial failure tolerance
const userIds = Array.from({length: 1000}, (_, i) => i + 1);
const operations = userIds.map(id => () => processUser(id));

const results = await withBatchRetry(operations, {
    continueOnFailure: true,
    maxConcurrency: 10,
    failureThreshold: 0.95  // Accept up to 5% failures
});
```

## Error Classification

The skill automatically classifies errors into three categories:

**Retriable**: Network errors, timeouts, server errors (500, 502, 503, 504)
**Non-Retriable**: Client errors (400, 401, 403, 404), validation errors
**Circuit Breaking**: Service unavailable, rate limited, over capacity

## Monitoring

The skill provides detailed metrics:

```
Total Operations: 1,247
Success Rate: 94.3%
Retry Rate: 12.1% (151/1247)
Circuit Trips: 3
DLQ Size: 8 operations
```

## Best Practices

1. **Choose appropriate policies**: API calls ≠ database operations ≠ payments
2. **Set reasonable timeouts**: Prevent resource exhaustion
3. **Monitor the dead letter queue**: Review failed operations daily
4. **Use jitter**: Prevents thundering herd problems
5. **Ensure idempotency**: Operations must be safely retriable
6. **Don't retry destructive operations**: Without explicit idempotency keys

## Dependencies

- Node.js 14+ (no external dependencies)
- Built-in modules only: `fs`, `path`

## Author

**Axiom** 🔬  
[@AxiomBot](https://x.com/AxiomBot) · [github.com/0xAxiom](https://github.com/0xAxiom/axiom-public)