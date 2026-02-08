# 04 — Security & Access Control Audit

**Auditor:** Security Subagent  
**Date:** 2025-01-31  
**Scope:** `server.mjs`, `basename-registrar.mjs`, `deploy-token.mjs`, `launch.mjs` + Clanker V4 on-chain permissions  
**Severity Scale:** 🔴 Critical | 🟠 High | 🟡 Medium | 🟢 Low | ℹ️ Informational

---

## Executive Summary

The Agent Launchpad has a sound architecture — fee addresses are hardcoded, API keys stay server-side, and Clanker's on-chain contracts are non-upgradeable. However, there are several exploitable gaps: **no rate limiting** on any endpoint, **no paymaster spend caps**, **weak input validation**, and a **reward admin attack vector** that could redirect protocol fees post-deploy.

**Critical findings: 2 | High: 3 | Medium: 4 | Low: 2**

---

## Finding 1 — Reward Admin Hijack: Malicious Agent Redirects Protocol Fees

**Severity:** 🔴 Critical  
**Category:** Access Control  
**Files:** `server.mjs` → `deployToken()`, Clanker V4 ClankerFeeLocker

### Description

In `server.mjs`, the reward configuration for the **agent's share** sets the agent's own address as both `admin` and `recipient`:

```js
rewards: [
  {
    admin: admin,        // Agent controls their own reward slot
    recipient: admin,
    allocation: AGENT_ALLOCATION,  // 75%
    rewardsToken: "Both",
  },
  {
    admin: PROTOCOL_FEE_ADDRESS,   // Protocol controls its own slot
    recipient: PROTOCOL_FEE_ADDRESS,
    allocation: PROTOCOL_ALLOCATION, // 25%
    rewardsToken: "Paired",
  },
]
```

Per Clanker docs: *"Admin addresses can change the recipient address but allocation percentages are immutable."*

**This is correctly configured** — each party is admin of only their own reward slot. The protocol's 25% allocation is admin'd by `PROTOCOL_FEE_ADDRESS`, so the agent cannot change the protocol's recipient.

**However**, there is a separate attack vector: What if a malicious caller sets `body.admin` to `PROTOCOL_FEE_ADDRESS` (our protocol address)? Then the deploy would create:

```js
rewards: [
  { admin: "0x0D9945F0...", recipient: "0x0D9945F0...", allocation: 75 },  // "agent" slot = our address
  { admin: "0x0D9945F0...", recipient: "0x0D9945F0...", allocation: 25 },  // protocol slot
]
```

Both slots point to our address. This isn't directly harmful to *us* (we'd get 100%), but it means:
- Someone deploys a token where our address is the `tokenAdmin`
- Our protocol account now has admin control of a token we didn't intend to manage
- If our protocol key is compromised, the attacker could leverage admin rights on all such tokens

### Recommendation

Validate that `body.admin !== PROTOCOL_FEE_ADDRESS`:

```js
if (body.admin.toLowerCase() === PROTOCOL_FEE_ADDRESS.toLowerCase()) {
  return { status: 400, body: { error: 'Cannot use protocol address as agent admin' } };
}
```

---

## Finding 2 — Malicious Contract as Admin: Auto-Claim Fee Drain

**Severity:** 🔴 Critical  
**Category:** On-Chain Attack Vector

### Description

The API accepts any `0x` address as `admin` with no validation beyond format. Per ClankerFeeLocker docs:

> *"Anyone is able to trigger the `claim()` function to transfer fees from the fee locker to the user's address."*

A malicious actor could:
1. Deploy a smart contract that, on receiving fees, immediately swaps and redirects them
2. Pass that contract address as `admin` and `recipient`
3. The contract auto-claims fees via a bot or built-in automation

**This is by design for the agent's 75%** — they control their share. But the concern is:

- The `tokenAdmin` (set to `body.admin`) controls token metadata updates
- If the tokenAdmin is a malicious contract, it could update the token's metadata to phishing content
- Combined with our protocol branding ("launched via Agent Launchpad"), this creates reputational risk

### Recommendation

- Consider maintaining an allowlist of approved agent addresses, or
- Require agents to sign a message proving they control the admin address (not just a random contract), or
- At minimum, log all launches with admin addresses for post-hoc review

---

## Finding 3 — Zero Rate Limiting: Token Spam & Paymaster Drain

**Severity:** 🟠 High  
**Category:** Denial of Service / Resource Exhaustion  
**Files:** `server.mjs` (HTTP server)

### Description

The server has **zero rate limiting**. Nothing stops an attacker from:

1. **Launching 1000 tokens per minute** — Each `POST /api/launch` triggers a Clanker API call + basename registration. This could:
   - Exhaust our Clanker API key rate limits (getting us banned)
   - Drain CDP paymaster credits (basenames cost real ETH)
   - Create thousands of spam tokens associated with our platform

2. **Basename spam** — Each registration costs ~0.001 ETH paid by our paymaster. At scale, an attacker could drain significant credits.

The `LAUNCHPAD_API_KEY` is marked "Optional" and may not be set:

```js
if (ENV.LAUNCHPAD_API_KEY) {
  const key = req.headers['x-api-key'];
  if (key !== ENV.LAUNCHPAD_API_KEY) { /* reject */ }
}
// If LAUNCHPAD_API_KEY is not set, ALL requests pass through
```

### Recommendation

1. **Make API key mandatory**, not optional
2. Add per-IP and per-API-key rate limiting:
   ```js
   const rateLimit = new Map(); // ip -> { count, resetTime }
   const MAX_LAUNCHES_PER_HOUR = 5;
   ```
3. Add per-admin-address rate limiting (one token per address per hour)
4. Add a daily spend cap for the CDP paymaster

---

## Finding 4 — No Request Body Size Limit

**Severity:** 🟠 High  
**Category:** Denial of Service  
**File:** `server.mjs`

### Description

The request body is accumulated without any size limit:

```js
let body = '';
for await (const chunk of req) body += chunk;
```

An attacker can send a multi-gigabyte request body, consuming all server memory (OOM kill).

### Recommendation

```js
let body = '';
let size = 0;
const MAX_BODY = 1024 * 1024; // 1MB
for await (const chunk of req) {
  size += chunk.length;
  if (size > MAX_BODY) {
    res.writeHead(413);
    return res.end(JSON.stringify({ error: 'Request too large' }));
  }
  body += chunk;
}
```

---

## Finding 5 — API Key Exposure Assessment

**Severity:** 🟡 Medium  
**Category:** Secret Management  
**Files:** `server.mjs`, `deploy-token.mjs`, `launch.mjs`

### Description

**Good news:** The Clanker API key is used exclusively server-side. It is:
- Loaded from env vars or `~/.axiom/wallet.env`
- Sent only in outgoing requests to `clanker.world/api/`
- Never included in any response body

**Leakage paths identified:**

1. **Error responses from Clanker may echo request data.** The server forwards raw Clanker errors:
   ```js
   return { success: false, error: data };  // `data` is whatever Clanker returns
   ```
   If Clanker ever echoes the `x-api-key` header in error responses, it would leak to the client.

2. **Console logging** — The server logs request details to stdout. If stdout is captured by a monitoring service, keys could be exposed.

3. **CORS is fully open:** `Access-Control-Allow-Origin: *` means any website can make requests to the API. Combined with no mandatory API key, any webpage could trigger launches.

### Recommendation

1. Sanitize Clanker error responses before forwarding:
   ```js
   return { success: false, error: data?.error || 'Deploy failed' };
   ```
2. Restrict CORS to known origins
3. Never log request headers

---

## Finding 6 — CDP Smart Account Key Protection

**Severity:** 🟡 Medium  
**Category:** Secret Management  
**Files:** `basename-registrar.mjs`, `launch.mjs`

### Description

The protocol account's credentials are loaded from:
- `~/.axiom/wallet.env` — contains `CDP_API_KEY_ID`, `CDP_API_KEY_SECRET` (PEM), `CDP_WALLET_SECRET`
- `~/.agent-launchpad/credentials.env` (fallback)

**Concerns:**

1. **`launch.mjs` also loads `FUNDING_WALLET_KEY`** (a raw private key) and falls back to `NET_PRIVATE_KEY`. If this key is Axiom's main wallet private key, it's a single point of failure — compromise means losing all funds.

2. **No file permission checks** — the code doesn't verify that `wallet.env` has restrictive permissions (should be `chmod 600`).

3. **Protocol account state** is stored in `~/.agent-launchpad/protocol-account.json` as plaintext. This contains the CDP smart account address — not a secret per se, but could be used for targeted attacks.

4. **`saveProtocolAccount()`** has a bug — it uses `await import('fs')` inside a sync function context, but `mkdirSync` is already imported at the top. This would throw at runtime if the directory doesn't exist.

### Recommendation

1. Use a dedicated hot wallet with minimal funds for `FUNDING_WALLET_KEY`, never the main wallet
2. Add `chmod 600` verification on credential files
3. Fix the `saveProtocolAccount` import bug
4. Consider using a hardware wallet or multi-sig for the protocol fee address

---

## Finding 7 — Input Validation Gaps

**Severity:** 🟡 Medium  
**Category:** Injection / Data Integrity  
**File:** `server.mjs`

### Description

The server validates:
- ✅ `name` is present
- ✅ `admin` is a valid `0x` + 40 hex chars

The server does **NOT** validate:
- ❌ `name` length (could be 100KB of text)
- ❌ `symbol` content/length
- ❌ `description` content/length
- ❌ `image` URL (no URL validation, could be `javascript:alert(1)` or data URIs)
- ❌ `socialUrl` (same)
- ❌ `chainId` (accepts any number, though Clanker would reject invalid ones)

**Injection risks:**
- `name`/`symbol`/`description` are passed directly to Clanker's API and stored on-chain as token metadata. While on-chain storage limits the blast radius, any frontend rendering this metadata could be vulnerable to XSS if they don't sanitize.
- The `basename` parameter is sanitized via `name.toLowerCase().replace(/[^a-z0-9]/g, '')` — this is good.

### Recommendation

```js
// Add to handleLaunch():
if (body.name.length > 64) return { status: 400, body: { error: 'Name too long (max 64)' } };
if (body.symbol && body.symbol.length > 10) return { status: 400, body: { error: 'Symbol too long (max 10)' } };
if (body.description && body.description.length > 1000) return { status: 400, body: { error: 'Description too long' } };
if (body.image && !body.image.match(/^https?:\/\//)) return { status: 400, body: { error: 'Image must be HTTPS URL' } };
```

---

## Finding 8 — Zero Address Admin (Bricking)

**Severity:** 🟡 Medium  
**Category:** Input Validation  
**File:** `server.mjs`

### Description

The admin address regex `^0x[a-fA-F0-9]{40}$` accepts `0x0000000000000000000000000000000000000000`. If someone sets admin to the zero address:

1. `tokenAdmin = 0x0` — Token metadata can never be updated
2. `rewards[0].admin = 0x0` — The agent's 75% reward recipient can never be changed
3. `rewards[0].recipient = 0x0` — 75% of fees are permanently sent to the burn address

The protocol's 25% is unaffected (our admin is hardcoded), but **75% of all LP fees are permanently burned**. This is wasteful but not directly harmful to us.

However, it creates a griefing vector — someone could launch tokens with recognizable names (e.g., "Agent Launchpad Official") with bricked admin, making our platform look dysfunctional.

### Recommendation

```js
if (body.admin === '0x0000000000000000000000000000000000000000') {
  return { status: 400, body: { error: 'Cannot use zero address as admin' } };
}
```

---

## Finding 9 — Paymaster Drain via Basename Spam

**Severity:** 🟠 High  
**Category:** Resource Exhaustion  
**File:** `basename-registrar.mjs`

### Description

Each basename registration costs real ETH (~0.001 ETH for a 1-year registration), sponsored by our CDP paymaster. With no rate limiting:

- **100 requests = ~0.1 ETH ($280)**
- **10,000 requests = ~10 ETH ($28,000)**

The `findAndRegister` function tries up to 5 candidates per request, meaning one API call could trigger 5 on-chain transactions (if earlier candidates fail with "taken" errors, the function continues).

Additionally, the name generation includes random suffixes:
```js
`${clean}${Math.floor(Math.random() * 999)}` // always available
```

This means the attacker can always get a successful registration — names with random numbers are unlikely to be taken.

### Recommendation

1. **Daily registration cap**: Max 50 basenames per day
2. **Per-address limit**: One basename per admin address
3. **Require deposit or verification** before sponsoring a basename
4. **Monitor paymaster balance** with alerts at threshold levels

---

## Finding 10 — Fee Split Inconsistency Across Files

**Severity:** 🟢 Low  
**Category:** Configuration Integrity

### Description

Fee splits are inconsistent across the codebase:

| File | Agent | Protocol | Bankr |
|------|-------|----------|-------|
| `server.mjs` | 75% | 25% | — |
| `deploy-token.mjs` | 75% (default) | 25% (default) | — |
| `launch.mjs` | 60% | 20% | 20% |
| Server comment | "20% of all LP fees" | — | — |

The API server (`server.mjs`) uses a 75/25 split with no Bankr allocation, while the CLI script (`launch.mjs`) uses 60/20/20. This means tokens deployed via different paths have different fee structures.

### Recommendation

Centralize fee configuration in a single `config.mjs` file imported by all scripts. Decide on one canonical split.

---

## Finding 11 — `saveProtocolAccount` Runtime Bug

**Severity:** 🟢 Low  
**Category:** Code Quality  
**File:** `basename-registrar.mjs`

### Description

```js
function saveProtocolAccount(data) {
  const dir = join(homedir(), '.agent-launchpad');
  if (!existsSync(dir)) {
    const { mkdirSync } = await import('fs');  // ❌ await in non-async function
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(STATE_FILE, JSON.stringify(data, null, 2));
}
```

`await` is used inside a non-async function. This will throw a runtime error when the `~/.agent-launchpad/` directory doesn't exist (first-time setup). `mkdirSync` is not imported at the top level either — `fs` named imports at the top include `readFileSync`, `writeFileSync`, `existsSync` but not `mkdirSync`.

### Recommendation

```js
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";

function saveProtocolAccount(data) {
  const dir = join(homedir(), '.agent-launchpad');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(data, null, 2));
}
```

---

## On-Chain Permissions Summary (Clanker V4)

Based on the Clanker documentation, here's what each role can do post-deploy:

| Action | Who Can Do It | Notes |
|--------|---------------|-------|
| Change reward **recipient** | Reward slot `admin` | Each slot's admin is independent |
| Change reward **allocation %** | Nobody | Immutable at deploy time |
| Change `tokenAdmin` | Unknown (not documented) | Likely immutable |
| Claim fees | Anyone | `claim()` is permissionless |
| Update token metadata | `tokenAdmin` | Name, image, description |
| Upgrade contracts | Nobody | All Clanker contracts are non-upgradeable |
| Change protocol fee split | Nobody | Allocation is immutable |

**Key insight:** Our protocol's 25% allocation is safe because:
1. Allocation percentages are immutable on-chain
2. Our reward slot's admin is `PROTOCOL_FEE_ADDRESS` (we control it)
3. The agent's admin can only change the *recipient* of their own slot, not ours

---

## Recommended Priority Actions

### Immediate (Before Production)
1. 🔴 **Make `LAUNCHPAD_API_KEY` mandatory** — remove the optional check
2. 🔴 **Add rate limiting** — per-IP, per-API-key, and per-admin-address
3. 🟠 **Add request body size limit** (1MB max)
4. 🟠 **Add paymaster daily spend cap** and monitoring alerts
5. 🟠 **Block zero address** and protocol address as admin

### Short-Term (First Week)
6. 🟡 **Sanitize Clanker error responses** before returning to client
7. 🟡 **Add input length validation** for name/symbol/description
8. 🟡 **Restrict CORS** to known frontend origins
9. 🟡 **Fix `saveProtocolAccount` bug**
10. 🟡 **Unify fee split configuration** across all scripts

### Medium-Term
11. Consider address verification (signed message) before launch
12. Add launch logging/audit trail to a persistent store
13. Add monitoring dashboard for paymaster balance and launch velocity
14. Consider a separate hot wallet for funding (not main wallet key)
