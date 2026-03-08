# Gas Optimizer Skill

Optimize transaction costs and gas usage for AI agents. Track gas spending, find optimal transaction timing, and minimize fees across EVM chains.

## Triggers

Use this skill when user mentions:
- "optimize gas"
- "reduce transaction costs"
- "gas tracking"
- "transaction fees"
- "when to send tx"
- "gas price"
- "minimize fees"
- "gas analytics"

## Scripts

### gas-tracker.js
Track and analyze gas spending across wallets and chains.

```bash
node scripts/gas-tracker.js --wallet 0x123... --chain ethereum --days 30
node scripts/gas-tracker.js --analyze --export csv
```

### gas-predictor.js
Predict optimal gas prices and transaction timing.

```bash
node scripts/gas-predictor.js --chain ethereum --priority medium
node scripts/gas-predictor.js --predict-window 2h --target-gwei 20
```

### fee-optimizer.js
Optimize pending transactions and batch operations.

```bash
node scripts/fee-optimizer.js --optimize-pending
node scripts/fee-optimizer.js --batch-estimate file1.json file2.json
```

## Features

- **Multi-chain gas tracking** - Ethereum, Base, Arbitrum, Polygon, Optimism
- **Historical analysis** - Cost patterns, peak/off-peak identification
- **Smart timing** - Predict when gas will drop below threshold
- **Batch optimization** - Group transactions to minimize total fees
- **Emergency estimation** - Fast gas price for urgent transactions
- **Cost reporting** - Daily/weekly/monthly spend analytics
- **Chain comparison** - Compare costs across L2s for similar operations

## Configuration

Add to OpenClaw config:

```json
{
  "gasOptimizer": {
    "defaultChain": "ethereum",
    "trackWallets": ["0x123...", "0x456..."],
    "alertThresholds": {
      "dailySpend": 0.1,
      "singleTx": 0.05
    },
    "optimization": {
      "targetGwei": 15,
      "maxWaitMinutes": 30,
      "batchWindow": 300
    }
  }
}
```

## Environment Variables

```bash
# RPC endpoints for gas data
ETHEREUM_RPC_URL=https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY
BASE_RPC_URL=https://base-mainnet.g.alchemy.com/v2/YOUR_KEY
ARBITRUM_RPC_URL=https://arb-mainnet.g.alchemy.com/v2/YOUR_KEY

# Gas tracking APIs
ETHERSCAN_API_KEY=your_key
BASESCAN_API_KEY=your_key
POLYGONSCAN_API_KEY=your_key

# Alert destinations
TELEGRAM_BOT_TOKEN=your_token
TELEGRAM_CHAT_ID=your_chat_id
```

## Usage Examples

**Track wallet gas spending:**
```bash
node scripts/gas-tracker.js --wallet 0x9A2A75fE7FA8EE6552Cf871e5eC2156B958f581A --chain ethereum --days 7
```

**Get optimal gas price:**
```bash
node scripts/gas-predictor.js --chain ethereum --priority medium
# Output: { "gasPrice": "25", "confidence": 85, "eta": "3-5 min" }
```

**Analyze transaction batch:**
```bash
node scripts/fee-optimizer.js --batch-estimate txs.json
# Output: { "individual": 0.045, "batched": 0.028, "savings": 37.8 }
```

**Monitor gas prices:**
```bash
node scripts/gas-predictor.js --monitor --alert-below 20 --chain ethereum
# Sends alert when gas drops below 20 gwei
```

## Error Handling

All scripts include:
- RPC failure fallback to multiple providers
- Rate limiting protection
- Transaction simulation before sending
- Gas limit estimation with 20% buffer
- Failed transaction analysis and retry logic

## Dependencies

- Pure Node.js (v18+)
- ethers.js v6 for blockchain interaction
- node-fetch for API calls
- No external databases required

## Output Formats

All scripts support:
- JSON (default)
- CSV export
- Human-readable summary
- Telegram-formatted alerts

## Chain Support

| Chain | Network ID | Status |
|-------|-----------|---------|
| Ethereum | 1 | ✅ Full |
| Base | 8453 | ✅ Full |
| Arbitrum | 42161 | ✅ Full |
| Optimism | 10 | ✅ Full |
| Polygon | 137 | ✅ Full |
| BSC | 56 | 🔄 Planned |

## Security

- Read-only by default (no private keys needed for tracking)
- All transaction simulations use tenderly/safe mode
- Rate limiting to prevent API abuse
- Input validation for all addresses and amounts
- No automatic transaction sending without explicit confirmation