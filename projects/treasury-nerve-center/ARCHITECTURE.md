# Agent Treasury Nerve Center

**One API call to understand your entire treasury position.**

## Problem

AI agents with wallets constantly need to answer:
- What's my portfolio worth right now?
- How are my LP positions performing?
- What's the gas situation — should I act now or wait?
- Are any positions at risk (out of range, impermanent loss)?

Currently this requires hitting 5+ APIs, normalizing data, and doing math manually.

## Solution

A unified intelligence layer that aggregates:
1. **Token prices** (CoinGecko + CoinCap fallback)
2. **LP positions** (The Graph subgraphs for Uniswap V3/V4)
3. **Gas prices** (Mempool.space for BTC, Etherscan/Base RPC for EVM)
4. **Position health** (range status, IL calculation, fee accumulation)

Returns a single structured response with:
- Total portfolio value (USD)
- Position-by-position breakdown
- Health alerts (out of range, high IL, low liquidity)
- Gas recommendation (act now / wait / urgent)
- Suggested actions

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Treasury Nerve Center                     │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐       │
│  │ Price Oracle │  │ Position     │  │ Gas Oracle   │       │
│  │              │  │ Tracker      │  │              │       │
│  │ • CoinGecko  │  │ • The Graph  │  │ • Mempool    │       │
│  │ • CoinCap    │  │ • Direct RPC │  │ • Base RPC   │       │
│  │ • Cache 60s  │  │ • V3/V4 LP   │  │ • Etherscan  │       │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘       │
│         │                 │                 │                │
│         └────────────┬────┴────────────────┘                │
│                      │                                       │
│              ┌───────▼───────┐                              │
│              │  Aggregator   │                              │
│              │               │                              │
│              │ • Normalize   │                              │
│              │ • Calculate   │                              │
│              │ • Health Check│                              │
│              └───────┬───────┘                              │
│                      │                                       │
│              ┌───────▼───────┐                              │
│              │  Recommender  │                              │
│              │               │                              │
│              │ • Risk Score  │                              │
│              │ • Actions     │                              │
│              │ • Alerts      │                              │
│              └───────┬───────┘                              │
│                      │                                       │
└──────────────────────┼──────────────────────────────────────┘
                       │
                       ▼
              ┌────────────────┐
              │  JSON Response │
              │                │
              │ • portfolio    │
              │ • positions[]  │
              │ • alerts[]     │
              │ • gas          │
              │ • actions[]    │
              └────────────────┘
```

## Data Flow

1. **Input:** Wallet address + chain ID
2. **Price Oracle:** Fetch token prices from CoinGecko (CoinCap fallback)
3. **Position Tracker:** Query The Graph for LP positions, direct RPC for token balances
4. **Gas Oracle:** Get current gas prices and historical percentiles
5. **Aggregator:** Combine all data, calculate totals, check position health
6. **Recommender:** Generate risk scores and suggested actions
7. **Output:** Structured JSON with everything an agent needs

## API Design

### Endpoint
```
GET /treasury/:address?chain=base
```

### Response Schema
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
    current: number;
    percentile: number;  // vs last 24h
    recommendation: 'act_now' | 'wait' | 'urgent';
    estimatedSavings: number;  // if waiting
  };
  
  actions: SuggestedAction[];
}

interface Position {
  type: 'token' | 'lp_v3' | 'lp_v4';
  protocol: string;
  tokenId?: string;
  tokens: TokenAmount[];
  valueUsd: number;
  health: {
    status: 'healthy' | 'warning' | 'critical';
    inRange?: boolean;
    rangeUtilization?: number;
    impermanentLoss?: number;
  };
  pendingFees?: TokenAmount[];
}

interface Alert {
  severity: 'info' | 'warning' | 'critical';
  type: string;
  message: string;
  position?: string;
}

interface SuggestedAction {
  action: 'collect_fees' | 'rebalance' | 'exit' | 'compound' | 'wait';
  reason: string;
  urgency: 'low' | 'medium' | 'high';
  estimatedValue?: number;
}
```

## Tech Stack

- **Runtime:** Node.js (ES modules)
- **HTTP:** Native fetch (no axios needed)
- **Blockchain:** viem for direct RPC calls
- **Caching:** In-memory with TTL (prices 60s, gas 15s, positions 30s)
- **No external dependencies** beyond viem

## Components

### 1. price-oracle.mjs
- CoinGecko API (free tier: 10-30 calls/min)
- CoinCap fallback
- Token address → price mapping
- 60-second cache

### 2. position-tracker.mjs
- The Graph queries for Uniswap V3/V4 positions
- Direct RPC for token balances
- LP math: tick → price, fee calculation
- 30-second cache

### 3. gas-oracle.mjs
- Base: eth_gasPrice RPC
- Ethereum: Etherscan gas API
- Historical percentile calculation
- 15-second cache

### 4. aggregator.mjs
- Combines all data sources
- Calculates portfolio totals
- Health check logic
- Normalizes to common schema

### 5. recommender.mjs
- Risk scoring algorithm
- Action generation rules
- Alert prioritization

### 6. index.mjs
- Main entry point
- CLI interface: `node index.mjs 0x123... --chain base`
- Optional HTTP server mode

## Health Check Rules

| Condition | Status | Alert |
|-----------|--------|-------|
| LP in range, IL < 5% | healthy | none |
| LP in range, IL 5-15% | warning | "Significant IL" |
| LP out of range | warning | "Position out of range" |
| LP out of range > 24h | critical | "Exit or rebalance" |
| Pending fees > $50 | info | "Fees ready to collect" |
| Gas < 20th percentile | info | "Good time to act" |
| Gas > 80th percentile | warning | "Wait for lower gas" |

## Build Estimate

| Component | Time |
|-----------|------|
| Price Oracle | 30 min |
| Position Tracker | 60 min |
| Gas Oracle | 20 min |
| Aggregator | 45 min |
| Recommender | 30 min |
| CLI/Integration | 15 min |
| Testing | 30 min |
| **Total** | **~3.5 hours** |

## Success Criteria

1. ✅ Single command returns complete treasury status
2. ✅ Handles token balances + LP positions
3. ✅ Real-time price data with fallback
4. ✅ Gas recommendations based on historical data
5. ✅ Actionable alerts for position health
6. ✅ Clean, typed JSON output
7. ✅ No API keys required (free tiers only)

---

*Built by Axiom • github.com/0xAxiom*
