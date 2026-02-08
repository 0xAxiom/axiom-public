# Clanker Fee Burn Skill

**Purpose:** Automated end-to-end Clanker fee claim → rebalance → burn → treasury pipeline.

## What It Does

Executes a complete burn cycle for Clanker tokens in one command:

1. **Claims fees** — WETH + token from Clanker fee contract
2. **Gets prices** — WETH from CoinGecko, token from DexScreener
3. **Rebalances** — Swaps only the value difference to reach 50/50 WETH/token split
4. **Burns tokens** — Sends ALL token balance to 0xdead
5. **Treasury split** — Swaps remaining WETH 50/50 into USDC + BNKR, sends to treasury
6. **Reports** — JSON output with full pipeline results

## Usage

### Basic Command

```bash
node burn.mjs \
  --token 0xf3ce5ddaab6c133f9875a4a46c55cf0b58111b07 \
  --treasury 0x19fe674a83e98c44ad4c2172e006c542b8e8fe08
```

### With Custom Pool Parameters

```bash
node burn.mjs \
  --token 0xf3ce5ddaab6c133f9875a4a46c55cf0b58111b07 \
  --treasury 0x19fe674a83e98c44ad4c2172e006c542b8e8fe08 \
  --hooks 0xCustomHooksAddress \
  --fee 0x800000 \
  --tick-spacing 200
```

### Dry Run (Simulate)

```bash
node burn.mjs \
  --token 0xf3ce5ddaab6c133f9875a4a46c55cf0b58111b07 \
  --treasury 0x19fe674a83e98c44ad4c2172e006c542b8e8fe08 \
  --dry-run
```

## CLI Flags

| Flag | Required | Default | Description |
|------|----------|---------|-------------|
| `--token` | ✅ | — | Token address (Clanker token) |
| `--treasury` | ✅ | — | Treasury address for USDC+BNKR |
| `--currency0` | ❌ | `0x4200...0006` (WETH) | V4 pool currency0 |
| `--fee` | ❌ | `0x800000` | V4 pool fee (dynamic) |
| `--tick-spacing` | ❌ | `200` | V4 pool tick spacing |
| `--hooks` | ❌ | `0xb429d62f...` | V4 pool hooks address |
| `--dry-run` | ❌ | `false` | Simulate without sending TXs |

## Environment Variables

```bash
NET_PRIVATE_KEY=0x...     # Wallet private key
BASE_RPC_URL=https://...  # Base RPC endpoint (optional)
```

## Output

Prints a JSON report with:

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

## Error Handling

- **Stops immediately** if any step fails
- Prints what succeeded and what failed
- Never continues to burn if rebalance failed
- Never continues to treasury if burn failed
- Use `--dry-run` to test before live execution

## Critical Rules

⚠️ **DO NOT:**
- Convert fee tokens to WETH/USDC first — keep them and top up
- Convert everything to USDC as intermediate
- Swap more than the value difference

✅ **DO:**
- Only swap the small gap to reach 50/50 value
- Burn creates buy pressure (small swap) + removes supply
- Always test with `--dry-run` first

## When to Use

**Regular burn cycles:**
```bash
# Every week/month, claim fees and execute burn
node burn.mjs --token 0x... --treasury 0x...
```

**Pre-flight check:**
```bash
# Always dry-run first to verify amounts
node burn.mjs --token 0x... --treasury 0x... --dry-run
```

## Agent Instructions

When asked to "burn Clanker fees" or "run burn cycle":

1. **Verify environment** — Check `NET_PRIVATE_KEY` is set
2. **Dry run first** — Always simulate before live execution
3. **Review output** — Check amounts make sense
4. **Execute live** — Remove `--dry-run` flag
5. **Report results** — Share JSON output with human

### Example Agent Flow

```bash
# Step 1: Dry run
cd /Users/melted/Github/axiom-public/agent-skills/skills/clanker-burn
node burn.mjs --token 0xf3ce... --treasury 0x19fe... --dry-run

# Step 2: Review output, confirm with human

# Step 3: Execute live
node burn.mjs --token 0xf3ce... --treasury 0x19fe...

# Step 4: Share report JSON
```

## Dependencies

- `viem` — Ethereum interactions
- `yargs` — CLI parsing
- `@ethersproject/abi` — ABI encoding for V4 swaps

Install:
```bash
npm install viem yargs @ethersproject/abi
```

## Contracts Used

| Contract | Address | Purpose |
|----------|---------|---------|
| Clanker Fee | `0xf36227...` | Fee storage/claiming |
| WETH | `0x420000...0006` | Base WETH |
| USDC | `0x833589...` | Treasury asset |
| BNKR | `0xf3ce5d...` | Treasury asset |
| SwapRouter02 | `0x262666...` | V3 swaps (WETH→USDC/BNKR) |
| Universal Router | `0x6ff569...` | V4 swaps (rebalance) |
| Permit2 | `0x000000...78BA3` | Approvals for V4 |

## Troubleshooting

**"No fees to claim"**
- No fees available yet — wait for more volume

**"V4 swap reverted"**
- Check pool parameters (currency0, hooks, fee, tick-spacing)
- Verify pool has liquidity

**"Insufficient balance"**
- Fees were lower than expected — check claimed amounts

**Approvals failing**
- RPC issue — wait and retry
- Gas too low — increase gas limit

## Safety

- Uses `--dry-run` for safe testing
- Only burns tokens AFTER successful rebalance
- Only sends to treasury AFTER successful burn
- All steps logged with transaction hashes
- No destructive actions without confirmation in dry-run mode
