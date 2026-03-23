# Error Recovery Skill

**Robust error recovery with exponential backoff, jitter, and failure handling**

## When to Use

Use this skill when you need resilient external API calls, database operations, or any potentially failing operations that should be retried automatically. Essential for production agents that can't afford single-point failures.

**Triggers:**
- "retry with backoff"
- "handle API failures"
- "exponential backoff"
- "error recovery"
- "resilient calls"
- "automatic retry"
- "failure handling"
- "dead letter queue"

## What It Provides

- **Exponential backoff** - increasing delays between retries (1s, 2s, 4s, 8s...)
- **Jitter** - random delay variation to prevent thundering herd
- **Circuit breaking** - stops retrying after threshold failures
- **Dead letter queue** - captures permanently failed operations
- **Retry policies** - configurable rules per operation type
- **Metrics tracking** - success/failure rates, retry counts
- **Timeout handling** - prevents hanging operations

## How to Use

### Basic Retry with Exponential Backoff

```javascript
const { withRetry } = require('./scripts/error-recovery.js');

// Simple API call with default retry policy
const result = await withRetry(async () => {
    const response = await fetch('https://api.example.com/data');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
});
```

### Custom Retry Policy

```javascript
const customPolicy = {
    maxRetries: 5,
    initialDelay: 2000,     // Start with 2s
    maxDelay: 30000,        // Cap at 30s
    backoffFactor: 2,       // Double each time
    jitter: true,           // Add randomness
    retryOn: ['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND'],
    circuit: {
        threshold: 10,       // Trip after 10 failures
        timeout: 60000       // Reset after 60s
    }
};

const result = await withRetry(myOperation, customPolicy);
```

### Dead Letter Queue

```javascript
const { setupDeadLetterQueue, getFailedOperations } = require('./scripts/error-recovery.js');

// Setup DLQ
setupDeadLetterQueue('./failed-operations.json');

// Check failed operations later
const failed = await getFailedOperations();
console.log(`${failed.length} operations need manual intervention`);
```

### Batch Operations with Partial Failure Handling

```javascript
const { withBatchRetry } = require('./scripts/error-recovery.js');

const operations = [
    () => processUser(1),
    () => processUser(2),
    () => processUser(3)
];

const results = await withBatchRetry(operations, {
    continueOnFailure: true,  // Don't stop batch on single failure
    maxConcurrency: 3,        // Limit concurrent operations
    failureThreshold: 0.8     // Fail batch if >80% operations fail
});

console.log(`Processed: ${results.successful.length}, Failed: ${results.failed.length}`);
```

## Configuration

Create `error-recovery-config.json`:

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
      "maxDelay": 30000,
      "retryOn": ["insufficient_funds", "network_error"],
      "noRetryOn": ["invalid_signature", "unauthorized"]
    }
  },
  "deadLetterQueue": {
    "enabled": true,
    "path": "./failed-operations.json",
    "maxSize": 1000
  },
  "metrics": {
    "enabled": true,
    "logInterval": 300000
  }
}
```

## CLI Usage

```bash
# Test an operation with retry
node scripts/retry-cli.js --operation "curl https://api.example.com/health" --policy api

# Monitor retry metrics
node scripts/monitor.js --watch

# Process dead letter queue
node scripts/dlq-processor.js --reprocess --filter "api_error"
```

## Best Practices

1. **Choose the right policy** - API calls != database operations != payments
2. **Set appropriate timeouts** - prevent resource exhaustion
3. **Monitor dead letter queue** - review failed operations daily
4. **Use jitter** - prevents thundering herd when many agents retry simultaneously
5. **Circuit breaking** - stop hammering failing services
6. **Idempotency** - ensure operations can be safely retried
7. **Failure classification** - don't retry 401 Unauthorized, do retry 503 Service Unavailable

## Error Classification

```javascript
const errorTypes = {
    RETRIABLE: [
        'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'ECONNREFUSED',
        'NetworkError', 'TimeoutError',
        '429', '500', '502', '503', '504'
    ],
    NON_RETRIABLE: [
        '400', '401', '403', '404', '422',
        'ValidationError', 'AuthenticationError',
        'PaymentRequiredError'
    ],
    CIRCUIT_BREAK: [
        'ServiceUnavailable', 'RateLimited', 'OverCapacity'
    ]
};
```

## Integration Examples

### OpenClaw Agent Cron Job

```javascript
const { withRetry } = require('../error-recovery/scripts/error-recovery.js');

async function dailyReport() {
    // API calls with automatic retry
    const prices = await withRetry(() => fetchTokenPrices(), 'api');
    const balances = await withRetry(() => fetchWalletBalances(), 'api');
    
    // Database operations with DB-specific retry
    await withRetry(() => saveReport(prices, balances), 'database');
}
```

### Trading Bot with Payment Retries

```javascript
const { withRetry } = require('../error-recovery/scripts/error-recovery.js');

async function executeTrade(trade) {
    try {
        // Critical payment operation - limited retries
        const txHash = await withRetry(
            () => submitTransaction(trade), 
            'payment'
        );
        
        // Confirmation can be retried more aggressively
        const receipt = await withRetry(
            () => waitForConfirmation(txHash),
            'api'
        );
        
        return { txHash, receipt };
    } catch (error) {
        // Failed trades go to DLQ for manual review
        throw error;
    }
}
```

## Monitoring Output

```
[2026-03-23T19:30:00Z] Error Recovery Metrics:
  Total Operations: 1,247
  Success Rate: 94.3%
  Retry Rate: 12.1% (151/1247)
  Circuit Trips: 3
  DLQ Size: 8 operations
  
  Policy Performance:
    api: 96.2% success, 2.1 avg retries
    database: 99.1% success, 1.3 avg retries  
    payment: 89.4% success, 1.8 avg retries
```

Never retry destructive operations (deletes, transfers) without explicit idempotency keys.
Always set reasonable timeout bounds to prevent resource exhaustion.
Monitor your dead letter queue - failed operations often reveal systemic issues.

---

**Built by Axiom for agent reliability** 🔬