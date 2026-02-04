# ClawFomo Bot Security Audit

**Audit Date:** February 3, 2026  
**Auditor:** Claude Security Auditor  
**Scope:** `scripts/play.mjs` and `scripts/status.mjs`

## Executive Summary

The ClawFomo player bot implements a strategic bidding system for a last-bidder-wins auction game. While the bot includes several risk management features, it contains **1 Critical** and **2 High** severity security issues that could lead to fund loss exceeding configured limits.

**Risk Rating:** 🔴 **HIGH RISK** - Deployment not recommended without fixes.

---

## Critical Issues

### C1. Unlimited Token Approval
**Severity:** 🔴 **CRITICAL**  
**File:** `play.mjs:126`  
**Issue:** Bot approves `maxUint256` CLAWD tokens to the ClawFomo contract.

```javascript
args: [CLAWFOMO, maxUint256]  // Unlimited approval
```

**Risk:** If the ClawFomo contract is compromised or contains bugs, an attacker could drain the entire CLAWD balance, not just the configured betting limits.

**Impact:** Total fund loss (not bounded by `maxTotalLoss`)

**Fix:** Approve only the amount needed for the current session:
```javascript
const sessionApproval = parseUnits(config.maxTotalLoss.toString(), 18);
args: [CLAWFOMO, sessionApproval]
```

---

## High Severity Issues

### H1. No Slippage Protection
**Severity:** 🔶 **HIGH**  
**File:** `play.mjs:200-220`  
**Issue:** Bot calculates bid cost via `calculateCost()` but executes `buyKeys()` without verifying final cost.

**Risk:** Between cost calculation and execution, other players could bid, increasing key price significantly. Bot could spend far more than intended.

**Attack Vector:** Frontrunning - MEV bots could detect the bot's transaction and front-run it to increase costs.

**Fix:** Add maximum cost validation in the bid logic:
```javascript
// Re-check cost just before bidding
const finalCost = await publicClient.readContract({...});
if (finalCost > parseUnits(config.maxBidClawd.toString(), 18)) {
  console.log('Cost increased, skipping bid');
  continue;
}
```

### H2. Timer Edge Case Vulnerabilities  
**Severity:** 🔶 **HIGH**  
**File:** `play.mjs:175,241`  
**Issue:** Multiple timer-related edge cases:
- No validation if `endTime` < current time (could bid on expired rounds)
- Integer overflow risk if `endTime` is very large
- No protection against negative timer values

**Risk:** Bot could waste gas on impossible bids or get stuck in infinite loops.

**Fix:**
```javascript
// Safer timer calculation
const now = BigInt(Math.floor(Date.now() / 1000));
let timeLeft = 0;
if (endTime > now && endTime < now + 86400n) { // Max 24h validity
  timeLeft = Number(endTime - now);
}
```

---

## Medium Severity Issues

### M1. Race Condition in Polling Loop
**Severity:** 🟡 **MEDIUM**  
**File:** `play.mjs:165-270`  
**Issue:** Bot uses polling with fixed 3-second intervals. Multiple race conditions:
- Round state could change between `getRoundInfo()` and `buyKeys()`
- No atomic checks for round transitions
- Last bid timestamp only tracked locally

**Risk:** Bot could bid on wrong round or miss profitable opportunities.

### M2. Insufficient Gas Estimation
**Severity:** 🟡 **MEDIUM**  
**File:** `play.mjs:232`  
**Issue:** Relies on viem's default gas estimation without buffer for network congestion.

**Risk:** Transactions may fail during high network activity, causing missed opportunities or reverted transactions.

**Fix:** Add gas limit buffer:
```javascript
const gasEstimate = await publicClient.estimateContractGas({...});
const gasLimit = gasEstimate * 120n / 100n; // 20% buffer
```

### M3. Round Transition Logic Gap
**Severity:** 🟡 **MEDIUM**  
**File:** `play.mjs:160-175`  
**Issue:** When new round detected, bot resets `roundSpent` but continues immediately without re-reading game state.

**Risk:** Could make decisions based on stale data from previous round.

---

## Low Severity Issues

### L1. Centralized RPC Dependency
**Severity:** 🟢 **LOW**  
**Risk:** Single RPC endpoint failure could halt bot operations.

**Fix:** Implement RPC failover:
```javascript
const rpcUrls = [
  process.env.BASE_RPC_URL,
  'https://mainnet.base.org',
  'https://base-mainnet.public.blastapi.io'
].filter(Boolean);
```

### L2. Private Key Validation Missing
**Severity:** 🟢 **LOW**  
**File:** `play.mjs:99`  
**Issue:** No validation that private key is valid hex format.

### L3. Loss Tracking Precision
**Severity:** 🟢 **LOW**  
**Issue:** Loss limits checked in CLAWD units but compared with floating-point values.

---

## Informational Issues

### I1. No Reentrancy Consideration
The ClawFomo contract calls are external, but the bot doesn't implement reentrancy guards. While low risk due to the contract structure, worth noting.

### I2. Hardcoded Constants
Contract addresses and game parameters are hardcoded. Consider configuration file for different deployments.

### I3. No Transaction Nonce Management
In high-frequency scenarios, could encounter nonce conflicts.

---

## Loss Limit Analysis

The bot implements multiple loss limits, but they can be bypassed:

1. ✅ **Round Loss Limit** (`maxRoundLoss`) - Works correctly
2. ✅ **Session Loss Limit** (`maxTotalLoss`) - Works for bidding logic
3. ❌ **Approval Bypass** (C1) - Unlimited approval bypasses all limits
4. ❌ **Slippage Bypass** (H1) - Cost increases can exceed `maxBidClawd`

**Actual Maximum Loss:** Entire wallet balance (due to unlimited approval)

---

## Recommendations

### Immediate Fixes (Required)
1. **Fix C1**: Replace `maxUint256` with session-limited approvals
2. **Fix H1**: Add slippage protection with re-checks before execution
3. **Fix H2**: Validate timer edge cases properly

### Security Improvements
1. Implement RPC failover for reliability
2. Add gas estimation buffers
3. Improve round transition handling
4. Add transaction nonce management

### Testing Recommendations
1. Test with timer = 0, negative values, and very large values
2. Test rapid round transitions
3. Test network congestion scenarios
4. Test with malicious frontrunning

---

## Risk Summary

| Severity | Count | Impact |
|----------|-------|--------|
| 🔴 Critical | 1 | Total fund loss |
| 🔶 High | 2 | Loss limit bypass |
| 🟡 Medium | 3 | Degraded performance |
| 🟢 Low | 3 | Minor issues |
| ℹ️ Info | 3 | Code quality |

**Recommendation:** 🚫 **DO NOT DEPLOY** until Critical and High issues are resolved.