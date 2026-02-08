# Audit 02: API Design & Integration

**Auditor:** Subagent (API Design & Integration)  
**Date:** 2026-01-31  
**Scope:** Agent Launchpad API ↔ Clanker authenticated endpoints  

---

## 1. Clanker Endpoint Coverage

### Currently Used
| Endpoint | Used? | Notes |
|----------|-------|-------|
| `POST /api/tokens/deploy/v4` | ✅ | Core deploy flow |

### NOT Used (Missing)
| Endpoint | Used? | Priority | Notes |
|----------|-------|----------|-------|
| `GET /api/get-clanker-by-address` | ❌ | **HIGH** | Token status, pool address, deploy config, warnings |
| `GET /api/get-estimated-uncollected-fees/:address` | ❌ | **HIGH** | Uncollected fees per recipient (v4 requires `rewardRecipientAddress` param) |
| `GET /api/tokens/estimate-rewards-by-pool-address` | ❌ | **LOW** | Legacy v3.1 only — docs explicitly say no v4 support coming. Skip for now. |
| `GET /api/tokens/fetch-by-admin` | ❌ | **MEDIUM** | List all tokens by admin wallet. Paginated, supports `includeMarket=true`. |

**Verdict:** We're using 1 of 5 authenticated endpoints. We should integrate 3 more (all except the legacy rewards endpoint).

---

## 2. Recommended New API Endpoints

### 2a. `GET /api/status/:tokenAddress` ⭐ HIGH PRIORITY

Combines `get-clanker-by-address` + `get-estimated-uncollected-fees` into one call.

**Why:** After launch, agents need to check "is my token live?" and "how much have I earned?" This is the single most useful post-launch endpoint.

```json
// GET /api/status/0x1234...
{
  "token": {
    "name": "Scout",
    "symbol": "SCOUT",
    "contractAddress": "0x...",
    "poolAddress": "0x...",
    "chainId": 8453,
    "deployedAt": "2025-04-15T00:16:35",
    "type": "clanker_v4",
    "startingMarketCap": 10,
    "clankerUrl": "https://clanker.world/clanker/0x...",
    "warnings": []
  },
  "fees": {
    "uncollected": {
      "token0": { "symbol": "SCOUT", "amount": "256188371342895862809729", "decimals": 18 },
      "token1": { "symbol": "WETH", "amount": "25549999999999", "decimals": 18 }
    },
    "lockerAddress": "0x...",
    "lpNftId": 1605020
  }
}
```

**Implementation notes:**
- Make both Clanker calls in parallel (`Promise.all`)
- For uncollected fees v4, we need to pass `rewardRecipientAddress` — accept it as query param, default to the agent's admin address
- Cache responses for ~30 seconds to avoid hammering Clanker

### 2b. `GET /api/tokens/:adminAddress` — MEDIUM PRIORITY

Wraps `fetch-by-admin`. Lists all tokens launched by a specific wallet.

```json
// GET /api/tokens/0xABCD...?includeMarket=true
{
  "tokens": [...],
  "total": 3,
  "cursor": null
}
```

**Why:** Agents that launch multiple tokens need a portfolio view. Pass through Clanker's pagination params (`limit`, `cursor`, `chainId`, `includeMarket`).

### 2c. `GET /api/fees/:tokenAddress` — MEDIUM PRIORITY

Dedicated uncollected fees endpoint. Useful for claim-rewards scripts and dashboards.

Accepts `?recipient=0x...` for v4 multi-recipient tokens. If omitted, query for both protocol and agent recipient addresses (requires knowing who they are — could store this at deploy time).

---

## 3. Deploy Endpoint Gaps

### 3a. Missing `context` / `social_context` Field — ⚠️ IMPORTANT

The Clanker `get-token-by-address` response includes a `social_context` field:
```json
{
  "interface": "Bankr",
  "messageId": "bankr deployment",
  "id": "886870",
  "platform": "Farcaster"
}
```

**Our deploy request does NOT set any context/attribution field.** This means tokens launched via Agent Launchpad will show no attribution on clanker.world. We should investigate if the deploy v4 endpoint accepts a `context` or `socialContext` field for interface attribution. If so, we should set:
```json
{
  "interface": "Agent Launchpad",
  "platform": "API"
}
```

**Action:** Test the deploy endpoint with a `context` field to see if it's accepted. Check if there's an undocumented parameter or if attribution is tied to the API key itself.

### 3b. Missing Deploy Parameters We Should Expose

| Parameter | Currently Used? | Should Expose? | Notes |
|-----------|----------------|----------------|-------|
| `token.auditUrls` | ❌ | Optional | Low priority, but free to add |
| `vault.percentage` | ❌ | **YES** | Token vaulting is important for credibility — lock supply |
| `vault.lockupDuration` | ❌ | **YES** | Min 7 days lockup |
| `vault.vestingDuration` | ❌ | **YES** | Linear vesting schedule |
| `airdrop.entries` | ❌ | Maybe | Complex, could be v2 feature |
| `fees.type: "dynamic"` | ❌ | Maybe | We hardcode static 1%/1% — could let agents choose |
| `pool.initialMarketCap` | Hardcoded 10 | Maybe | Some agents may want different starting mcap |

**Recommendation:** Add optional `vault` object to `/api/launch` request body. Token vaulting is a key trust signal and agents should be able to lock supply.

### 3c. `socialMediaUrls` Format Mismatch

Our code sends:
```js
socialMediaUrls: [{ platform: "twitter", url: socialUrl }]
```

Clanker docs show `socialMediaUrls` accepts an array of `{ platform: string, url: string }` objects, but the example also shows plain strings:
```json
"socialMediaUrls": ["https://x.com/demotoken", "https://t.me/demotoken"]
```

**Action:** Verify which format Clanker actually accepts. The docs show both — our object format may or may not work. Test with a plain string array as fallback.

---

## 4. API Response Completeness

### Current Response (from `/api/launch`)
```json
{
  "success": true,
  "name": "...",
  "admin": "0x...",
  "token": {
    "tokenAddress": "0x...",
    "requestKey": "...",
    "clankerUrl": "https://..."
  },
  "basename": { ... },
  "feeStructure": { ... },
  "twitterIntentUrl": "...",
  "announcement": "..."
}
```

### Missing Fields to Add
| Field | Why |
|-------|-----|
| `token.poolAddress` | Agents need this to check fees, provide trading links |
| `token.symbol` | Echo back the actual symbol used |
| `token.txHash` | Clanker returns this — useful for verification |
| `token.chainId` | Confirm which chain was deployed to |
| `token.deployedAt` | Timestamp of deployment |
| `token.dexScreenerUrl` | `https://dexscreener.com/base/{tokenAddress}` — agents want this |
| `token.uniswapUrl` | `https://app.uniswap.org/swap?outputCurrency={tokenAddress}&chain=base` |

**Critical gap:** The Clanker deploy response only returns `{ message, expectedAddress, success }`. We do NOT get `poolAddress` or `txHash` back from the deploy call. To get these, we'd need to poll `get-clanker-by-address` after deploy (deployment is async/enqueued).

**Recommendation:** 
1. Return what we have now, plus computed URLs (dexscreener, uniswap)
2. Add a note in response: `"note": "Token deployment is enqueued. Use GET /api/status/:address to check when live."`
3. Implement the `/api/status/:address` endpoint so agents can poll

---

## 5. Error Handling

### Current State: ⚠️ WEAK

| Scenario | Current Handling | Recommended |
|----------|-----------------|-------------|
| Clanker API down | Unhandled — `fetch()` will throw, 500 with stack trace | try/catch with meaningful error message |
| Clanker rate limit | Not handled | Check for 429 status, return `{ error: "Rate limited", retryAfter: N }` |
| Clanker validation error | Returned as raw `data` object | Parse and surface human-readable message |
| Network timeout | No timeout set | Add `AbortSignal.timeout(30000)` to fetch calls |
| Invalid Clanker API key | Returns opaque error | Check for 401/403, return `{ error: "Clanker API auth failed" }` |
| Duplicate requestKey | Unclear behavior | Document — does Clanker dedupe? |

### Recommended Error Response Format
```json
{
  "success": false,
  "error": "Human-readable error message",
  "code": "TOKEN_DEPLOY_FAILED",
  "details": { ... },
  "retryable": true
}
```

### Specific Fix for `deployToken()`
```js
// Current — no timeout, no error categorization
const resp = await fetch('https://www.clanker.world/api/tokens/deploy/v4', { ... });

// Recommended
const resp = await fetch('https://www.clanker.world/api/tokens/deploy/v4', {
  ...options,
  signal: AbortSignal.timeout(30000),
}).catch(err => {
  if (err.name === 'TimeoutError') throw new Error('Clanker API timeout');
  throw new Error(`Clanker API unreachable: ${err.message}`);
});

if (resp.status === 429) {
  const retryAfter = resp.headers.get('retry-after');
  return { success: false, error: 'Rate limited', retryAfter, retryable: true };
}
if (resp.status === 401 || resp.status === 403) {
  return { success: false, error: 'Clanker API authentication failed', retryable: false };
}
```

---

## 6. Security & Rate Limiting

### API Key Handling
| Issue | Severity | Notes |
|-------|----------|-------|
| `LAUNCHPAD_API_KEY` is optional | ⚠️ MEDIUM | If not set, API is wide open. Should **require** in production. |
| Timing-safe comparison missing | ⚠️ LOW | `key !== ENV.LAUNCHPAD_API_KEY` is vulnerable to timing attacks. Use `crypto.timingSafeEqual()`. |
| No key rotation mechanism | LOW | Single static key. Fine for now, but consider key management for multi-tenant. |
| Clanker API key in memory | LOW | Loaded once at startup — acceptable. Don't log it. |

### Rate Limiting — NOT IMPLEMENTED ⚠️
| Risk | Impact |
|------|--------|
| No rate limit on `/api/launch` | An attacker with the API key could spam-deploy thousands of tokens |
| No request size limit | Large POST bodies could DoS the server |
| No concurrent request limit | Multiple simultaneous deploys could hit Clanker rate limits |

**Recommended:** Add simple in-memory rate limiting:
```js
// Per API key: max 10 launches per hour
// Per admin address: max 5 launches per hour  
// Request body max: 10KB
// Global: max 100 launches per hour
```

### Input Validation Gaps
| Field | Current Validation | Missing |
|-------|-------------------|---------|
| `name` | Required check | Max length? Special chars? |
| `admin` | Regex `0x[a-fA-F0-9]{40}` | ✅ Good |
| `symbol` | None | Max length, allowed chars |
| `description` | None | Max length (Clanker may reject long ones) |
| `image` | None | URL validation, max length |
| `socialUrl` | None | URL validation |
| `chainId` | None | Whitelist: `[8453, 130, 42161]` |
| `basename` | None | Length, charset validation |

---

## 7. Architecture Recommendations

### 7a. Post-Deploy Tracking (NEW)

Currently: deploy and forget. No way to know if token actually deployed on-chain.

**Recommendation:** Store deploy records (requestKey → expectedAddress → admin) and provide a way to verify deployment status via `get-clanker-by-address`.

Options:
1. **Simple:** JSON file / SQLite for deploy records
2. **Stateless:** Just add the `/api/status/:address` endpoint and let clients poll

### 7b. Webhook / Callback Support

For agents that want to know when their token is live:
```json
{
  "name": "Scout",
  "admin": "0x...",
  "callbackUrl": "https://my-agent.com/webhook/token-live"
}
```

Low priority but nice for production integrations.

### 7c. Health Check Enhancement

Current `/health` returns basic info. Should also check:
- Clanker API reachability (cached, check every 60s)
- CDP/basename service status
- Last successful deploy timestamp

---

## Summary: Priority Actions

| # | Action | Priority | Effort |
|---|--------|----------|--------|
| 1 | Add `GET /api/status/:tokenAddress` endpoint | 🔴 HIGH | Medium |
| 2 | Add error handling (timeouts, rate limit detection, error codes) | 🔴 HIGH | Low |
| 3 | Add input validation (lengths, chainId whitelist, URL format) | 🟡 MEDIUM | Low |
| 4 | Add rate limiting (per-key, per-admin) | 🟡 MEDIUM | Low |
| 5 | Add `GET /api/tokens/:adminAddress` endpoint | 🟡 MEDIUM | Low |
| 6 | Expose `vault` options in deploy | 🟡 MEDIUM | Low |
| 7 | Investigate context/attribution field for clanker.world | 🟡 MEDIUM | Low |
| 8 | Return computed URLs (dexscreener, uniswap) in launch response | 🟢 LOW | Trivial |
| 9 | Use `crypto.timingSafeEqual()` for API key check | 🟢 LOW | Trivial |
| 10 | Add `GET /api/fees/:tokenAddress` endpoint | 🟢 LOW | Low |
| 11 | Require `LAUNCHPAD_API_KEY` in production mode | 🟢 LOW | Trivial |

---

## Clanker API Quirks & Notes

1. **Deploy is async/enqueued** — `POST /deploy/v4` returns `expectedAddress` but the token isn't live yet. Need to poll `get-clanker-by-address` to confirm.
2. **Estimated Rewards endpoint is v3.1 ONLY** — explicitly marked as legacy, no v4 support planned. Don't build on it.
3. **Uncollected Fees v4 requires `rewardRecipientAddress`** — for our tokens this is either the agent's admin address (75%) or protocol address (25%). We need to pass the right one.
4. **`fetch-by-admin` supports `includeMarket=true`** — returns price/mcap data. Very useful for dashboards.
5. **Rate limits are undocumented** — "Contact support for rate limit details." We should add defensive rate limiting on our side.
6. **`socialMediaUrls` format ambiguity** — docs show both object array and string array formats. Test both.
