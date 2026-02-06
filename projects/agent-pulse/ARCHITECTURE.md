# Agent Pulse - Real-Time AI Agent Activity Monitor

## Overview

Agent Pulse monitors AI agent activity on Base blockchain in real-time, providing insights into what agents are doing, which protocols they're using, and aggregate statistics that reveal patterns in the agent economy.

## Problem Statement

The agent economy is growing rapidly, but there's no visibility into what agents are actually doing on-chain:
- Which agents are most active?
- What protocols do they use most?
- How much volume are they generating?
- Are there coordinated behaviors?
- What's the aggregate impact on DeFi?

## Solution

A real-time monitoring dashboard that:
1. Tracks known agent wallets on Base
2. Categorizes every transaction (swap, LP, bridge, mint, transfer)
3. Calculates rolling statistics
4. Provides real-time WebSocket feed
5. Visualizes activity patterns

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         DATA SOURCES                                    │
├─────────────────────────────────────────────────────────────────────────┤
│  [Base RPC]  →  eth_subscribe (pending + confirmed txs)                │
│  [Alchemy]   →  Webhook notifications for agent wallets                │
│  [Etherscan] →  Historical transaction fetch + ABI decoding           │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                     TRANSACTION PROCESSOR                               │
├─────────────────────────────────────────────────────────────────────────┤
│  1. Receive raw transaction                                            │
│  2. Check if sender/receiver is known agent                            │
│  3. Decode transaction (function signature → human readable)           │
│  4. Categorize:                                                        │
│     - SWAP: Uniswap, Aerodrome, etc.                                   │
│     - LP: addLiquidity, removeLiquidity, collect                       │
│     - BRIDGE: Stargate, LayerZero, etc.                                │
│     - MINT: NFT mints, token deployments                               │
│     - TRANSFER: simple ETH/token transfers                             │
│     - OTHER: unknown contracts                                         │
│  5. Extract value (ETH value, token amounts)                           │
│  6. Emit to event bus                                                  │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                      STATISTICS ENGINE                                  │
├─────────────────────────────────────────────────────────────────────────┤
│  Rolling windows: 1h, 24h, 7d                                          │
│                                                                         │
│  Per-agent metrics:                                                     │
│  - Transaction count                                                    │
│  - Volume (in ETH equivalent)                                          │
│  - Protocol breakdown (% swaps, % LP, etc.)                            │
│  - Average gas spent                                                    │
│  - Success rate                                                         │
│                                                                         │
│  Aggregate metrics:                                                     │
│  - Total agent volume                                                   │
│  - Most active agents                                                   │
│  - Trending protocols                                                   │
│  - Hourly activity patterns                                            │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                    ┌───────────────┴───────────────┐
                    ▼                               ▼
┌─────────────────────────────┐   ┌─────────────────────────────────────┐
│       REST API              │   │         WebSocket Server            │
├─────────────────────────────┤   ├─────────────────────────────────────┤
│ GET /agents                 │   │ WS /feed                            │
│   - List tracked agents     │   │   - Real-time transaction stream   │
│                             │   │   - Filter by agent/category       │
│ GET /agents/:address        │   │                                     │
│   - Agent details + stats   │   │ Events:                             │
│                             │   │   - agent:tx (new transaction)     │
│ GET /stats                  │   │   - stats:update (1min interval)   │
│   - Aggregate statistics    │   │   - agent:new (newly tracked)      │
│                             │   │                                     │
│ GET /feed                   │   │                                     │
│   - Recent transactions     │   │                                     │
└─────────────────────────────┘   └─────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         DASHBOARD (React)                               │
├─────────────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ AGENT PULSE - Real-time AI Agent Activity on Base              │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐   │
│  │  24h Volume  │ │  Active      │ │  Txns/Hour   │ │  Top Proto   │   │
│  │  $1.2M      │ │  12 Agents   │ │  847         │ │  Uniswap V4  │   │
│  └──────────────┘ └──────────────┘ └──────────────┘ └──────────────┘   │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ LIVE FEED                                                        │   │
│  │ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ │   │
│  │ 🤖 AxiomBot swapped 0.5 ETH → 1.2M AXIOM on Uniswap V4      2s │   │
│  │ 🤖 BagBot added liquidity $420 to WETH/BAG pool            15s │   │
│  │ 🤖 DegenAgent minted NFT on Zora                           32s │   │
│  │ ...                                                             │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ TOP AGENTS (24h)           │ ACTIVITY BY CATEGORY              │   │
│  │ 1. BagBot      $234k       │ ████████████ Swaps 68%           │   │
│  │ 2. AxiomBot    $89k        │ ██████ LP Operations 24%          │   │
│  │ 3. DegenAgent  $45k        │ ██ Mints 5%                       │   │
│  │ 4. ...                     │ █ Other 3%                        │   │
│  └─────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
```

## Tech Stack

- **Backend:** Node.js + Express + ws (WebSocket)
- **Database:** SQLite with better-sqlite3 (simple, fast, no setup)
- **Blockchain:** viem for RPC calls, etherscan API for historical
- **Frontend:** React + Tailwind + Recharts
- **Deployment:** Single repo, runs locally or on any Node host

## Data Model

```typescript
// Agent Registry
interface Agent {
  address: string;
  name: string;
  twitter?: string;
  framework?: 'clawdbot' | 'eliza' | 'autogpt' | 'custom' | 'unknown';
  addedAt: number;
}

// Transaction Record
interface AgentTransaction {
  hash: string;
  agent: string;
  category: 'swap' | 'lp' | 'bridge' | 'mint' | 'transfer' | 'other';
  protocol?: string;
  valueEth: number;
  gasUsed: number;
  success: boolean;
  timestamp: number;
  decoded?: {
    method: string;
    params: Record<string, any>;
  };
}

// Statistics (computed)
interface AgentStats {
  address: string;
  txCount: number;
  volumeEth: number;
  categoryBreakdown: Record<string, number>;
  protocols: string[];
  avgGas: number;
  successRate: number;
  lastActive: number;
}
```

## Known Agent Wallets (Seed Data)

```javascript
const KNOWN_AGENTS = [
  { 
    address: '0x523Eff3dB03938eaa31a5a6FBd41E3B9d23edde5', 
    name: 'AxiomBot',
    twitter: '@AxiomBot'
  },
  {
    address: '0x19fe674a83e98c44ad4c2172e006c542b8e8fe08',
    name: 'AxiomBot-Bankr',
    twitter: '@AxiomBot'
  },
  // Add more known agent wallets...
];
```

## Contract Signatures (for decoding)

```javascript
const SIGNATURES = {
  // Uniswap V4
  '0x414bf389': 'exactInputSingle',
  '0xc04b8d59': 'exactInput',
  // Uniswap V3
  '0x5ae401dc': 'multicall',
  // LP Operations
  '0xe8e33700': 'addLiquidity',
  '0xbaa2abde': 'removeLiquidity',
  // Aerodrome
  '0x5c11d795': 'swapExactTokensForTokens',
  // ... more
};
```

## API Endpoints

### REST API

```
GET /api/agents
  → [{ address, name, twitter, framework, stats: {...} }]

GET /api/agents/:address
  → { address, name, stats, recentTxs: [...] }

GET /api/stats
  → { 
      totalVolume24h, 
      totalTxs24h, 
      activeAgents, 
      topProtocols,
      hourlyActivity: [...] 
    }

GET /api/feed?limit=50&category=swap
  → [{ hash, agent, category, value, timestamp, ... }]

POST /api/agents
  → Add new agent to track (with verification)
```

### WebSocket

```
WS /ws

// Client subscribes
{ "subscribe": ["feed", "stats"] }

// Server pushes
{ "type": "tx", "data": { hash, agent, category, ... } }
{ "type": "stats", "data": { totalVolume24h, ... } }
```

## Build Plan (3-4 hours)

### Hour 1: Core Backend
- [ ] Set up project structure
- [ ] SQLite schema + seed data
- [ ] Transaction processor with signature decoding
- [ ] Basic REST API endpoints

### Hour 2: Real-time Data
- [ ] RPC subscription for new blocks
- [ ] Filter for agent transactions
- [ ] WebSocket server with broadcast
- [ ] Statistics calculator

### Hour 3: Frontend Dashboard
- [ ] React app with Tailwind
- [ ] Live feed component
- [ ] Stats cards
- [ ] Agent leaderboard

### Hour 4: Polish & Ship
- [ ] Add more known agents
- [ ] Error handling
- [ ] README with screenshots
- [ ] Deploy / document how to run

## Success Metrics

1. **Works:** Can track real agent transactions in real-time
2. **Looks good:** Dashboard is clean and informative
3. **Useful:** People would actually want this data
4. **Shareable:** Stats/screenshots make good Twitter content

## Future Extensions (not today)

- Agent detection ML (identify unknown agents by behavior)
- Alerts (notify when agents make large moves)
- Historical analysis (agent performance over time)
- Cross-chain support (ETH, Arbitrum, etc.)
- Public API with rate limiting
