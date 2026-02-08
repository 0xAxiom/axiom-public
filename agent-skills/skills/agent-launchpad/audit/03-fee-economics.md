# Audit 03: Fee Economics & Revenue Model

**Auditor:** Fee Economics & Revenue Subagent  
**Date:** 2026-01-31  
**Status:** ✅ Complete  
**Scope:** Fee flow, conversion mechanics, claim permissions, dashboard design, automation, edge cases, revenue projections

---

## 1. Fee Flow Analysis

### The Complete Pipeline

```
User trades on Uniswap V4 pool
  → ClankerHook applies LP fee (1% static on each side per our config)
  → Hook auto-collects fees on EVERY SWAP (no manual collect needed)
  → ClankerLpLockerFeeConversion distributes fees per rewardBps splits
  → Fees accumulate in ClankerFeeLocker (single contract for ALL v4 tokens)
  → claim(feeOwner, token) transfers accumulated fees to recipient
```

### Our Split Configuration

| Recipient | Allocation | `rewardsToken` | Receives |
|-----------|-----------|----------------|----------|
| Agent (deployer) | 75% | `Both` | Token + WETH |
| Protocol (`0x0D99...F6`) | 25% | `Paired` | WETH only |

### Key Architecture Insight

The ClankerFeeLocker is a **single global contract** that accumulates fees for ALL v4 tokens. Fees from the same paired token (WETH) for a single recipient are **grouped together** across all their tokens. There is **no onchain way** to see the per-token WETH breakdown — you must inspect `IClankerLpLocker.ClaimedRewards` events on Dune.

### ✅ Assessment: Our understanding is correct

The flow is: Trade → Hook auto-collects LP fees → LpLockerFeeConversion splits per allocation → FeeLocker accumulates → `claim()` transfers to recipient. The critical detail we benefit from: **fees are collected automatically on every swap** via the hook — there's no manual "collect from LP position" step needed.

---

## 2. Fee Conversion: Does the Locker Auto-Convert?

### Answer: YES — the locker handles conversion automatically

The `ClankerLpLockerFeeConversion` contract manages fee token preferences via the `FeeIn` enum:

```solidity
enum FeeIn {
  Both,    // Receive both the deployed token + paired token
  Paired,  // Convert all fees to paired token (WETH in our case)
  Clanker  // Convert all fees to the deployed token
}
```

**How it works:**
- When we set `rewardsToken: "Paired"` for the protocol address, the locker converts the protocol's share of token-side fees into WETH before depositing into the FeeLocker.
- When agents set `rewardsToken: "Both"`, they receive fees in both the deployed token and WETH.

### ✅ Assessment: No manual conversion needed

Our protocol wallet accumulates **only WETH** in the FeeLocker — conversion is handled at the locker level. This is ideal for treasury management — no need to deal with hundreds of different meme tokens.

### ⚠️ Minor Concern: Conversion Slippage

The on-chain conversion from token → WETH happens via the same pool. For low-liquidity tokens, this conversion may suffer slippage. However, since fees are small amounts collected per-swap, slippage should be negligible in practice.

---

## 3. Claim Permissions: Who Can Call claim()?

### Answer: ANYONE can call claim() — it always sends to the designated recipient

```solidity
// callable by anyone, transfers the available fees to the recipient
function claim(address feeOwner, address token) external;
```

From Clanker docs: *"Anyone is able to trigger the claim() function to transfer fees from the fee locker to the user's address. This design decision was made because many users point their fees to multisigs or other contracts which cannot trigger the claim() function themselves."*

### ✅ Assessment: This is a feature, not a risk

- **Security:** Safe — fees always go to the registered `feeOwner`, regardless of who calls `claim()`.
- **Opportunity:** We can build a bot/cron that claims for ALL agents, or let agents claim themselves.
- **Gas:** The caller pays gas. If we auto-claim, we pay gas. If agents claim, they pay.

### Important Parameter Note

The `token` parameter in `claim(address feeOwner, address token)` refers to the **fee token being claimed** (e.g., WETH address), NOT the deployed token address. This is a common confusion point called out in the docs.

For our protocol wallet claiming WETH:
```
claim(0x0D9945F0...cE9F0F6, 0x4200000000000000000000000000000000000006)
```
This claims ALL accumulated WETH fees across ALL tokens we've launched in a **single call**.

---

## 4. Dashboard Design: Tracking Revenue Across All Tokens

### Data Sources

| Source | What It Provides | Access |
|--------|-----------------|--------|
| ClankerFeeLocker.availableFees() | Current unclaimed balance | On-chain view call |
| Clanker API `/get-estimated-uncollected-fees` | Per-token fee breakdown (v4 needs `rewardRecipientAddress`) | REST API |
| `IClankerLpLocker.ClaimedRewards` events | Historical per-token breakdown | Dune/event logs |
| Our deployment database | List of all tokens we launched | Local DB |

### Recommended Dashboard Architecture

```
┌─────────────────────────────────────────────────┐
│  Agent Launchpad Revenue Dashboard               │
├──────────────────────┬──────────────────────────┤
│  Protocol Revenue     │  Agent Revenue (all)     │
│  ┌────────────────┐   │  ┌────────────────────┐  │
│  │ Unclaimed WETH │   │  │ Per-agent breakdown │  │
│  │ Total Claimed  │   │  │ Top earners         │  │
│  │ 24h / 7d / 30d │   │  │ Claim status        │  │
│  └────────────────┘   │  └────────────────────┘  │
├──────────────────────┴──────────────────────────┤
│  Per-Token Analytics                             │
│  Token | Volume | Fees Generated | Agent | Proto │
│  ───────────────────────────────────────────────│
│  (fetched via Clanker API per-token)             │
└─────────────────────────────────────────────────┘
```

### Implementation Plan

1. **Token Registry:** Store every deployed token address + agent address in a JSON/SQLite database at deploy time.
2. **Batch Fee Check:** Loop through registered tokens calling the Clanker API:
   ```
   GET /api/get-estimated-uncollected-fees/{tokenAddress}?rewardRecipientAddress=0x0D99...
   ```
3. **Aggregate View:** Single on-chain call for total protocol unclaimed:
   ```solidity
   ClankerFeeLocker.availableFees(PROTOCOL_ADDRESS, WETH_ADDRESS)
   ```
4. **Historical:** Index `ClaimedRewards` events from the LpLocker contract on Dune Analytics.

### Quick Win: Simple Revenue Check Script

```javascript
// Check total protocol WETH fees available
const fees = await publicClient.readContract({
  address: CLANKER_FEE_LOCKER_ADDRESS,
  abi: [{ name: 'availableFees', type: 'function', inputs: [{ type: 'address' }, { type: 'address' }], outputs: [{ type: 'uint256' }] }],
  functionName: 'availableFees',
  args: ['0x0D9945F0a591094927df47DB12ACB1081cE9F0F6', '0x4200000000000000000000000000000000000006'],
});
console.log(`Protocol WETH available: ${formatEther(fees)}`);
```

---

## 5. Automated Fee Collection: Should We Use Cron?

### Recommendation: YES, with smart frequency

### Factors Affecting Optimal Frequency

| Factor | Impact |
|--------|--------|
| Gas cost per claim | ~$0.01-0.05 on Base |
| Number of tokens launched | More tokens = more fees accumulating |
| Volume per token | Higher volume = faster accumulation |
| ETH price volatility | Claim before potential drops |

### Recommended Strategy

| Phase | # Tokens | Frequency | Rationale |
|-------|----------|-----------|-----------|
| Early (1-50 tokens) | Low volume | Weekly | Gas costs may exceed fees |
| Growth (50-500 tokens) | Medium volume | Daily | Fees justify daily gas |
| Scale (500+ tokens) | High volume | Every 6 hours | Maximize capital efficiency |

### Implementation

**For Protocol WETH fees** (single claim for ALL tokens):
```bash
# Cron: daily at 6 AM UTC
0 6 * * * node claim-protocol-fees.mjs
```

**Logic:**
1. Check `availableFees(PROTOCOL, WETH)` 
2. If fees > threshold (e.g., 0.01 ETH), claim
3. Log claim amount + tx hash to revenue ledger
4. Alert if fees are unexpectedly low (token may have lost liquidity)

### ⚠️ Note on claim-rewards.mjs

Our current `claim-rewards.mjs` uses the Clanker SDK which works per-token. For protocol fees, we should build a direct contract call to `ClankerFeeLocker.claim()` which claims ALL accumulated WETH in one transaction, regardless of how many tokens generated it. This is much more gas-efficient.

---

## 6. Unhandled Fee Scenarios

### 6.1 ✅ Non-WETH Pair Tokens
**Current status:** Not an issue — we hardcode `pairedToken: WETH` in both `server.mjs` and `deploy-token.mjs`. All pools are token/WETH.

**Future risk:** If we ever support other paired tokens (USDC, etc.), the protocol fee would accumulate in that token instead. We'd need to claim each paired token separately.

### 6.2 ⚠️ Inconsistent Allocation Numbers
**Finding:** There's a mismatch between documentation and code:

| Location | Agent % | Protocol % |
|----------|---------|------------|
| `server.mjs` header comment | 20% protocol | — |
| `server.mjs` constants | 75% agent / 25% protocol | ✅ actual |
| `deploy-token.mjs` help text | 60% agent / 20% protocol | outdated |
| `deploy-token.mjs` defaults | 75% agent / 25% protocol | ✅ actual |

**Recommendation:** Fix comments and help text to reflect the actual 75/25 split.

### 6.3 ⚠️ Missing: Clanker Protocol Fee
Clanker itself takes a protocol fee on top of LP fees. From the v4 docs, the `ClankerHook` contains "the implementation for Clanker's protocol fee." This means the actual fee flow is:

```
1% LP fee (our config)
  → Clanker protocol takes their cut first
  → Remainder is split 75/25 between agent and our protocol
```

**We should verify:** What % does Clanker take? This affects our revenue projections.

### 6.4 ⚠️ Missing: Token Registry / Deployment Tracking
We have no persistent record of which tokens we've deployed. If the server restarts, we lose track. We need:
- A JSON/SQLite file recording every deployment
- Fields: tokenAddress, agentAddress, agentName, deployTimestamp, requestKey, chainId

### 6.5 ⚠️ Multi-Chain Fee Collection
`deploy-token.mjs` supports Base, Unichain, and Arbitrum. The ClankerFeeLocker is per-chain. We'd need separate claim logic per chain.

### 6.6 ✅ Admin Key Rotation
The `rewardAdmin` can update `rewardRecipient` and `feePreference` post-deployment via `updateRewardRecipient()` and `updateFeePreference()`. Our protocol address is set as its own admin, so we retain control.

### 6.7 ⚠️ Bankr Fee Address (Unused?)
`deploy-token.mjs` defines `BANKR_FEE_ADDRESS` but never uses it in the rewards array. Is this a planned third recipient? If so, the 75/25 split would need adjustment.

---

## 7. Revenue Projections

### Fee Math Breakdown

```
Per Trade:
  Trade volume: $V
  LP fee: 1% (our configured static fee)
  Clanker protocol cut: ~unknown (assume 0% for optimistic, 50% for conservative)
  
  Optimistic (Clanker takes 0%):
    Protocol revenue per $1000 trade = $1000 × 1% × 25% = $2.50
  
  Conservative (Clanker takes 50%):
    Protocol revenue per $1000 trade = $1000 × 1% × 50% × 25% = $1.25
```

### Scenario Projections (Monthly)

#### Scenario A: Early Stage (50 tokens, low activity)
| Metric | Value |
|--------|-------|
| Tokens launched | 50 |
| Avg daily volume per token | $1,000 |
| Total daily volume | $50,000 |
| Daily protocol revenue (optimistic) | $12.50 |
| Monthly protocol revenue | **$375** |

#### Scenario B: Growth (200 tokens, moderate activity)
| Metric | Value |
|--------|-------|
| Tokens launched | 200 |
| Avg daily volume per token | $5,000 |
| Total daily volume | $1,000,000 |
| Daily protocol revenue (optimistic) | $250 |
| Monthly protocol revenue | **$7,500** |

#### Scenario C: Scale (1000 tokens, with some hits)
| Metric | Value |
|--------|-------|
| Tokens launched | 1,000 |
| Avg daily volume per token | $10,000 |
| Total daily volume | $10,000,000 |
| Daily protocol revenue (optimistic) | $2,500 |
| Monthly protocol revenue | **$75,000** |

#### Scenario D: One Viral Token
| Metric | Value |
|--------|-------|
| Viral token daily volume | $5,000,000 |
| Daily protocol revenue from 1 token | $1,250 |
| Monthly from just this token | **$37,500** |

### Power Law Reality

Meme token volume follows a power law. Most tokens will do near-zero volume after initial hype. Revenue will be dominated by 1-5 "winners" at any given time. The strategy should be:
1. **Maximize launches** (volume play — more tokens = more lottery tickets)
2. **Track winners** (know which tokens are generating revenue)
3. **Claim frequently on winners** (don't leave WETH sitting)

---

## 8. Action Items

### Critical (Do Now)
- [ ] **Build token registry** — store all deployments in persistent storage
- [ ] **Build protocol fee claim script** — direct ClankerFeeLocker.claim() call for WETH
- [ ] **Fix documentation inconsistencies** — update comments to reflect 75/25 split
- [ ] **Determine Clanker's protocol fee %** — affects all revenue projections

### Important (This Week)
- [ ] **Set up daily cron** for protocol WETH claims with threshold check
- [ ] **Build simple revenue dashboard** — even just a CLI script that checks availableFees()
- [ ] **Clarify Bankr fee address** — remove or integrate into rewards split
- [ ] **Add deployment logging** to server.mjs (append to JSONL file)

### Nice to Have (This Month)
- [ ] Dune dashboard for historical per-token fee breakdown
- [ ] Multi-chain claim support (Unichain, Arbitrum)
- [ ] Agent-facing dashboard so agents can see their own earnings
- [ ] Alert system for high-volume tokens (revenue opportunity detection)

---

## 9. Code-Level Findings Summary

| File | Finding | Severity |
|------|---------|----------|
| `server.mjs` | Header says "20% LP fees" but code does 25% | 🟡 Cosmetic |
| `deploy-token.mjs` | Help text says "60% agent / 20% protocol" but defaults are 75/25 | 🟡 Cosmetic |
| `deploy-token.mjs` | `BANKR_FEE_ADDRESS` defined but unused | 🟡 Dead code |
| `claim-rewards.mjs` | Uses SDK per-token claim, not batch FeeLocker claim | 🟡 Inefficient |
| `claim-rewards.mjs` | No threshold check — will claim even dust amounts | 🟡 Gas waste |
| All | No persistent deployment registry | 🔴 Missing feature |
| All | No automated/scheduled claiming | 🟡 Revenue left on table |

---

*End of audit. Protocol fee address: `0x0D9945F0a591094927df47DB12ACB1081cE9F0F6`. All fees accumulate as WETH in the ClankerFeeLocker. Single claim() call collects from all tokens.*
