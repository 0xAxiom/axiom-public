# RPC Guardian 🛡️

Monitor RPC endpoint health and provide automatic failover for reliable blockchain access.

## Features

- ⚡ **Fast Health Testing** - Test endpoint latency, block sync, chain ID
- 🔄 **Auto Failover** - Switch to backup endpoints when primary fails
- 📊 **Performance Tracking** - Historical success rates and response times
- 🎯 **Smart Scoring** - Choose optimal endpoint based on multiple factors
- 🚨 **Health Monitoring** - Continuous monitoring with alerting
- 📈 **Detailed Reports** - Performance analytics and health summaries

## Quick Start

```bash
# Test single endpoint
./scripts/rpc-guardian.js --test --rpc https://mainnet.base.org

# Monitor Base network continuously
./scripts/rpc-guardian.js --monitor --network base-mainnet

# Find best endpoint for Base
./scripts/rpc-guardian.js --best --network base-mainnet

# Health check all configured networks
./scripts/rpc-guardian.js --health-check

# Performance report
./scripts/rpc-guardian.js --report
```

## Configuration

Create network configs in `config/<network>.json`:

```json
{
  "network": "base-mainnet",
  "chainId": 8453,
  "endpoints": [
    {
      "name": "Base Official",
      "url": "https://mainnet.base.org",
      "priority": 1,
      "timeout": 5000
    }
  ],
  "thresholds": {
    "maxLatency": 2000,
    "maxBlockLag": 5,
    "minSuccessRate": 0.95
  }
}
```

## Integration Examples

### With DeFi Operations

```javascript
import RPCGuardian from './rpc-guardian.js';

const guardian = new RPCGuardian();
const bestEndpoint = await guardian.findBestEndpoint('base-mainnet');

// Use best endpoint for your transactions
const provider = new JsonRpcProvider(bestEndpoint.url);
```

### Cron Health Checks

```bash
# Add to crontab for 5-minute health checks
*/5 * * * * cd /path/to/rpc-guardian && ./scripts/rpc-guardian.js --health-check
```

## Endpoint Scoring

Endpoints are scored based on:
- **Success Rate** (0-50 points) - Percentage of successful requests
- **Latency** (0-30 points) - Response time performance  
- **Recency** (0-20 points) - How recently the endpoint was tested

Higher scores indicate better performance. Priority is used for tie-breaking.

## Use Cases

- **DeFi Trading Bots** - Ensure reliable blockchain access
- **LP Management** - Monitor positions without RPC failures
- **Transaction Broadcasting** - Failover when primary RPC is down
- **Blockchain Indexing** - Reliable data fetching with backup RPCs
- **Multi-Chain Operations** - Health checks across different networks

## Dependencies

- Pure Node.js (no external dependencies)
- Standard fetch API
- File system for configuration and data persistence

## Author

**Axiom** 🔬 - [@AxiomBot](https://x.com/AxiomBot)