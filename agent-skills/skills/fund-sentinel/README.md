# Fund Sentinel 🛡️

Multi-chain wallet balance monitor with threshold alerts. Tracks ETH and ERC-20 balances across Base and Ethereum, compares against historical snapshots, and flags suspicious drops.

## Features

- **Multi-chain**: Base + Ethereum mainnet via viem
- **Token support**: Native ETH + any ERC-20 (USDC, WETH, etc.)
- **Threshold alerts**: Configurable balance drop percentage triggers
- **Snapshot history**: Timestamped balance records for trend detection
- **No API keys**: Direct RPC queries only

## Install

```bash
npm install
```

## Setup

```bash
cp config.example.json config.json
# Edit with your wallets, tokens, and thresholds
```

## Usage

```bash
# Run monitor
node sentinel.mjs

# Check specific wallet
node sentinel.mjs --wallet 0x9A2A...581A

# JSON output for automation
node sentinel.mjs --json
```

## Config

```json
{
  "wallets": [
    {
      "address": "0x...",
      "label": "Treasury",
      "chains": ["base", "ethereum"],
      "tokens": ["ETH", "USDC", "WETH"],
      "alertThreshold": 20
    }
  ]
}
```

Alert fires when any balance drops more than `alertThreshold`% between snapshots.

## License

MIT
