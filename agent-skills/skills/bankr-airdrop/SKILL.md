---
name: bankr-airdrop
description: Daily pro rata AXIOM airdrop to Bankr Club NFT holders on Base. Use when claiming Clanker fees, snapshotting NFT holders, or distributing tokens proportionally by NFT holdings. Triggers on "airdrop", "bankr club", "holder snapshot", "pro rata distribution", "claim and distribute".
---

# Bankr Club Pro Rata Airdrop

Daily pipeline: snapshot NFT holders with balances, claim Clanker fees, distribute AXIOM proportionally by NFT holdings. Holders with more NFTs get proportionally more.

## Overview

| Component | Details |
|-----------|---------|
| NFT Contract | `0x9fab8c51f911f0ba6dab64fd6e979bcf6424ce82` (Bankr Club, Base) |
| Token | AXIOM `0xf3ce5ddaab6c133f9875a4a46c55cf0b58111b07` |
| Disperse | `0xD152f549545093347A162Dce210e7293f1452150` |
| Treasury | Agent's hardware wallet (for WETH/USDC portion) |
| Chain | Base (8453) |

## Schedule

Run two crons back to back. Snapshot must complete before airdrop starts.

| Cron | Time | Purpose |
|------|------|---------|
| Holder snapshot | 5:58 PM PT daily | Scrape holders + NFT balances |
| Claim + airdrop | 6:00 PM PT daily | Claim fees, swap WETH, pro rata distribute AXIOM |

## Step 1: Holder Snapshot (5:58 PM)

```bash
python3 scripts/snapshot-bankr-holders.py
```

Scrapes Basescan holder table. Extracts each holder's address AND NFT quantity.

**Output:** `bankr-club-holders.json`
```json
{
  "date": "2026-02-12",
  "holders": {"0xaddr1": 5, "0xaddr2": 1, "0xaddr3": 27},
  "totalNfts": 999,
  "totalHolders": 734
}
```

Also writes flat `bankr-club-holders.txt` and dated snapshot to `bankr-holders-snapshots/`.

Excludes: zero address, dead address.

## Step 2: Claim Clanker Fees

Claim WETH + AXIOM fees from the Clanker vault for the token.

## Step 3: Swap WETH to Treasury

Swap WETH to USDC via Uniswap SwapRouter02 (fee tier 500). Send to treasury.

**Slippage protection required:** Calculate `min_output = amount * eth_price * 0.98`. Never use 0.

## Step 4: Pro Rata Distribution

Read the snapshot JSON. Calculate each holder's share:

```
per_nft_amount = total_axiom / totalNfts
holder_amount  = holder_nft_count * per_nft_amount
```

- 1 NFT holder gets `1 * per_nft_amount`
- 5 NFT holder gets `5 * per_nft_amount`
- 27 NFT holder gets `27 * per_nft_amount`

**Floor all amounts** to avoid dust overflow. Remainder stays in wallet.

Distribute via `disperseToken()` on the Disperse contract. Approve first. Batch 150 addresses per TX.

## Leaderboard Tools

Query Bankr leaderboard rankings and export wallets. See `scripts/bankr-leaderboard.mjs`:

```bash
# Top 100 rankings
node scripts/bankr-leaderboard.mjs --action rankings --count 100

# Export wallets for airdrop targeting
node scripts/export-wallets.mjs --count 200 --out ./wallets.csv
```

## Safety

- NEVER send tokens to addresses not in the snapshot
- NEVER use 0 for swap slippage
- If snapshot is stale (>24h), re-run before distributing
- If AXIOM balance is 0 after claim, skip airdrop
