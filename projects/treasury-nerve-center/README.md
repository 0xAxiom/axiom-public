# Treasury Nerve Center

**One command to understand your entire treasury position.**

<p align="center">
  <img src="https://img.shields.io/badge/base-mainnet-blue" alt="Base Mainnet">
  <img src="https://img.shields.io/badge/license-MIT-green" alt="License">
  <img src="https://img.shields.io/badge/node-%3E%3D18-brightgreen" alt="Node.js">
</p>

## What It Does

Treasury Nerve Center aggregates all your DeFi positions into a single, actionable report:

- **Token Balances** — Native ETH + ERC20 tokens with real-time prices
- **LP Positions** — Uniswap V3 positions with health checks
- **Gas Analysis** — Current gas with historical percentile and recommendations
- **Risk Scoring** — Portfolio-level risk assessment
- **Suggested Actions** — What to do next (collect fees, rebalance, exit)

All from free APIs. No keys required.

## Installation

```bash
# Clone or download
cd ~/Github/daily-builds/builds/2026-02-02-treasury-nerve-center

# Install dependencies
npm install
```

## Usage

### Basic Usage

```bash
# Check any wallet
node src/index.mjs 0x523Eff3dB03938eaa31a5a6FBd41E3B9d23edde5

# Specify chain (default: base)
node src/index.mjs 0x523Eff3dB03938eaa31a5a6FBd41E3B9d23edde5 --chain base
```

### Output Formats

```bash
# Pretty terminal output (default)
node src/index.mjs 0xYourAddress

# JSON for programmatic use
node src/index.mjs 0xYourAddress --json

# Brief summary only
node src/index.mjs 0xYourAddress --summary
```

### CLI Options

| Option | Short | Description |
|--------|-------|-------------|
| `--chain` | `-c` | Chain to query (default: base) |
| `--json` | `-j` | Output raw JSON |
| `--summary` | `-s` | Output brief summary |
| `--help` | `-h` | Show help |

## Example Output

```
═══════════════════════════════════════════════════════════════
                    TREASURY NERVE CENTER                       
═══════════════════════════════════════════════════════════════

Address:  0x523Eff3dB03938eaa31a5a6FBd41E3B9d23edde5
Chain:    base
Time:     2026-02-02T18:15:00.000Z

📊 PORTFOLIO
   Total Value: $1,234.56
   24h Change:  +2.45%
   ├── Tokens:       $500.00
   ├── LP Positions: $700.00
   └── Pending Fees: $34.56

⚠️  RISK ASSESSMENT
   Score: 25/100 [██░░░░░░░░] LOW
   Factors:
   └── Position #123 near range boundary

💰 POSITIONS
   Tokens:
   ETH            0.150000   @     $3,000.00 =      $450.00 (36%)
   USDC          50.000000   @         $1.00 =       $50.00 (4%)
   
   LP Positions:
   #123456  WETH/USDC        $700.00 [HEALTHY] IN RANGE
            └── Pending fees: $34.56

🚨 ALERTS
   🔵 Gas prices are low - good time to transact

⛽ GAS
   Current: 0.001 gwei (15th percentile)
   Status:  ACT NOW
   Gas is below average - good time to transact

📋 SUGGESTED ACTIONS
   📌 [LOW] COLLECT FEES
      $34.56 in uncollected fees
      Value: $34.56

═══════════════════════════════════════════════════════════════
```

## JSON Schema

When using `--json`, the output follows this structure:

```typescript
interface TreasuryReport {
  timestamp: number;
  address: string;
  chain: string;
  
  portfolio: {
    totalValueUsd: number;
    change24h: number;
    breakdown: {
      tokens: number;
      lpPositions: number;
      pendingFees: number;
    };
  };
  
  positions: Position[];
  alerts: Alert[];
  
  gas: {
    current: string;
    percentile: number;
    recommendation: 'act_now' | 'wait';
    reason: string;
  };
  
  recommendations: {
    risk: {
      score: number;
      level: 'low' | 'medium' | 'high' | 'critical';
      factors: Factor[];
    };
    actions: Action[];
    summary: string;
  };
}
```

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Treasury Nerve Center                     │
├─────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐       │
│  │ Price Oracle │  │ Position     │  │ Gas Oracle   │       │
│  │ • CoinGecko  │  │ Tracker      │  │ • Base RPC   │       │
│  │ • CoinCap    │  │ • The Graph  │  │ • Percentile │       │
│  │ • 60s cache  │  │ • Direct RPC │  │ • 15s cache  │       │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘       │
│         └────────────┬────┴────────────────┘                │
│              ┌───────▼───────┐                              │
│              │  Aggregator   │                              │
│              └───────┬───────┘                              │
│              ┌───────▼───────┐                              │
│              │  Recommender  │                              │
│              └───────────────┘                              │
└─────────────────────────────────────────────────────────────┘
```

## Data Sources

| Data | Primary Source | Fallback |
|------|---------------|----------|
| Token Prices | CoinGecko | CoinCap |
| LP Positions | The Graph | Direct RPC |
| Token Balances | Base RPC | — |
| Gas Prices | Base RPC | — |

All APIs are free tier with no authentication required.

## Health Check Rules

| Condition | Status | Alert |
|-----------|--------|-------|
| LP in range, IL < 5% | ✅ healthy | — |
| LP in range, IL 5-15% | ⚠️ warning | Significant IL |
| LP out of range | ⚠️ warning | Out of range |
| LP IL > 15% | 🔴 critical | Consider exit |
| Fees > $50 | ℹ️ info | Fees ready |
| Gas < 20th percentile | ℹ️ info | Good time to act |
| Gas > 80th percentile | ⚠️ warning | Wait for lower gas |

## Development

```bash
# Run with debug output
DEBUG=1 node src/index.mjs 0xAddress

# Test with Axiom's wallet
npm test
```

## Files

```
src/
├── index.mjs           # CLI entry point
├── price-oracle.mjs    # CoinGecko/CoinCap prices
├── position-tracker.mjs # LP positions + token balances
├── gas-oracle.mjs      # Gas prices + recommendations
├── aggregator.mjs      # Data combination + health checks
└── recommender.mjs     # Risk scoring + actions
```

## License

MIT

---

*Built by [Axiom](https://github.com/0xAxiom) • Part of the Daily Builds series*
