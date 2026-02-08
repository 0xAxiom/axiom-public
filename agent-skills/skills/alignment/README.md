# Alignment 🎯

> Clanker fee burn pipeline for agents — no private keys needed!

The Alignment skill implements the complete Clanker fee burn pipeline using **Bankr API** instead of private keys. Any agent with a Bankr API key can run this pipeline to claim fees, rebalance assets, burn tokens, and send proceeds to treasury.

## Quick Start

```bash
# Install dependencies
npm install

# Set your Bankr API key
export BANKR_API_KEY="your_api_key_here"

# Run the pipeline
node alignment.mjs \
  --token 0xYourClankerTokenAddress \
  --treasury 0xYourTreasuryAddress
```

## What It Does

The Alignment pipeline executes these steps **in exact order**:

1. **🎯 Claim Fees** — Claims WETH + token fees from Clanker contract
2. **💰 Price Assets** — Gets WETH price from CoinGecko, token from DexScreener  
3. **⚖️ Rebalance** — Swaps to achieve 50/50 value balance (only the gap)
4. **🔥 Burn Tokens** — Sends ALL token balance to burn address
5. **🏦 Treasury Split** — Converts WETH to 50% USDC + 50% BNKR → treasury
6. **📊 Report** — JSON summary with all transaction details

## Key Features

- ✅ **No private keys** — uses Bankr API for secure transaction signing
- ✅ **Automatic wallet detection** — gets your address from Bankr
- ✅ **Dry-run mode** — simulate before executing
- ✅ **Complete error handling** — retries, fallbacks, clear messages
- ✅ **V4 swap support** — rebalances via Uniswap V4 pools
- ✅ **Step-by-step logging** — see exactly what's happening

## The Philosophy

**Keep the fee tokens. Top them up. Don't dump them.**

The rebalance step only swaps the VALUE difference between WETH and tokens. If you have $1100 WETH and $1000 worth of tokens, we only swap $50 WETH→tokens. This creates:

- **Small buy pressure** (good for token price)
- **Maintains token holdings** (you keep accumulating)
- **Perfect 50/50 balance** before the burn
- **Maximum burn impact** since you burn ALL tokens

## Installation

```bash
# Clone or download the skill
cd alignment/

# Install dependencies
npm install

# Make wrapper script executable
chmod +x scripts/alignment.sh
```

## Usage Examples

### Basic Run
```bash
node alignment.mjs \
  --token 0xf3ce5ddaab6c133f9875a4a46c55cf0b58111b07 \
  --treasury 0x19fe674a83e98c44ad4c2172e006c542b8e8fe08 \
  --bankr-key YOUR_API_KEY
```

### Using Environment Variable
```bash
export BANKR_API_KEY="your_key_here"
node alignment.mjs --token 0x... --treasury 0x...
```

### Dry Run (Recommended First!)
```bash
node alignment.mjs \
  --token 0x... \
  --treasury 0x... \
  --dry-run
```

### Using Wrapper Script
```bash
./scripts/alignment.sh --token 0x... --treasury 0x...
```

### Custom V4 Pool Settings
```bash
node alignment.mjs \
  --token 0x... \
  --treasury 0x... \
  --hooks 0xCustomHooksAddress \
  --fee 0x1000000 \
  --tick-spacing 100
```

## Configuration

### Environment Variables
```bash
BANKR_API_KEY=your_bankr_api_key
BASE_RPC_URL=https://mainnet.base.org  # optional
```

### Command Line Arguments
- `--token` (required) — Clanker token address
- `--treasury` (required) — Where to send USDC + BNKR
- `--bankr-key` — API key (or use env var)
- `--currency0` — V4 pool currency0 (default: WETH)
- `--fee` — V4 pool fee (default: 0x800000)
- `--tick-spacing` — V4 tick spacing (default: 200)
- `--hooks` — V4 hooks address (default: Clanker hooks)
- `--dry-run` — Simulate without real transactions

## How Bankr Integration Works

Instead of requiring your private key, the skill uses Bankr's secure API:

1. **Get Wallet Address**: Uses `/agent/sign` endpoint to discover your wallet
2. **Submit Transactions**: All TXs go through `/agent/submit` with encoded calldata
3. **Wait for Confirmation**: Bankr handles gas, nonces, confirmation waiting
4. **Error Handling**: Clear error messages if transactions fail

This means:
- ✅ Your private key never leaves Bankr's secure environment
- ✅ Any agent with Bankr access can run this pipeline
- ✅ No wallet setup, no gas management, no nonce tracking
- ✅ Enterprise-grade transaction security

## Example Output

```bash
🎯 Clanker Alignment Pipeline (Bankr Edition)
══════════════════════════════════════════════════════
Token: 0xf3ce5ddaab6c133f9875a4a46c55cf0b58111b07
Treasury: 0x19fe674a83e98c44ad4c2172e006c542b8e8fe08
Wallet: 0x523Eff3dB03938eaa31a5a6FBd41E3B9d23edde5
══════════════════════════════════════════════════════

📋 Step 1: Claim Fees
══════════════════════════════════════════════════════
💰 Available fees:
   WETH: 0.0521
   TOKEN: 15420.531

⏳ Claiming WETH fees via Bankr...
   ✅ https://basescan.org/tx/0x...

📊 Step 2: Get Prices
══════════════════════════════════════════════════════
💵 Prices:
   WETH: $2428.50
   Token: $0.00798

⚖️  Step 3: Rebalance to 50/50
══════════════════════════════════════════════════════
💰 Current holdings:
   WETH: 0.0521 ($126.43)
   TOKEN: 15420.531 ($123.04)

📐 Rebalance calculation:
   Total value: $249.47
   Target each: $124.74
   Gap: $3.39
   Swap needed: $1.70
   Direction: WETH → TOKEN

⏳ Executing V4 swap via Bankr...
   ✅ https://basescan.org/tx/0x...

🔥 Step 4: Burn Tokens
══════════════════════════════════════════════════════
🪙 Token balance: 16089.442 TOKEN

⏳ Burning 16089.442 TOKEN via Bankr...
   ✅ https://basescan.org/tx/0x...

🏦 Step 5: Treasury Split
══════════════════════════════════════════════════════
💰 WETH balance: 0.0513
   Splitting into 2x 0.02565 WETH

⏳ Swapping 0.02565 WETH → USDC via Bankr...
   ✅ https://basescan.org/tx/0x...

⏳ Swapping 0.02565 WETH → BNKR via Bankr...
   ✅ https://basescan.org/tx/0x...

📊 Step 6: Final Report
══════════════════════════════════════════════════════
{
  "fees_claimed": {
    "weth": "0.0521",
    "token": "15420.531",
    "weth_usd": "126.43",
    "token_usd": "123.18"
  },
  "rebalance": {
    "swapped_amount": "0.0007",
    "direction": "WETH→TOKEN",
    "tx_hash": "0x..."
  },
  "burned": {
    "amount": "16089.442",
    "tx_hash": "0x..."
  },
  "treasury": {
    "usdc_amount": "62.15",
    "usdc_tx": "0x...",
    "bnkr_amount": "1847.32",
    "bnkr_tx": "0x..."
  },
  "total_burned_to_date": "8420691.331",
  "burn_percentage": "8.4207%"
}

✅ Alignment pipeline complete! 🎯
```

## Troubleshooting

### "No fees to claim"
Your wallet address has no pending fees for this token. Check:
- You're using the correct token address
- Your wallet has fee ownership for this Clanker token
- Fees have actually accrued since last claim

### "Transaction failed"
Check the Bankr API response. Common issues:
- Insufficient gas funds in your Bankr wallet
- Network congestion causing timeouts
- Invalid token contract (not a real Clanker token)

### "Price not found"
Token isn't listed on DexScreener yet. For new tokens:
- Wait for some trading volume to appear
- Verify token address is correct
- Check if there's a Uniswap pool for the token

### "V4 swap failed"
The V4 pool might not exist or have enough liquidity:
- Try with different pool parameters
- Check if a V3 pool exists instead
- Verify the hooks address is correct

## Architecture

- **alignment.mjs** — Main pipeline script with Bankr integration
- **scripts/alignment.sh** — Wrapper script for easy config sourcing
- **package.json** — Dependencies (viem, yargs, no ethers)
- **SKILL.md** — OpenClaw skill documentation
- **README.md** — This file!

## Security Notes

- Your private key never leaves Bankr's secure infrastructure
- All transactions are signed server-side by Bankr
- RPC calls for reading blockchain state use public endpoints
- Input validation prevents malformed addresses/amounts
- Dry-run mode lets you verify before executing

## Contributing

This skill follows the pattern from the original `clanker-burn` skill but adapts it for Bankr API usage. When contributing:

1. Preserve the exact pipeline order
2. Keep all Bankr API calls consistent
3. Maintain error handling and retry logic
4. Test thoroughly with dry-run mode first

## License

MIT — Use freely for any agent or automation needs!