---
name: bankr-airdrop
description: Daily pro rata token airdrop to Bankr Club NFT holders on Base. Agents distribute their native token to Bankr Club holders proportionally by NFT holdings. Triggers on "airdrop", "bankr club", "holder snapshot", "pro rata distribution", "claim and distribute".
---

# Pro Rata Bankr Club Airdrop

Distribute your agent's native token to Bankr Club NFT holders daily, proportional to how many NFTs each holder owns. Holders with more NFTs get more of your token.

## How It Works

Bankr Club NFT contract: `0x9fab8c51f911f0ba6dab64fd6e979bcf6424ce82` (Base)

Every agent using this skill:
1. Claims their daily Clanker fees (WETH + their native token)
2. Sends WETH side to their treasury
3. Airdrops their native token side to all Bankr Club holders, pro rata by NFT count

This aligns every agent's token with Bankr Club holders. More NFTs = more rewards from every participating agent.

## Configuration

Set these for your agent:

| Variable | Description | Example |
|----------|-------------|---------|
| `TOKEN_CONTRACT` | Your agent's native token on Base | `0xf3ce...1b07` |
| `TREASURY_ADDRESS` | Where your WETH/USDC portion goes | `0x9A2A...581A` |
| `HARVEST_WALLET` | Wallet that receives claimed fees | `0x523E...dde5` |

The NFT contract and Disperse contract (`0xD152f549545093347A162Dce210e7293f1452150`) are the same for everyone.

## Schedule

| Cron | Time | Purpose |
|------|------|---------|
| Holder snapshot | 5:58 PM PT daily | Scrape Bankr Club holders + NFT balances |
| Claim + airdrop | 6:00 PM PT daily | Claim fees, swap WETH, pro rata distribute your token |

## Step 1: Holder Snapshot (5:58 PM)

```bash
python3 scripts/snapshot-bankr-holders.py
```

Scrapes Basescan for all Bankr Club NFT holders and their quantities. Same snapshot for every agent.

**Output:** `bankr-club-holders.json`
```json
{
  "date": "2026-02-12",
  "holders": {"0xaddr1": 5, "0xaddr2": 1, "0xaddr3": 27},
  "totalNfts": 999,
  "totalHolders": 734
}
```

## Step 2: Claim Your Fees

Claim your token's fees from the Clanker vault. You'll receive WETH + your native token.

## Step 3: WETH to Treasury

Swap claimed WETH to USDC via Uniswap SwapRouter02 (fee tier 500). Send to your treasury.

**Slippage protection required:** `min_output = amount * eth_price * 0.98`. Never use 0.

## Step 4: Pro Rata Distribution

Read the snapshot JSON. Distribute your native token:

```
per_nft_amount = your_total_tokens / totalNfts
holder_amount  = holder_nft_count * per_nft_amount
```

- 1 NFT holder gets `1x`
- 5 NFT holder gets `5x`
- 27 NFT holder gets `27x`

**Floor all amounts** to avoid dust overflow. Remainder stays in wallet.

Distribute via `disperseToken()` on Disperse contract. Approve first. Batch 150 addresses per TX.

## Why This Matters

Every agent that adopts this skill creates a new revenue stream for Bankr Club holders. The more agents that align, the more valuable holding Bankr Club NFTs becomes. One NFT collection, many agent token rewards.

## Safety

- NEVER send tokens to addresses not in the snapshot
- NEVER use 0 for swap slippage
- If snapshot is stale (>24h), re-run before distributing
- If token balance is 0 after claim, skip airdrop
