# Gas Optimizer 💨

Optimize transaction costs and gas usage for AI agents. Track gas spending, predict optimal timing, and minimize fees across EVM chains.

## Features

- **Multi-chain gas tracking** - Ethereum, Base, Arbitrum, Optimism, Polygon
- **Smart timing predictions** - Know when to send transactions for best prices
- **Batch optimization** - Group transactions to save on fees
- **Real-time monitoring** - Alert when gas drops below thresholds
- **Cost analytics** - Track and analyze spending patterns

## Installation

```bash
# Install in OpenClaw skills directory
cp -r gas-optimizer ~/.clawdbot/skills/

# Install dependencies
cd ~/.clawdbot/skills/gas-optimizer
npm install
```

## Quick Start

```bash
# Track gas spending for a wallet
node scripts/gas-tracker.js --wallet 0x123... --chain ethereum --days 30

# Get optimal gas price for medium priority
node scripts/gas-predictor.js --chain ethereum --priority medium

# Estimate batch transaction costs
node scripts/fee-optimizer.js --batch-estimate tx1.json tx2.json

# Monitor gas prices with alerts
node scripts/gas-predictor.js --monitor --alert-below 20 --chain ethereum
```

## Environment Variables

```bash
# RPC endpoints (optional - falls back to public RPCs)
export ETHEREUM_RPC_URL="https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY"
export BASE_RPC_URL="https://base-mainnet.g.alchemy.com/v2/YOUR_KEY"
export ARBITRUM_RPC_URL="https://arb-mainnet.g.alchemy.com/v2/YOUR_KEY"

# API keys for better gas data (optional)
export ETHERSCAN_API_KEY="your_key"
export BASESCAN_API_KEY="your_key"

# Telegram alerts (optional)
export TELEGRAM_BOT_TOKEN="your_token"
export TELEGRAM_CHAT_ID="your_chat_id"
```

## Scripts

### gas-tracker.js
Analyze historical gas spending patterns.

```bash
# Basic tracking
node scripts/gas-tracker.js --wallet 0x123... --chain ethereum --days 30

# Export to CSV
node scripts/gas-tracker.js --wallet 0x123... --format csv --days 7

# Quick gas analysis without wallet
node scripts/gas-tracker.js --analyze --chain base
```

### gas-predictor.js  
Predict optimal gas prices and transaction timing.

```bash
# Get optimal gas for priority level
node scripts/gas-predictor.js --chain ethereum --priority medium

# Predict when target price will be reached
node scripts/gas-predictor.js --target-gwei 20 --predict-window 2h

# Monitor and alert
node scripts/gas-predictor.js --monitor --alert-below 25 --chain ethereum
```

### fee-optimizer.js
Optimize transaction batching and estimate costs.

```bash
# Estimate individual transaction costs
echo '{"to":"0x123...","data":"0x456..."}' > tx.json
node scripts/fee-optimizer.js --batch-estimate tx.json

# Analyze multiple transactions for batching
node scripts/fee-optimizer.js --batch-estimate tx1.json tx2.json tx3.json

# Optimize pending transactions (requires mempool access)
node scripts/fee-optimizer.js --optimize-pending --wallet 0x123...
```

## Transaction File Format

Transaction files should be JSON with this structure:

```json
{
  "to": "0x1234567890123456789012345678901234567890",
  "data": "0xa9059cbb000000000000000000000000...",
  "value": "1000000000000000000",
  "from": "0x9876543210987654321098765432109876543210"
}
```

Or arrays of transactions:

```json
[
  {
    "to": "0x123...",
    "data": "0x456..."
  },
  {
    "to": "0x789...",
    "data": "0xabc..."
  }
]
```

## Supported Chains

| Chain | Network ID | Status | Notes |
|-------|-----------|---------|-------|
| Ethereum | 1 | ✅ Full | Complete gas oracle support |
| Base | 8453 | ✅ Full | L2 optimized tracking |
| Arbitrum | 42161 | ✅ Full | L2 optimized tracking |
| Optimism | 10 | 🔄 Testing | Basic support |
| Polygon | 137 | 🔄 Testing | Basic support |

## Output Examples

### Gas Tracker Output
```json
{
  "wallet": "0x123...",
  "chain": "ethereum", 
  "timeframe": "30 days",
  "analysis": {
    "totalTransactions": 45,
    "totalCostETH": "0.125000",
    "averageCostPerTx": "0.002778",
    "dailyAverage": "0.004167"
  },
  "currentGas": {
    "gasPrice": "25.5",
    "maxFeePerGas": "30.2"
  }
}
```

### Gas Predictor Output
```json
{
  "chain": "ethereum",
  "optimal": {
    "gasPrice": 28,
    "priority": "Medium (3-5 min)",
    "estimatedTime": "3-5 min",
    "currentMarket": {
      "safe": 22,
      "standard": 25,
      "fast": 35
    }
  }
}
```

### Batch Optimizer Output
```json
{
  "individual": [...],
  "batchAnalysis": {
    "canBatch": true,
    "individualCostETH": "0.045000",
    "batchCostETH": "0.028000", 
    "savingsETH": "0.017000",
    "savingsPercent": "37.78",
    "recommended": true
  },
  "recommendations": [
    {
      "type": "batch_transactions",
      "priority": "high",
      "description": "Batch 3 transactions to save 37.78% (0.017000 ETH)"
    }
  ]
}
```

## Security Notes

- Scripts are read-only by default - no private keys needed for tracking
- Transaction estimation uses simulation mode only
- Rate limiting prevents API abuse
- Input validation on all addresses and amounts
- No automatic transaction sending without explicit confirmation

## Troubleshooting

**"RPC error" or timeouts:**
- Set custom RPC URLs in environment variables
- Use multiple RPC providers for redundancy

**"Insufficient data" predictions:**
- Increase monitoring window with `--predict-window`
- Check if chain has enough transaction history

**Batch estimation fails:**
- Verify transaction JSON format
- Check if transactions are compatible for batching
- Ensure multicall contract is deployed on target chain

## Contributing

PRs welcome! Please test thoroughly before submitting.

## License

MIT

## Author

**Axiom** 🔬  
[@AxiomBot](https://x.com/AxiomBot) · [github.com/0xAxiom](https://github.com/0xAxiom)