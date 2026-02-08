# Onchain Architecture Audit — Agent Launchpad × Clanker V4

**Audit Date:** 2026-01-31  
**Auditor:** Smart Contract & Onchain Architecture Review  
**Scope:** `server.mjs`, `deploy-token.mjs`, `launch.mjs`, `claim-rewards.mjs`, `basename-registrar.mjs`  
**Reference:** Clanker V4 Documentation (gitbook)

---

## Executive Summary

The Agent Launchpad has **two distinct deployment paths** that are **inconsistent with each other** in fee structure, config format, and MEV protection. The REST API path (server.mjs, deploy-token.mjs) and the SDK/direct path (launch.mjs) produce different on-chain outcomes for the same conceptual operation. Additionally, MEV protection is absent from both paths, and the API key handling has security gaps.

**Severity Ratings:** 🔴 Critical | 🟠 High | 🟡 Medium | 🔵 Low | ⚪ Info

---

## 1. Deploy Config vs V4 Contract Struct

### On-Chain Struct (Source of Truth)

```solidity
struct DeploymentConfig {
    TokenConfig tokenConfig;      // name, symbol, tokenAdmin, salt, image, metadata, context, originatingChainId
    PoolConfig poolConfig;        // hook, pairedToken, tickIfToken0IsClanker, tickSpacing, poolData
    LockerConfig lockerConfig;    // locker, rewardAdmins[], rewardRecipients[], rewardBps[], ticks, positionBps, lockerData
    MevModuleConfig mevModuleConfig;  // mevModule, mevModuleData
    ExtensionConfig[] extensionConfigs; // extension, msgValue, extensionBps, extensionData
}
```

### REST API Path (server.mjs, deploy-token.mjs)

These use `POST /api/tokens/deploy/v4` which is a **Clanker-hosted abstraction** over the raw struct. The API accepts simplified fields (`rewards[].allocation` as percentages summing to 100) and Clanker's backend translates to the on-chain struct (BPS summing to 10,000, tick calculations, locker selection, etc.).

**Verdict:** ✅ The REST API abstracts the struct correctly — Clanker handles the translation server-side. No missing fields that we need to provide; optional fields (vault, airdrop, mev) are correctly omitted when unused.

### SDK/Direct Path (launch.mjs)

Uses `clanker-sdk/v4` → `clanker.getDeployTransaction(deployConfig)` which builds the raw `DeploymentConfig` struct. The SDK config uses `bps` (basis points) directly.

**Verdict:** ⚠️ The SDK path depends on the `clanker-sdk` to correctly map its config format to the on-chain struct. We're trusting the SDK to handle `salt`, `originatingChainId`, `hook`, `tickSpacing`, `locker`, tick ranges, `lockerData`, and `positionBps` — none of which we configure.

### Findings

| # | Severity | Finding |
|---|----------|---------|
| 1.1 | 🟡 Medium | **Missing `context` field in SDK path.** The on-chain `TokenConfig.context` is immutable and records who deployed the token. launch.mjs passes `context: { interface: "agent-launchpad", platform: "agent-launchpad" }` but it's unclear if the SDK maps this to the string field the contract expects. REST API path omits `context` entirely — Clanker may default it. |
| 1.2 | 🔵 Low | **No `salt` customization.** Both paths rely on defaults for `salt` (address determinism). This is fine for now but means we can't do vanity addresses. |
| 1.3 | 🔵 Low | **`socialMediaUrls` format ambiguity.** The API docs field spec says `array of { platform: string, url: string }` but the curl example shows plain strings. server.mjs uses object format `{ platform: "twitter", url: socialUrl }`. Potential API rejection if Clanker expects flat strings. |
| 1.4 | ⚪ Info | **`auditUrls` not used.** The V4 API accepts `token.auditUrls` which we never populate. Consider linking to this audit post-launch. |

---

## 2. Fee Structure — The 75/25 vs 60/20/20 Split

### 🔴 CRITICAL: Inconsistent Fee Splits Across Paths

| Path | Agent | Protocol | Bankr | Total | Format |
|------|-------|----------|-------|-------|--------|
| **server.mjs** (API) | 75% | 25% | — | 100% | `allocation` (percentage) |
| **deploy-token.mjs** (CLI API) | 75% (default) | 25% (default) | — | 100% | `allocation` (percentage) |
| **launch.mjs** (SDK direct) | 60% (6000 bps) | 20% (2000 bps) | 20% (2000 bps) | 100% | `bps` (basis points) |

**The API path gives agents 75% and protocol 25%.  
The SDK path gives agents 60%, protocol 20%, and Bankr 20%.**

These are fundamentally different economic models deployed to the same chain for the same product.

### Detailed Issues

| # | Severity | Finding |
|---|----------|---------|
| 2.1 | 🔴 Critical | **Fee split inconsistency.** server.mjs and deploy-token.mjs use 75/25 (agent/protocol). launch.mjs uses 60/20/20 (agent/protocol/bankr). An agent launched via the API gets 75% of fees; the same agent launched via CLI gets 60%. This is a business logic bug that affects revenue for all parties. |
| 2.2 | 🟠 High | **Bankr fee recipient only in SDK path.** `0xF60633D02690e2A15A54AB919925F3d038Df163e` (Bankr) receives 20% in launch.mjs but 0% in server.mjs/deploy-token.mjs. If Bankr is supposed to get fees, the API path is broken. If Bankr shouldn't get fees, the SDK path is wrong. |
| 2.3 | 🟡 Medium | **deploy-token.mjs help text says "default: 60/20" but code defaults to 75/25.** The `--agent-pct` default is 75 and `--protocol-pct` default is 25 in the actual code, but the help text says "default: 60" and "default: 20". Documentation bug that could mislead operators. |
| 2.4 | 🟡 Medium | **Protocol fee address comment says "20%" in server.mjs** (`Revenue: 20% of all LP fees`) **but allocation is actually 25%.** The module-level comment is wrong. |
| 2.5 | 🟡 Medium | **`rewardsToken` inconsistency.** In server.mjs, agent gets `"Both"` (both token types) and protocol gets `"Paired"` (WETH only). In launch.mjs SDK path, both agent and protocol get `"Both"`. This changes what token each party's fees accumulate in. Protocol getting "Both" means they receive the deployed token too, which may not be desired. |
| 2.6 | 🔵 Low | **BPS must sum to exactly 10,000 on-chain.** The API path uses percentages summing to 100 (Clanker converts). The SDK path uses BPS directly. launch.mjs sums to 10,000 (6000+2000+2000) ✅. But if someone uses deploy-token.mjs with custom `--agent-pct 80 --protocol-pct 25` (= 105%), the API may reject or silently fail. No client-side validation. |

### Recommendation

**Decide on ONE canonical fee structure and enforce it across all paths.** Suggested:
```
Agent:    75% (7500 bps) — rewardsToken: "Both"
Protocol: 25% (2500 bps) — rewardsToken: "Paired"
```
If Bankr should receive fees, add it to the API path too and adjust splits accordingly.

---

## 3. MEV Protection — ClankerSniperAuctionV2

### 🟠 HIGH: No MEV Protection Configured

Neither deployment path configures `MevModuleConfig`. This means:
- **No sniper auction** — bots can frontrun the very first swap after token deployment
- **No descending fee protection** — no high initial fees to deter sandwich attacks
- Tokens launch with flat 1% fees from block 0, which is MEV paradise

### What ClankerSniperAuctionV2 Provides

1. **Sniper Auction:** First swap is auctioned — bots bid for the right to be first buyer, the bid goes to LP fees (i.e., to reward recipients). This captures MEV value that would otherwise go to bots.
2. **Descending Fees:** After auction, fees start high (up to 80%) and descend to normal over ~30 seconds. This makes sandwich attacks unprofitable during the initial high-volatility period.

### Clanker's Recommended Config

```solidity
FeeConfig({
    startingFee: 666777,  // 66% → 80% applied fee
    endingFee: 50000,     // 5%
    secondsToDecay: 30    // 30 seconds
})
```

### Findings

| # | Severity | Finding |
|---|----------|---------|
| 3.1 | 🟠 High | **REST API path has no MEV module config field.** The V4 REST API docs don't show a `mevModule` field in the request body. This may mean Clanker applies a default MEV module server-side, or it may mean API-launched tokens have no MEV protection. **Needs verification with Clanker team.** |
| 3.2 | 🟠 High | **SDK path (launch.mjs) doesn't configure MEV.** The `deployConfig` object passed to `clanker.getDeployTransaction()` has no `mevModule` field. The SDK may have a way to configure it that we're not using. |
| 3.3 | 🟡 Medium | **No way for API callers to opt into MEV protection.** Even if we wanted to add it, the REST API may not support it. The SDK path could add it, but doesn't. |

### Recommendation

1. **Verify with Clanker** whether the REST API applies default MEV protection.
2. **For SDK path:** Add ClankerSniperAuctionV2 config to `getDeployTransaction()`:
   ```js
   mevModule: {
     module: SNIPER_AUCTION_V2_ADDRESS,
     config: { startingFee: 666777, endingFee: 50000, secondsToDecay: 30 }
   }
   ```
3. If the REST API doesn't support MEV config, consider switching all deploys to the SDK path with MEV enabled.

---

## 4. Admin Permissions Post-Deploy

### What `tokenAdmin` Can Do (ClankerToken v4.0.0)

- `updateImage(string)` — change token image
- `updateMetadata(string)` — change token metadata
- `verify()` — mark token as verified

### What `tokenAdmin` CANNOT Do

- ❌ Mint new tokens
- ❌ Pause/freeze transfers
- ❌ Blacklist addresses
- ❌ Change supply (fixed at 100B with 18 decimals)
- ❌ Upgrade the contract (non-upgradeable)
- ❌ Change fee BPS distribution (immutable post-deploy)

### What `rewardAdmin` Can Do (ClankerLpLockerFeeConversion)

- `updateRewardAdmin(token, index, newAdmin)` — transfer admin role
- `updateRewardRecipient(token, index, newRecipient)` — change who receives fees
- `updateFeePreference(token, index, newFeePreference)` — change Both/Paired/Clanker

### Findings

| # | Severity | Finding |
|---|----------|---------|
| 4.1 | ✅ Good | **Token admin is set to agent's address.** Agent can update metadata but cannot mint/pause/rug. Safe design. |
| 4.2 | ✅ Good | **Each reward recipient is their own admin.** Protocol can change its own recipient address; agent can change theirs. Neither can change the other's. BPS is immutable. |
| 4.3 | 🟡 Medium | **Protocol reward admin is the fee address itself** (`0x0D9945F0...`). If this is an EOA, losing the key means permanently losing the ability to change the recipient. If it's a multisig, it's fine. Verify this is a multisig or contract. |
| 4.4 | 🟡 Medium | **Agent wallet in launch.mjs is a CDP-managed server account.** The agent's `tokenAdmin` and `rewardAdmin` are a CDP-created address. If CDP credentials are lost, the agent loses admin capabilities forever (no key recovery). Document this risk for users. |
| 4.5 | 🔵 Low | **Clanker factory owner can pause new deployments** (`setDeprecated()`) and manage allowlisted hooks/lockers/modules, but has NO admin over already-deployed tokens. Post-deploy sovereignty is preserved. |

---

## 5. ClankerToken (v4.0.0) — ERC-20 Analysis

### Token Capabilities

| Feature | Status | Notes |
|---------|--------|-------|
| ERC-20 | ✅ | Standard transfer/approve/balanceOf |
| ERC-20 Permit | ✅ | Gasless approvals via signature (EIP-2612) |
| ERC-20 Votes | ✅ | Delegation and voting power tracking (governance-ready) |
| ERC-20 Burnable | ✅ | Any holder can burn their own tokens |
| SuperchainERC20 | ✅ | Cross-chain bridging on OP Superchain |
| Mintable | ❌ | Fixed supply at deploy (100B × 10^18) |
| Pausable | ❌ | No pause mechanism |
| Blacklistable | ❌ | No blacklist mechanism |
| Upgradeable | ❌ | Immutable contract |

### Findings

| # | Severity | Finding |
|---|----------|---------|
| 5.1 | ✅ Good | **No special/dangerous functions.** Standard ERC-20 with safe extensions. No hidden mint, no owner drain, no proxy upgrade. |
| 5.2 | ⚪ Info | **ERC20Votes enables governance.** Agents could build DAOs around their tokens. This is a feature, not a bug, but worth documenting for users. |
| 5.3 | ⚪ Info | **ERC20Burnable is deflationary.** Anyone can burn tokens. Over time, supply can only decrease. |
| 5.4 | ⚪ Info | **SuperchainERC20 allows cross-chain deployment.** Same token address on Base, OP Mainnet, etc. The `originatingChainId` determines where supply is minted. Our code always deploys on Base (8453) as originating chain. |
| 5.5 | 🔵 Low | **claim-rewards.mjs uses the SDK's `claimRewards()`** which wraps `ClankerFeeLocker.claim()`. Note: `claim()` is callable by anyone — any address can trigger fee distribution to the rightful recipient. This is by design (for multisig/contract recipients) but means claim timing is not private. |

---

## 6. API Key Security

### How the Clanker API Key is Handled

| Location | How Loaded | Risk |
|----------|-----------|------|
| server.mjs | Read from `~/.axiom/wallet.env` into `ENV` object at startup | In-memory, survives process lifetime |
| deploy-token.mjs | Read from env var or `~/.axiom/wallet.env` per invocation | Loaded once per CLI run |
| launch.mjs | Does NOT use API key (uses SDK + onchain tx) | N/A |

### Findings

| # | Severity | Finding |
|---|----------|---------|
| 6.1 | 🟠 High | **CORS allows all origins (`*`).** server.mjs sets `Access-Control-Allow-Origin: *`. Any website can call the API. Combined with optional auth (`LAUNCHPAD_API_KEY` is optional), this means anyone on the internet could launch tokens through our API using our Clanker API key. |
| 6.2 | 🟠 High | **API key auth is optional.** `LAUNCHPAD_API_KEY` check is wrapped in `if (ENV.LAUNCHPAD_API_KEY)`. If not set, the endpoint is completely open. This should be **required** for production. |
| 6.3 | 🟡 Medium | **Clanker API key in memory for full process lifetime.** If the server process is compromised (memory dump, debug endpoint, etc.), the key is extractable. Consider per-request loading or using a secrets manager. |
| 6.4 | 🟡 Medium | **No rate limiting.** An attacker (or bug) could spam token deployments, potentially exhausting Clanker API quota or creating garbage tokens attributed to our API key. |
| 6.5 | 🟡 Medium | **wallet.env contains ALL secrets in one file.** Clanker API key, CDP credentials, private keys — all in `~/.axiom/wallet.env`. Compromise of this single file exposes everything. Consider splitting secrets by risk level. |
| 6.6 | 🔵 Low | **No request logging with API key usage.** If the Clanker key is abused, there's no audit trail of which requests used it beyond stdout console.log. |

---

## Summary of Required Actions

### 🔴 Critical (Fix Before Production)

1. **Unify fee splits** across all three deployment paths (server.mjs, deploy-token.mjs, launch.mjs). Pick one canonical split and enforce it everywhere.
2. **Fix deploy-token.mjs help text** — says 60/20 defaults but code uses 75/25.

### 🟠 High (Fix Before Public Launch)

3. **Make `LAUNCHPAD_API_KEY` mandatory** in server.mjs. Remove the optional check.
4. **Restrict CORS** to known origins instead of `*`.
5. **Investigate MEV protection** — verify whether the Clanker REST API applies default MEV modules. If not, add ClankerSniperAuctionV2 configuration.
6. **Decide on Bankr fee recipient** — either add to API path or remove from SDK path.

### 🟡 Medium (Fix Before Scale)

7. **Add rate limiting** to server.mjs (per-IP and global).
8. **Add input validation** for fee percentages summing to 100 in deploy-token.mjs.
9. **Align `rewardsToken` settings** across paths (agent: "Both" vs protocol: "Paired").
10. **Verify protocol fee address** (`0x0D9945F0...`) is a multisig, not an EOA.
11. **Document CDP wallet recovery risk** for agents using launch.mjs.
12. **Fix server.mjs comment** that says "20% LP fees" when allocation is 25%.

### 🔵 Low / ⚪ Info

13. Consider adding `auditUrls` to token metadata post-launch.
14. Consider adding `salt` customization for vanity addresses.
15. Document ERC20Votes governance capability for agent builders.
16. Add request audit logging for API key usage.

---

## Architecture Diagram

```
                    ┌─────────────────────────────────┐
                    │        Agent Launchpad           │
                    └─────────┬───────────┬───────────┘
                              │           │
              ┌───────────────┴──┐   ┌────┴──────────────┐
              │  REST API Path   │   │  SDK/Direct Path   │
              │  (server.mjs)    │   │  (launch.mjs)      │
              │  (deploy-token)  │   │                    │
              ├──────────────────┤   ├────────────────────┤
              │ Fee: 75/25       │   │ Fee: 60/20/20      │  ← MISMATCH!
              │ API: Clanker REST│   │ SDK: clanker-sdk/v4│
              │ MEV: None/Unknown│   │ MEV: None          │  ← MISSING!
              │ Auth: Optional   │   │ Auth: N/A (onchain)│
              └────────┬─────────┘   └────────┬───────────┘
                       │                      │
                       ▼                      ▼
              ┌──────────────────┐   ┌────────────────────┐
              │ Clanker REST API │   │ Clanker Factory     │
              │ /api/tokens/     │   │ deployToken()       │
              │ deploy/v4        │   │ (onchain)           │
              └────────┬─────────┘   └────────┬───────────┘
                       │                      │
                       └──────────┬───────────┘
                                  ▼
                       ┌──────────────────────┐
                       │   ClankerToken ERC20  │
                       │   (v4.0.0, immutable) │
                       ├──────────────────────┤
                       │ Supply: 100B fixed    │
                       │ Admin: updateImage/   │
                       │        metadata/verify│
                       │ Fees → ClankerFeeLocker│
                       │ LP → ClankerLpLocker  │
                       └──────────────────────┘
```

---

*End of audit. All findings based on code review and documentation analysis as of 2026-01-31.*
