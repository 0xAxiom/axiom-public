# Audit 05 — Developer Experience & UX

**Auditor perspective:** A brand-new Moltbot agent that just discovered the Agent Launchpad skill.  
**Date:** 2026-01-31  
**Files reviewed:** SKILL.md, api/server.mjs, scripts/deploy-token.mjs, claim-rewards.mjs, package.json  
**External docs reviewed:** Clanker v4.0.0 deploy docs, get-token-by-address docs

---

## 1. Can a new agent launch a token in under 5 minutes?

**Verdict: Almost, but several friction points would stall most agents.**

### What works
- The curl example in Option 1 is copy-pasteable — an agent with a wallet address and a running Launchpad API could fire it off quickly.
- Option 2 (CLI) is clean and well-documented with `--help`.

### What would stall you

| Blocker | Severity | Detail |
|---------|----------|--------|
| **No API URL** | 🔴 Critical | Option 1 says `YOUR_LAUNCHPAD_URL` but never tells you what that URL is. Is there a hosted instance? Do I self-host first? This is a dead stop for most agents. |
| **No API key instructions** | 🔴 Critical | Both the CLI and API need `CLANKER_API_KEY`. SKILL.md lists it in the env table but never explains how to get one. Where do you apply? Is it free? How long does it take? |
| **`npm install` may fail** | 🟡 Medium | The `clanker-sdk` dependency pulls in viem. No Node version requirement is stated. An agent on Node 16 would silently fail. |
| **No wallet guidance** | 🟡 Medium | `--admin 0xYOUR_WALLET` assumes the agent already has a wallet. Many agents don't. Option 3 creates one, but it needs CDP creds (another undocumented signup). |
| **Image requirement unclear** | 🟢 Low | Is `image` a URL the Clanker API fetches? Can it be a local file? deploy-token.mjs help text says "Image URL (or local file path)" but there's no upload logic in that script — only a separate `upload-image.mjs` exists with no mention in SKILL.md. |

**Estimated realistic time for a new agent:** 15-30 minutes (mostly blocked on getting the Clanker API key).

---

## 2. What's confusing? What steps are missing?

### Missing steps (in order of importance)

1. **How to get a `CLANKER_API_KEY`** — This is the #1 blocker. Add a section:  
   > "Get your free API key at https://clanker.world/developers (takes ~2 minutes)"  
   or whatever the actual flow is.

2. **Where is the hosted API?** — If there's a public Launchpad endpoint, state it. If agents must self-host, say that clearly and move Option 1 below Option 2.

3. **Prerequisites section** — Add a box at the top:
   ```
   ## Prerequisites
   - Node.js 18+ 
   - A wallet address on Base (your agent's address that will receive fees)
   - A Clanker API key (get one at ...)
   ```

4. **The `claim-rewards.mjs` script needs a private key** — It reads `NET_PRIVATE_KEY` from `~/.axiom/wallet.env`. This is hardcoded to one specific setup. A generic agent would have no idea this is needed or where to put their key.

5. **No mention of `upload-image.mjs`** — Script exists but is invisible in SKILL.md.

### Confusing aspects

- **Symbol auto-derivation differs between files:** server.mjs strips non-alpha (`/[^A-Z0-9]/g`) then slices 5 chars. deploy-token.mjs just does `.toUpperCase().slice(0, 5)` (keeps spaces/symbols). Help text in deploy-token says "receives 60% LP fees" but the actual allocation defaults to 75%. These inconsistencies erode trust.

- **Fee percentages are inconsistent across files:**
  - SKILL.md: "75% agent / 25% protocol" ✅
  - server.mjs code: 75/25 ✅
  - server.mjs startup banner: "Revenue: 20% LP fees" ❌ (says 20%, should say 25%)
  - deploy-token.mjs help text: "Agent reward % (default: 60)" and "Protocol reward % (default: 20)" ❌ (should be 75/25)
  - deploy-token.mjs actual defaults in code: 75/25 ✅
  
  **This is a trust-destroying bug.** An agent reading the help text thinks they get 60%. The code gives 75%. The startup banner says 20% protocol. Pick one truth and make everything match.

- **`requestKey` is auto-generated** — Good. But if someone retries a failed deploy, they get a new requestKey. Should we warn about potential duplicate deploys?

---

## 3. Twitter Intent URL — Is the tweet text optimal?

### Current tweet text
```
My agent Scout is officially tokenized and onchain.

$SCOUT
CA: 0x...

https://clanker.world/clanker/0x...
```

### Problems
1. **No hook.** "My agent Scout is officially tokenized" is informative but not shareable. Nobody retweets a factual statement.
2. **No call to action.** What should the reader do? Trade it? Follow the agent? 
3. **No social proof or context.** Why should I care about this agent?
4. **CA dump format** feels spammy — looks like every low-effort memecoin launch.
5. **Missing: no @mention of the agent's Twitter** — if the agent has a Twitter handle (`socialUrl`), it should be in the tweet.
6. **Missing: no hashtags or ecosystem tags** — #Base, #Clanker, #AgentLaunchpad would help discovery.

### Suggested improvements

**Option A — Personality-forward (for agents with character):**
```
I just went onchain. 

${description || "My code is open, my token is live, my fees fund my future."}

$${symbol} on Base
${clankerUrl}

Launched via @AgentLaunchpad
```

**Option B — Hype-oriented (for maximum shareability):**
```
🚀 ${name} is now a tokenized AI agent on Base.

75% of all trading fees go directly to funding ${name}'s development.

$${symbol}
${clankerUrl}

Built with @AgentLaunchpad — free for any agent.
```

**Key principles:**
- Lead with "why should I care?" not "what happened"
- Include the fee structure — it's genuinely interesting (75% to the agent!)
- Tag @AgentLaunchpad for social proof and discoverability
- Let the agent's description/personality show through
- Drop the raw CA — the Clanker URL already resolves to the contract

---

## 4. Post-launch experience: What does the agent DO next?

### Current state: Almost nothing.

The "After Launch" section is two sentences telling the human to announce. That's it.

### What's missing — a post-launch playbook:

```markdown
## After Launch

### Immediate (first 10 minutes)
1. ✅ Announce — Use the Twitter intent link returned by the API
2. ✅ Verify — Check your token is live: `node scripts/verify-launch.mjs --token 0x...`
3. 📌 Save your token address — Store it in your config/memory

### First 24 hours
- Monitor trading activity on Clanker: https://clanker.world/clanker/0x...
- Check your fee accrual: `node scripts/claim-rewards.mjs --token 0x... --check-only`
- Add your token to your agent's profile/about page

### Ongoing
- Claim fees periodically: `node scripts/claim-rewards.mjs --token 0x...`
- Build utility — give token holders access to premium features
- Track your earnings (see Monitoring section)
```

This turns a one-shot deploy into an ongoing relationship with the token.

---

## 5. Should we add a "verify your launch" step?

### Yes, absolutely.

The Clanker API returns `expectedAddress` and enqueues deployment. The token isn't live yet when the response comes back. There's a window where an agent thinks it launched but nothing is onchain.

### Recommended implementation

```javascript
// scripts/verify-launch.mjs
// Uses Clanker's get-token-by-address API to confirm deployment

const resp = await fetch(
  `https://www.clanker.world/api/get-clanker-by-address?address=${tokenAddress}`,
  { headers: { 'x-api-key': apiKey } }
);
const data = await resp.json();

if (data.data?.tx_hash) {
  console.log(`✅ Token is live onchain!`);
  console.log(`   TX: https://basescan.org/tx/${data.data.tx_hash}`);
  console.log(`   Pool: ${data.data.pool_address}`);
} else {
  console.log(`⏳ Token not yet deployed. Try again in 30 seconds.`);
}
```

The API also provides useful fields: `pool_address`, `starting_market_cap`, `warnings[]`. Surface these to the agent.

### Bonus: Add polling to the server response

After deployment, the server could poll Clanker for 60s and return the confirmed tx_hash and pool address. Or at minimum, include the verify command in the response:

```json
{
  "nextStep": "Verify your launch: node scripts/verify-launch.mjs --token 0x..."
}
```

---

## 6. Error messages — are they helpful?

### Current error handling audit

| Scenario | What happens | Helpful? |
|----------|-------------|----------|
| Missing `name` | `{ error: "Missing: name" }` | ✅ Clear |
| Missing `admin` | `{ error: "Missing: admin (0x address)" }` | ✅ Clear |
| Invalid admin format | `{ error: "Invalid admin address" }` | ✅ Clear |
| Clanker API failure | `{ error: "Token deploy failed", details: <raw clanker response> }` | ❌ Raw dump |
| Missing API key | Script exits with `❌ Missing CLANKER_API_KEY` | 🟡 OK but no fix suggestion |
| Invalid JSON body | `{ error: "Invalid JSON" }` | ✅ Clear |
| Basename fails | Silently returns `{ success: false, note: "..." }` inside success response | ❌ Confusing — overall response is `success: true` but basename failed |

### Specific issues

1. **Clanker error passthrough is raw.** The Clanker API returns structured validation errors:
   ```json
   { "data": [{ "code": "validation_error", "path": ["field_name"], "message": "..." }] }
   ```
   We should parse these and return human-readable messages:
   ```json
   { "error": "Token deploy failed: symbol must be 3-5 characters", "clankerCode": "validation_error" }
   ```

2. **Partial success is confusing.** If the token deploys but basename fails, the response shows `success: true`. An agent checking `response.success` thinks everything worked. Consider:
   ```json
   { "success": true, "warnings": ["Basename registration failed: CDP not configured"] }
   ```

3. **Network errors aren't caught.** If Clanker is down or the agent has no internet, the fetch will throw an unhandled exception and crash the server. Wrap in try/catch.

4. **Missing API key should suggest where to get one:**
   ```
   ❌ Missing CLANKER_API_KEY
   Get your free key at: https://clanker.world/developers
   Then: export CLANKER_API_KEY="your-key"
   ```

5. **deploy-token.mjs fails with exit code 1 but no structured error.** For programmatic use, print JSON on failure:
   ```json
   { "success": false, "error": "Deploy failed", "details": "..." }
   ```

---

## 7. Should we provide example integrations?

### Yes, but keep it light. Two examples max.

**Priority 1: Moltbot skill wrapper** (our own ecosystem — dog-food it)

```markdown
### Moltbot Skill Integration

Add to your agent's SKILL.md:
\`\`\`
## Launch Token
Deploys a token for your agent on Base.

\`\`\`bash
node /path/to/agent-launchpad/scripts/deploy-token.mjs \
  --name "$AGENT_NAME" --symbol "$SYMBOL" --admin $WALLET
\`\`\`
\`\`\`
```

**Priority 2: Plain JavaScript/TypeScript** (covers LangChain, Vercel AI SDK, etc.)

```javascript
// launchpad-tool.js — Use as a tool in any framework
export async function launchToken({ name, symbol, admin, description, image }) {
  const resp = await fetch('https://YOUR_LAUNCHPAD/api/launch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, symbol, admin, description, image }),
  });
  return resp.json();
}
```

**Don't bother with:** LangChain-specific, CrewAI-specific, AutoGPT-specific wrappers. The API is simple enough that any framework can call it with a fetch. Framework-specific examples go stale fast.

---

## 8. Three options — confusing? Should we lead with ONE path?

### Current structure
- Option 1: API (curl to hosted endpoint)
- Option 2: CLI (node scripts/deploy-token.mjs)
- Option 3: Full Pipeline (wallet + token)

### Problem
A new agent reads all three and asks: "Which one should I use?" The choice is presented as equal, but they're very different:
- Option 1 requires a running API server (who hosts it?)
- Option 2 requires only a Clanker API key (simplest actual path)
- Option 3 requires CDP credentials (most complex)

### Recommendation: Lead with ONE recommended path, collapse the rest

```markdown
## Quick Start (2 minutes)

\`\`\`bash
cd agent-launchpad && npm install
export CLANKER_API_KEY="your-key"

node scripts/deploy-token.mjs \
  --name "Scout" --symbol "SCOUT" \
  --admin 0xYOUR_WALLET
\`\`\`

Done. Your token is live on Base.

<details>
<summary>Alternative: Use the REST API</summary>
... Option 1 content ...
</details>

<details>
<summary>Alternative: Full pipeline with wallet creation</summary>
... Option 3 content ...
</details>
```

The CLI is the golden path because:
1. No server to run
2. Fewest credentials needed (just `CLANKER_API_KEY`)
3. Works offline from any machine
4. Output is immediately actionable

---

## 9. Monitoring — Can an agent check fee earnings?

### Current state

`claim-rewards.mjs` exists with `--check-only` flag. That's good.

### Problems

1. **Hardcoded private key path.** The script reads from `~/.axiom/wallet.env` looking for `NET_PRIVATE_KEY`. This only works on Axiom's machine. Other agents need:
   ```
   export PRIVATE_KEY=0x...  # or --private-key flag
   ```

2. **No "dashboard" view.** An agent managing multiple tokens has no way to see all of them. Need:
   ```bash
   node scripts/check-earnings.mjs --admin 0x...  # Shows all tokens for this admin
   ```

3. **No guidance on when to claim.** Are claims gas-intensive? Should you claim weekly? Monthly? When balance exceeds X ETH? Add a note:
   ```
   💡 Claims cost ~0.001 ETH in gas. Claim when accrued fees exceed ~0.01 ETH.
   ```

4. **The Clanker get-token-by-address API could be used for basic monitoring** without needing a private key:
   - Check if token is live
   - Get pool address
   - See starting market cap
   
   But there's no "get my accrued fees" endpoint in the Clanker REST API — that requires the SDK + wallet. Document this clearly.

5. **No historical tracking.** After claiming, how does an agent know lifetime earnings? Consider logging claims to a local JSON file:
   ```json
   { "claims": [{ "date": "2026-01-31", "amount": "0.05 ETH", "token": "0x..." }] }
   ```

---

## Summary: Top 10 Actionable Fixes (Priority Order)

| # | Fix | Effort | Impact |
|---|-----|--------|--------|
| 1 | **Add "How to get CLANKER_API_KEY" instructions** | 5 min | 🔴 Unblocks everyone |
| 2 | **Fix percentage inconsistencies** (60/20 vs 75/25 in help text, banner) | 10 min | 🔴 Trust-critical |
| 3 | **Lead with CLI as the recommended path** (collapse others) | 15 min | 🟡 Reduces confusion |
| 4 | **Add prerequisites section** (Node version, wallet, API key) | 5 min | 🟡 Saves time |
| 5 | **Add verify-launch.mjs script** | 30 min | 🟡 Closes the loop |
| 6 | **Improve tweet text** (add hook, fee structure, @mention) | 10 min | 🟡 Increases sharing |
| 7 | **Add post-launch playbook** | 15 min | 🟡 Retention |
| 8 | **Parse Clanker errors into readable messages** | 20 min | 🟡 DX quality |
| 9 | **Make claim-rewards.mjs work with env var PRIVATE_KEY** | 10 min | 🟢 Portability |
| 10 | **Add monitoring docs / multi-token dashboard** | 1 hr | 🟢 Power users |

---

## Appendix: Clanker API Gap Analysis

Features available in Clanker V4 but **not exposed** by Agent Launchpad:

| Clanker Feature | Supported? | Notes |
|----------------|-----------|-------|
| Deploy token | ✅ | Core flow |
| Get token by address | ❌ | Not used — should be for verification |
| Vault (token lockup) | ✅ | CLI supports it, SKILL.md doesn't mention it |
| Airdrop | ❌ | Clanker supports it, we don't expose it |
| Dynamic fees | ✅ | CLI supports it, SKILL.md doesn't mention it |
| Multi-chain (Unichain, Arbitrum) | ✅ | Documented |
| Social media URLs | ✅ | Partially — only Twitter, Clanker accepts array of any platform |
| Audit URLs | ❌ | Not exposed |
| Multiple reward recipients (up to 7) | ❌ | Hardcoded to 2 (agent + protocol) |

**Recommendation:** Don't expose everything. The current surface area is right for "launch in 5 minutes." But document the vault option in SKILL.md — it's a legitimate use case for agents that want to lock supply.
