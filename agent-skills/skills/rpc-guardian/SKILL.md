# RPC Guardian 🛡️

Monitor RPC endpoint health and provide automatic failover for reliable blockchain access.

## When to Use

Use this skill when you need:
- **Reliable blockchain access** - Auto-failover when primary RPC fails
- **RPC health monitoring** - Test endpoints for latency, block height sync
- **Multi-provider redundancy** - Maintain backup RPC endpoints
- **Performance tracking** - Monitor RPC response times and success rates
- **Auto-recovery** - Detect when failed endpoints come back online

## Triggers

- "check RPC health"
- "monitor blockchain endpoints"
- "RPC failover"
- "blockchain connection issues"
- "endpoint monitoring"
- "RPC performance"
- "backup RPC providers"

## Quick Start

```bash
# Test single endpoint
./scripts/rpc-guardian.js --test --rpc https://mainnet.base.org

# Monitor multiple endpoints with failover
./scripts/rpc-guardian.js --monitor --config ./config/base-mainnet.json

# Health check all configured networks
./scripts/rpc-guardian.js --health-check

# Get best endpoint for a network
./scripts/rpc-guardian.js --best --network base-mainnet
```

## Configuration

Create `config/<network>.json`:

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
    },
    {
      "name": "Alchemy",
      "url": "https://base-mainnet.g.alchemy.com/v2/YOUR_KEY",
      "priority": 2,
      "timeout": 5000
    },
    {
      "name": "QuickNode",
      "url": "https://endpoints.omniatech.io/v1/base/mainnet/public",
      "priority": 3,
      "timeout": 10000
    }
  ],
  "thresholds": {
    "maxLatency": 2000,
    "maxBlockLag": 5,
    "minSuccessRate": 0.95
  }
}
```

## Core Functions

- **Health Testing** - Test endpoint latency, block height, success rate
- **Auto Failover** - Switch to backup when primary fails
- **Performance Tracking** - Log response times and error rates
- **Recovery Detection** - Detect when failed endpoints recover
- **Best Endpoint Selection** - Choose optimal endpoint by performance

## Outputs

- Health status reports
- Performance metrics
- Failover events
- Best endpoint recommendations
- Network configuration validation

## Integration

Use with other skills:
- **wallet-health** - Ensure wallet operations use healthy RPCs
- **gas-optimizer** - Get accurate gas estimates from reliable endpoints
- **tx-verify** - Verify transactions on multiple endpoints
- **uniswap-v4-lp** - Reliable DeFi operations

## Error Handling

- Graceful degradation when all endpoints fail
- Exponential backoff for failed endpoint retesting
- Clear error messages for network configuration issues
- Fallback to public endpoints when premium fail

## Dependencies

- Pure Node.js (no external deps)
- Standard fetch API
- JSON config files