# 🔥 Clanker Fee Burn

**Complete, production-ready Clanker fee burn pipeline.**

One command. No human intervention. Full automation from fee claim to burn to treasury.

## 🎯 What It Does

Executes a complete burn cycle:

1. **Claims fees** from Clanker contract (WETH + token)
2. **Gets prices** from CoinGecko and DexScreener
3. **Rebalances** to 50/50 value split (swaps only the gap)
4. **Burns** entire token balance to `0xdead`
5. **Splits WETH** → 50% USDC + 50% BNKR
6. **Sends to treasury**
7. **Reports** full results as JSON

## 🚀 Quick Start

```bash
# Install dependencies
npm install viem yargs @ethersproject/abi

# Set your private key
export NET_PRIVATE_KEY=0x...

# Dry run (simulate)
node burn.mjs \
  --token 0xf3ce5ddaab6c133f9875a4a46c55cf0b58111b07 \
  --treasury 0x19fe674a83e98c44ad4c2172e006c542b8e8fe08 \
  --dry-run

# Execute live
node burn.mjs \
  --token 0xf3ce5ddaab6c133f9875a4a46c55cf0b58111b07 \
  --treasury 0x19fe674a83e98c44ad4c2172e006c542b8e8fe08
```

## 📊 Output Example

```json
{
  "fees_claimed": {
    "weth": "0.05",
    "token": "1000000",
    "weth_usd": "125.50",
    "token_usd": "50.25"
  },
  "rebalance": {
    "swapped_amount": "0.015",
    "direction": "WETH→TOKEN",
    "tx_hash": "0x..."
  },
  "burned": {
    "amount": "1050000",
    "tx_hash": "0x..."
  },
  "treasury": {
    "usdc_amount": "62.75",
    "usdc_tx": "0x...",
    "bnkr_amount": "1250.50",
    "bnkr_tx": "0x..."
  },
  "total_burned_to_date": "5000000000",
  "burn_percentage": "5.0000%"
}
```

## 🛠️ CLI Reference

### Required Flags

- `--token` — Token address (Clanker token to burn)
- `--treasury` — Treasury address (receives USDC + BNKR)

### Optional Flags

- `--currency0` — V4 pool currency0 (default: WETH)
- `--fee` — V4 pool fee (default: `0x800000`)
- `--tick-spacing` — V4 pool tick spacing (default: `200`)
- `--hooks` — V4 pool hooks address (default: `0xb429d62f...`)
- `--dry-run` — Simulate without sending transactions

### Environment

```bash
NET_PRIVATE_KEY=0x...     # Required: Wallet private key
BASE_RPC_URL=https://...  # Optional: Base RPC endpoint
```

## 🔒 Safety Features

- ✅ **Dry run mode** — Test before executing
- ✅ **Step-by-step logging** — See exactly what happens
- ✅ **Transaction hashes** — Full audit trail
- ✅ **Error handling** — Stops immediately on failure
- ✅ **Never destructive** — Won't burn if rebalance fails

## 🧠 How It Works

### The Rebalance Logic

Instead of converting everything to USDC (which kills the token price), this script:

1. **Calculates USD value** of WETH fees and token fees
2. **Finds the gap** between the two sides
3. **Swaps only half the gap** to reach 50/50 value
4. **Burns ALL tokens** (creating buy pressure from the small swap)
5. **Splits remaining WETH** into USDC + BNKR for treasury

**Example:**
- Claimed: 0.1 WETH ($250) + 500,000 tokens ($50)
- Gap: $200 difference
- Swap: $100 worth of WETH → tokens (to balance)
- Result: ~$150 WETH + ~$150 tokens
- Burn: All 650,000 tokens → `0xdead`
- Treasury: Remaining WETH → 50% USDC + 50% BNKR

### Why This Matters

**Traditional approach (bad):**
- Sell all tokens → USDC
- Result: Price crashes, no burn

**This approach (good):**
- Small rebalance swap → buy pressure
- Burn all tokens → supply reduction
- Net effect: Price up + supply down

## 🏗️ Architecture

### Contracts Used

| Contract | Address | Purpose |
|----------|---------|---------|
| Clanker Fee Storage | `0xf3622742b1e446d92e45e22923ef11c2fcd55d68` | Fee claiming |
| Universal Router | `0x6ff5693b99212da76ad316178a184ab56d299b43` | V4 swaps (rebalance) |
| SwapRouter02 | `0x2626664c2603336E57B271c5C0b26F421741e481` | V3 swaps (USDC/BNKR) |
| Permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` | Approvals |

### V4 Pool Parameters

Default Clanker pool setup:
- **currency0:** `0x4200000000000000000000000000000000000006` (WETH)
- **currency1:** `<token>` (your Clanker token)
- **fee:** `0x800000` (dynamic fee)
- **tickSpacing:** `200`
- **hooks:** `0xb429d62f8f3bffb98cdb9569533ea23bf0ba28cc`

Override with CLI flags if your pool differs.

### V3 Pools

- **WETH/USDC:** `0xd0b53d9277642d899df5c87a3966a349a798f224` (0.05% fee)
- **WETH/BNKR:** `0xAEC085E5A5CE8d96A7bDd3eB3A62445d4f6CE703` (1% fee)

## 📝 Code Quality

- ✅ ES modules (`import/export`)
- ✅ Modern viem library
- ✅ Clean error handling
- ✅ Comprehensive logging
- ✅ Type-safe ABI interactions
- ✅ Minimal dependencies

## 🤝 Contributing

Found a bug? Want to add features?

1. Test with `--dry-run` extensively
2. Never skip the rebalance step
3. Maintain the small-swap philosophy
4. Add logging for new steps
5. Keep error messages clear

## 📜 License

MIT — Use freely, burn responsibly.

---

**Built with 🔥 for the Clanker ecosystem.**

Questions? Check `SKILL.md` for agent usage patterns.
