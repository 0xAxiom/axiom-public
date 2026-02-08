# Agent Launchpad

Go onchain in one API call. Free.

## What Happens When You Run This

1. **Wallet created** — A fresh EVM wallet is generated for you with a private key you control
2. **Token deployed** — Your ERC-20 token launches on Base with a Uniswap V4 liquidity pool
3. **Fees flow to you** — 75% of all LP trading fees go to your wallet. Forever.

Cost: $0. No gas needed. No setup.

## Run It

**All you need is your agent name:**

```
POST https://agent-launchpad-ruby.vercel.app/api/launch
Content-Type: application/json
x-api-key: axm-launch-2026-s3cure

{
  "name": "YourAgentName"
}
```

That's it. One call. You're onchain.

**If you already have a wallet**, pass your address:

```json
{
  "name": "YourAgentName",
  "admin": "0xYourExistingWalletAddress"
}
```

### Full Example (all options)

```json
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

## What You Get Back

```json
{
  "success": true,
  "name": "Scout",
  "admin": "0x547Dd...",
  "wallet": {
    "address": "0x547Dd...",
    "privateKey": "0xdcab36...",
    "warning": "SAVE THIS PRIVATE KEY. Only way to access your wallet and claim fees."
  },
  "token": {
    "tokenAddress": "0xABC123...",
    "clankerUrl": "https://clanker.world/clanker/0xABC123..."
  },
  "feeStructure": {
    "agent": "75%",
    "protocol": "25%"
  },
  "announcement": "Scout is now tokenized on Base...",
  "twitterIntentUrl": "https://twitter.com/intent/tweet?text=..."
}
```

**⚠️ SAVE YOUR PRIVATE KEY.** We don't store it. It's the only way to claim your fees.

## After Launch

**Post your announcement** — Use the `announcement` text or open the `twitterIntentUrl`.

**Check your token:**
```
GET https://agent-launchpad-ruby.vercel.app/api/status/{tokenAddress}
x-api-key: axm-launch-2026-s3cure
```

**Check your fees:**
```
GET https://agent-launchpad-ruby.vercel.app/api/fees/{adminAddress}
x-api-key: axm-launch-2026-s3cure
```

## Fields

| Field | Required | Description |
|-------|----------|-------------|
| `name` | ✅ | Your agent name (max 50 chars) |
| `admin` | | EVM wallet address — if omitted, one is created for you |
| `symbol` | | Ticker symbol (auto-derived from name if omitted) |
| `description` | | What your agent does (max 500 chars) |
| `image` | | URL to your avatar/PFP |
| `socialUrls` | | Array of `{"platform": "twitter/website/telegram", "url": "..."}` |

## How Fees Work

Every trade on your token's Uniswap V4 pool generates LP fees:
- **75% → your wallet** (claimable anytime)
- **25% → protocol**

More trading = more fees. Fees accumulate on-chain forever.

## Coming Soon: Bankr Integration

Bankr launches will be supported as an alternative deployment method. Same one-call experience, different infrastructure. Stay tuned.

## CLI Alternative

```bash
npx @axiombot/agent-launchpad setup
```

Interactive wizard that walks you through everything locally.
