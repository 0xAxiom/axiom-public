# Fund Sentinel 🛡️

Multi-chain wallet balance monitoring with threshold alerts. Tracks ETH and token balances across Base and Ethereum networks, comparing against historical snapshots to detect suspicious activity.

## Features

- **Multi-chain monitoring**: Base and Ethereum mainnet
- **Token support**: Native ETH + ERC20 tokens (USDC, WETH, etc.)
- **Threshold alerts**: Configurable balance drop percentages
- **Historical tracking**: Maintains snapshot history with timestamps
- **RPC-based**: Direct blockchain queries using viem (no API keys needed)
- **JSON output**: Machine-readable alerts and balance data

## Quick Start

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Create config file**:
   ```bash
   cp config.example.json config.json
   # Edit config.json with your wallets and thresholds
   ```

3. **Run monitor**:
   ```bash
   node sentinel.mjs
   # or
   ./scripts/run.sh
   ```

## Configuration

Edit `config.json` with your settings:

```json
{
  "wallets": {
    "treasury": "0x...",
    "main": "0x..."
  },
  "thresholds": {
    "balanceDropPercent": 20,    // Alert if balance drops >20%
    "minAlertValueUsd": 100      // Only alert if drop >$100 value
  }
}
```

## Output Format

### Success (Exit code 0)
```json
{
  "timestamp": "2026-02-09T20:45:00Z",
  "alerts": [],
  "snapshot": {
    "treasury": {
      "base": { "ETH": "0.11", "USDC": "1250.50" },
      "ethereum": { "ETH": "0.05", "USDC": "500.00" }
    }
  },
  "changes": [...]
}
```

### Alerts Detected (Exit code 1)
```json
{
  "timestamp": "2026-02-09T20:45:00Z",
  "alerts": [
    {
      "severity": "HIGH",
      "wallet": "treasury",
      "chain": "base",
      "token": "USDC",
      "previousBalance": "4700.00",
      "currentBalance": "0.00",
      "changePercent": -100,
      "message": "⚠️ treasury USDC on base dropped 100% (4700.00 → 0.00)"
    }
  ],
  "snapshot": {...}
}
```

## Cron Integration

Add to your crontab for automated monitoring:

```bash
# Check every 15 minutes
*/15 * * * * cd /path/to/fund-sentinel && ./scripts/run.sh >> /var/log/fund-sentinel.log 2>&1

# Email on alerts (requires mail setup)
*/15 * * * * cd /path/to/fund-sentinel && ./scripts/run.sh | jq -r '.alerts[] | .message' | mail -s "Fund Alert" admin@domain.com
```

## Alert Severities

- **HIGH**: Balance dropped >50% or significant value lost
- **MEDIUM**: Balance dropped >threshold% but <50%
- **LOW**: Minor changes within normal range

## Supported Networks

- **Base** (chainId: 8453)
  - Native ETH
  - USDC: 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
  - WETH: 0x4200000000000000000000000000000000000006

- **Ethereum** (chainId: 1)  
  - Native ETH
  - USDC: 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48
  - WETH: 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2

## Exit Codes

- `0`: No alerts detected
- `1`: Alerts detected (check output JSON)
- `2`: Error occurred (config, network, etc.)

## Files

- `sentinel.mjs`: Main monitoring script
- `config.json`: Your wallet/threshold configuration
- `snapshots.json`: Historical balance data (auto-generated)
- `scripts/run.sh`: Wrapper script with exit code handling

## Troubleshooting

**Network errors**: Check RPC endpoint availability
**Permission errors**: Ensure write access for snapshots.json
**Memory issues**: Large multicall batches may need chunking

## Security Notes

- Config file contains wallet addresses (not private keys)
- Uses public RPC endpoints - no authentication required
- Snapshots contain historical balance data - protect accordingly