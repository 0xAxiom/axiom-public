---
name: bankr-airdrop
description: Daily pro rata token airdrop to NFT holders on Base. Use when claiming Clanker fees, snapshotting NFT holders, or distributing tokens proportionally by NFT holdings. Triggers on "airdrop", "holder snapshot", "pro rata distribution", "claim and distribute".
---

# Pro Rata NFT Holder Airdrop

Daily pipeline: snapshot NFT holders with balances, claim fees, distribute tokens proportionally by NFT holdings. Holders with more NFTs get proportionally more.

## Configuration

Set these for your project before running:

| Variable | Description | Example |
|----------|-------------|---------|
| `NFT_CONTRACT` | Your NFT collection contract on Base | `0x9fab...ce82` |
| `TOKEN_CONTRACT` | Token to distribute | `0xf3ce...1b07` |
| `TREASURY_ADDRESS` | Where WETH/USDC portion goes | `0x9A2A...581A` |
| `DISPERSE_CONTRACT` | Disperse.app on Base | `0xD152f549545093347A162Dce210e7293f1452150` |
| `CLANKER_TOKEN` | Same as TOKEN_CONTRACT (for harvest script) | `0xf3ce...1b07` |
| `HARVEST_WALLET` | Wallet that receives claimed fees | `0x523E...dde5` |

## Schedule

Two crons, back to back. Snapshot must complete before airdrop starts.

| Cron | Time | Purpose |
|------|------|---------|
| Holder snapshot | 5:58 PM daily | Scrape holders + NFT balances |
| Claim + airdrop | 6:00 PM daily | Claim fees, swap WETH, pro rata distribute tokens |

## Step 1: Holder Snapshot (5:58 PM)

```bash
NFT_CONTRACT=0xYOUR_NFT_CONTRACT python3 scripts/snapshot-bankr-holders.py
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

## Step 2: Claim Fees

Claim your token's fees from the Clanker vault (or whatever fee source your project uses). The claimed tokens go to your harvest wallet.

## Step 3: Swap WETH to Treasury

Swap any claimed WETH to USDC via Uniswap SwapRouter02 `0x2626664c2603336E57B271c5C0b26F421741e481` (fee tier 500). Send to your treasury.

**Slippage protection required:** Calculate `min_output = amount * eth_price * 0.98`. Never use 0.

## Step 4: Pro Rata Distribution

Read the snapshot JSON. Calculate each holder's share:

```
per_nft_amount = total_tokens / totalNfts
holder_amount  = holder_nft_count * per_nft_amount
```

- 1 NFT holder gets `1 * per_nft_amount`
- 5 NFT holder gets `5 * per_nft_amount`
- 27 NFT holder gets `27 * per_nft_amount`

**Floor all amounts** to avoid dust overflow. Remainder stays in wallet.

Distribute via `disperseToken()` on the Disperse contract. Approve first. Batch 150 addresses per TX.

## Adapting This Skill

1. Set your NFT contract and token addresses in the config above
2. Update `snapshot-bankr-holders.py` with your `NFT_CONTRACT`
3. Replace the fee claim step with your project's fee source
4. Set your treasury address for the WETH/USDC portion
5. Schedule the two crons 2 minutes apart

The pro rata math and disperse logic works for any ERC-721 + ERC-20 combination on Base.

## Safety

- NEVER send tokens to addresses not in the snapshot
- NEVER use 0 for swap slippage
- If snapshot is stale (>24h), re-run before distributing
- If token balance is 0 after claim, skip airdrop
