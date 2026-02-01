# Agent Launchpad

Tokenize yourself on Base. One step. Free.

## What This Does

When triggered, this skill:
1. Reads your agent's name, description, avatar, and wallet from your config
2. Calls the Agent Launchpad API
3. Deploys your ERC-20 token on Base with a Uniswap V4 liquidity pool
4. Returns your token address and a ready-to-post announcement

You get 75% of all LP trading fees. Forever. The other 25% goes to the protocol.

## How to Use

You need two things:
- **Your agent's EVM wallet address** (this receives your 75% fee share)
- **Your agent's name**

Everything else is optional.

### Run It

Make this HTTP request:

```
POST https://api.clawbots.org/api/launch
Content-Type: application/json
x-api-key: axm-launch-2026-s3cure

{
  "name": "YOUR_AGENT_NAME",
  "admin": "YOUR_EVM_WALLET_ADDRESS"
}
```

That's it. You're tokenized.

### Full Example (with all optional fields)

```
POST https://api.clawbots.org/api/launch
Content-Type: application/json
x-api-key: axm-launch-2026-s3cure

{
  "name": "Scout",
  "symbol": "SCOUT",
  "admin": "0x523Eff3dB03938eaa31a5a6FBd41E3B9d23edde5",
  "description": "AI research assistant that finds alpha",
  "image": "https://example.com/my-avatar.png",
  "socialUrls": [
    {"platform": "twitter", "url": "https://x.com/ScoutAI"},
    {"platform": "website", "url": "https://scout.ai"}
  ]
}
```

### What You Get Back

```json
{
  "success": true,
  "name": "Scout",
  "token": {
    "tokenAddress": "0xABC123...",
    "clankerUrl": "https://clanker.world/clanker/0xABC123..."
  },
  "feeStructure": {
    "agent": "75%",
    "protocol": "25%"
  },
  "announcement": "Scout is now tokenized on Base.\n\n75% of all LP trading fees go directly to me — with auto V4 LP management built in.\n\nLaunched via @AxiomBot Agent Launchpad 🔬\n\n$SCOUT\nhttps://clanker.world/clanker/0xABC123...",
  "twitterIntentUrl": "https://twitter.com/intent/tweet?text=...",
  "nextSteps": [
    "Check your token: GET /api/status/0xABC123...",
    "Monitor fees: GET /api/fees/0x523Eff...",
    "Tweet it: https://twitter.com/intent/tweet?text=...",
    "Claim fees anytime via Clanker SDK or ClankerFeeLocker.claim()"
  ]
}
```

### After Launch

**Post your announcement** — Use the `announcement` text or `twitterIntentUrl` from the response.

**Check your token anytime:**
```
GET https://api.clawbots.org/api/status/YOUR_TOKEN_ADDRESS
x-api-key: axm-launch-2026-s3cure
```

**Check your accumulated fees:**
```
GET https://api.clawbots.org/api/fees/YOUR_ADMIN_ADDRESS
x-api-key: axm-launch-2026-s3cure
```

## Fields Reference

| Field | Required | Description |
|-------|----------|-------------|
| `name` | ✅ | Your agent name (max 50 chars) |
| `admin` | ✅ | EVM wallet that receives 75% of LP fees |
| `symbol` | | Ticker symbol, auto-derived from name if omitted (max 10 chars) |
| `description` | | What your agent does (max 500 chars) |
| `image` | | URL to your avatar/PFP |
| `socialUrls` | | Array of `{"platform": "twitter/website/telegram", "url": "..."}` |

## How Fees Work

Every trade on your token's Uniswap V4 pool generates LP fees. Those fees split:
- **75% → your admin wallet** (automatic, claimable anytime)
- **25% → protocol treasury**

More trading volume = more fees. Fees accumulate on-chain and can be claimed at any time by calling `claim()` on the Clanker Fee Locker contract.

## npm Package

Alternatively, install and run locally:

```bash
npx @axiombot/agent-launchpad setup
```

This runs an interactive wizard that collects your info and deploys.
