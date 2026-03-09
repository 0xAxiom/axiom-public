# API Throttle Skill

Intelligent API rate limiting and request throttling for AI agents. Prevents 429 errors, manages request queues, and handles backoff strategies automatically.

## When to Use

- Hitting external API rate limits (Twitter, CoinGecko, GitHub, etc.)
- Need intelligent retry logic with exponential backoff
- Want to batch API calls efficiently
- Managing multiple API keys/endpoints
- Building resilient agent workflows

## Triggers

- "throttle api calls"
- "rate limit management" 
- "api queue"
- "prevent 429 errors"
- "backoff strategy"
- "api retry logic"
- "batch api requests"

## Core Scripts

### `scripts/throttle.js`
Main throttling engine with configurable rate limits.

```bash
# Basic usage
node scripts/throttle.js --provider twitter --endpoint tweets --rate 15/15min

# With custom backoff
node scripts/throttle.js --provider coingecko --endpoint price --rate 50/min --backoff exponential

# Batch mode
node scripts/throttle.js --provider github --endpoint repos --rate 5000/hour --batch 10
```

### `scripts/queue-manager.js`  
Persistent request queue with priority handling.

```bash
# Add to queue
node scripts/queue-manager.js add --provider twitter --endpoint tweets --data '{"text":"hello"}' --priority high

# Process queue
node scripts/queue-manager.js process --provider twitter

# Queue status
node scripts/queue-manager.js status
```

### `scripts/health-check.js`
Monitor API health and rate limit status.

```bash
# Check all providers
node scripts/health-check.js

# Specific provider
node scripts/health-check.js --provider twitter

# Export metrics
node scripts/health-check.js --export metrics.json
```

## Configuration

Create `config/providers.json`:

```json
{
  "twitter": {
    "baseUrl": "https://api.twitter.com/2",
    "rateLimits": {
      "tweets": {
        "requests": 15,
        "window": "15m"
      },
      "users": {
        "requests": 75,
        "window": "15m"
      }
    },
    "backoff": "exponential",
    "maxRetries": 3
  },
  "coingecko": {
    "baseUrl": "https://api.coingecko.com/api/v3",
    "rateLimits": {
      "price": {
        "requests": 30,
        "window": "1m"
      }
    },
    "backoff": "linear",
    "maxRetries": 5
  }
}
```

## Features

- **Intelligent Queuing**: Priority-based request queuing
- **Rate Limit Detection**: Auto-detect limits from response headers  
- **Multiple Backoff Strategies**: Exponential, linear, fixed delays
- **Batch Processing**: Group requests efficiently
- **Health Monitoring**: Track API status and performance
- **Persistent State**: Survive agent restarts
- **Zero Dependencies**: Pure Node.js implementation

## Integration Examples

```javascript
const throttle = require('./scripts/throttle.js');

// Simple throttling
await throttle.request('twitter', 'tweets', { text: 'Hello' });

// With custom priority
await throttle.request('coingecko', 'price', { ids: 'bitcoin' }, { priority: 'high' });

// Batch requests
const results = await throttle.batch('github', 'repos', requests);
```

## State Management

The skill maintains state in `state/`:
- `queues.json` - Pending requests
- `limits.json` - Current rate limit status  
- `metrics.json` - Performance stats

## Error Handling

- **429 Too Many Requests**: Auto-queue with backoff
- **503 Service Unavailable**: Exponential backoff retry
- **Network Errors**: Circuit breaker pattern
- **Invalid Responses**: Dead letter queue

## Best Practices

1. **Configure realistic limits** - Don't max out APIs
2. **Use priority queues** - Critical requests first
3. **Monitor health regularly** - Catch issues early
4. **Batch when possible** - Reduce total requests
5. **Handle failures gracefully** - Build resilient workflows

## Dependencies

None. Pure Node.js with built-in modules only.

## Author

**Axiom** 🔬 - Building resilient AI infrastructure

- Twitter: [@AxiomBot](https://x.com/AxiomBot)
- Base: [axiombotx.base.eth](https://www.base.org/name/axiombotx)
- GitHub: [github.com/0xAxiom](https://github.com/0xAxiom)