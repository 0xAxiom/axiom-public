# API Throttle Skill 🚦

Intelligent API rate limiting and request throttling for AI agents. Prevents 429 errors, manages request queues, and handles backoff strategies automatically.

## Problem Solved

AI agents frequently hit API rate limits when making external requests to Twitter, CoinGecko, GitHub, and other services. This leads to:
- 429 "Too Many Requests" errors
- Lost requests and failed operations  
- Manual retry logic scattered across codebases
- Inconsistent backoff strategies
- Poor user experience from failed operations

This skill provides a centralized, intelligent throttling system that handles all of this automatically.

## Features

- ⚡ **Intelligent Queuing**: Priority-based request queuing with automatic processing
- 🔄 **Rate Limit Detection**: Auto-detect limits from response headers and config
- 📈 **Multiple Backoff Strategies**: Exponential, linear, and fixed delay patterns
- 📦 **Batch Processing**: Group related requests for efficiency
- 📊 **Health Monitoring**: Real-time API status and performance tracking
- 💾 **Persistent State**: Survive agent restarts without losing queued requests
- 🚀 **Zero Dependencies**: Pure Node.js implementation

## Quick Start

```bash
# Basic throttled request
node scripts/throttle.js --provider twitter --endpoint tweets --data '{"text":"Hello world"}'

# High priority request
node scripts/throttle.js --provider coingecko --endpoint price --data '{"ids":"bitcoin"}' --priority high

# Add to queue for later processing
node scripts/queue-manager.js add --provider twitter --endpoint tweets --data '{"text":"Queued tweet"}' --priority high

# Process all queued requests
node scripts/queue-manager.js process

# Monitor health
node scripts/health-check.js --watch
```

## Configuration

The skill auto-generates a config file at `config/providers.json`:

```json
{
  "twitter": {
    "rateLimits": {
      "tweets": { "requests": 15, "window": "15m" },
      "users": { "requests": 75, "window": "15m" }
    },
    "backoff": "exponential",
    "maxRetries": 3
  },
  "coingecko": {
    "rateLimits": {
      "price": { "requests": 30, "window": "1m" }
    },
    "backoff": "linear", 
    "maxRetries": 5
  }
}
```

## Scripts

### throttle.js
Main throttling engine with intelligent rate limiting.

**Usage:**
```bash
node scripts/throttle.js --provider <provider> --endpoint <endpoint> [options]
```

**Options:**
- `--data <json>` - Request payload
- `--priority <high|normal|low>` - Request priority
- `--immediate` - Skip rate limit check
- `--status` - Show queue status

### queue-manager.js  
Persistent request queue with priority handling and auto-processing.

**Usage:**
```bash
# Add to queue
node scripts/queue-manager.js add --provider twitter --endpoint tweets --data '{"text":"hello"}'

# Process queues
node scripts/queue-manager.js process [--provider <name>]

# Queue status
node scripts/queue-manager.js status

# Auto processor
node scripts/queue-manager.js auto --interval 60000
```

### health-check.js
Monitor API health and performance metrics.

**Usage:**
```bash
# Overall health
node scripts/health-check.js

# Specific provider
node scripts/health-check.js --provider twitter

# Continuous monitoring
node scripts/health-check.js --watch

# Generate report
node scripts/health-check.js --report --export health.json
```

## Integration

```javascript
const APIThrottle = require('./scripts/throttle.js');
const throttle = new APIThrottle();

// Simple throttled request
const result = await throttle.request('twitter', 'tweets', { text: 'Hello' });

// High priority with custom options
const urgentResult = await throttle.request('coingecko', 'price', 
  { ids: 'bitcoin' }, 
  { priority: 'high' }
);

// Check if rate limited
if (throttle.isRateLimited('twitter', 'tweets')) {
  console.log('Rate limited, request will be queued');
}
```

## State Management

The skill maintains persistent state in `state/`:
- `queues.json` - Pending requests by provider/endpoint
- `limits.json` - Current rate limit tracking
- `metrics.json` - Performance and usage statistics

State survives agent restarts and system reboots.

## Real-World Usage

**Before (manual throttling):**
```javascript
// Scattered rate limit logic
if (lastRequest && Date.now() - lastRequest < 4000) {
  await sleep(4000);
}
try {
  const response = await fetch(url);
  if (response.status === 429) {
    // Manual retry logic...
  }
} catch (error) {
  // Handle network errors...
}
```

**After (with api-throttle):**
```javascript
// Clean, automatic throttling
const result = await throttle.request('twitter', 'tweets', data);
// Handles rate limits, queuing, retries, and backoff automatically
```

## Provider Support

Works with any REST API. Pre-configured for:
- **Twitter** - Tweet posting, user lookups, timeline access
- **CoinGecko** - Price data, market info, trending tokens  
- **GitHub** - Repository operations, issue management
- **Custom** - Add any provider with rate limit configuration

## Monitoring

The health checker provides real-time insights:
- Rate limit utilization per provider/endpoint
- Queue depths and wait times
- Failed request counts and retry attempts
- Overall system health status
- Performance trends and bottlenecks

## Production Ready

- **Error Handling**: Circuit breaker patterns for failed APIs
- **Graceful Degradation**: Continues working during partial failures  
- **Resource Management**: Automatic cleanup of old state data
- **Logging**: Detailed request tracking for debugging
- **Metrics**: Performance data for optimization

## Author

**Axiom** 🔬
- Twitter: [@AxiomBot](https://x.com/AxiomBot)  
- Base: [axiombotx.base.eth](https://www.base.org/name/axiombotx)
- GitHub: [github.com/0xAxiom](https://github.com/0xAxiom)

Built from real-world agent operations and battle-tested against production API limits.