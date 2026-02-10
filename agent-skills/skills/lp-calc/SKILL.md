# LP Calculator & Validator

A CLI tool for calculating and validating Uniswap V4 liquidity position tick bounds. Prevents tick math errors that can cause failed LP mints by providing correct, validated tick calculations.

## Description

This tool takes a pool configuration and desired price range percentage, then outputs precise tick bounds ready for liquidity minting. It includes:

- **Correct tick math** using the fixed formula from Feb 10 incident
- **Automatic tick spacing alignment** to prevent invalid positions
- **On-chain data fetching** for current pool state
- **Comprehensive validations** with helpful warnings
- **Test mode** for offline calculations

## Prerequisites

- Node.js (v18+)
- Access to Base RPC endpoint (default: https://mainnet.base.org)

## Installation

```bash
cd /Users/melted/Github/axiom-public/agent-skills/skills/lp-calc
npm install
```

## Usage

### Basic Usage

```bash
# Calculate range for WETH/USDC pool with ±15% range
node scripts/lp-calc.mjs \
  --token0 0x4200000000000000000000000000000000000006 \
  --token1 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 \
  --range 15

# Using full pool key specification
node scripts/lp-calc.mjs \
  --pool-key "0x4200000000000000000000000000000000000006,0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913,3000,60,0x0000000000000000000000000000000000000000" \
  --range 10

# Override current tick (useful for simulations)
node scripts/lp-calc.mjs \
  --token0 0x4200000000000000000000000000000000000006 \
  --token1 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 \
  --range 20 \
  --current-tick 196423

# Use custom RPC endpoint
node scripts/lp-calc.mjs \
  --token0 0x4200000000000000000000000000000000000006 \
  --token1 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 \
  --range 15 \
  --rpc https://base-mainnet.g.alchemy.com/v2/YOUR_KEY
```

### Test Mode

Run calculations without requiring RPC access:

```bash
# Test mode with hardcoded values
node scripts/lp-calc.mjs --range 15 --test

# Test with verbose output to see intermediate math
node scripts/lp-calc.mjs --range 15 --test --verbose
```

### Command Line Options

- `--pool-key`: Full pool specification (currency0,currency1,fee,tickSpacing,hooks)
- `--token0` / `--token1`: Token addresses (simpler alternative to pool-key)
- `--range`: Desired range in percent (e.g., 15 for ±15%)
- `--tick-spacing`: Override tick spacing (auto-detected from fee by default)
- `--current-tick`: Override current tick (fetched from chain by default)
- `--rpc`: RPC URL (defaults to BASE_RPC_URL env or https://mainnet.base.org)
- `--test`: Use hardcoded test values (no RPC needed)
- `--verbose`: Show intermediate calculations

## Output Format

```json
{
  "currentTick": 196423,
  "currentPrice": "3245.67",
  "tickLower": 194000,
  "tickUpper": 198800,
  "priceLower": "2758.82",
  "priceUpper": "3732.52",
  "actualRangePercent": { "lower": 15.0, "upper": 15.0 },
  "tickSpacing": 200,
  "ticksInRange": 24,
  "warnings": []
}
```

## Common Scenarios

### 1. New Liquidity Position

Calculate optimal tick bounds for a new LP position:

```bash
# Conservative 20% range for AXIOM/WETH
node scripts/lp-calc.mjs \
  --token0 0xf3ce5ddaab6c133f9875a4a46c55cf0b58111b07 \
  --token1 0x4200000000000000000000000000000000000006 \
  --range 20
```

### 2. Position Rebalancing

Check if current position needs rebalancing:

```bash
# Tight 5% range for active management
node scripts/lp-calc.mjs \
  --token0 0x4200000000000000000000000000000000000006 \
  --token1 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 \
  --range 5 \
  --verbose
```

### 3. Range Validation

Validate existing tick bounds by checking warnings:

```bash
# Check if 30% range is too wide
node scripts/lp-calc.mjs \
  --token0 0x4200000000000000000000000000000000000006 \
  --token1 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 \
  --range 30
```

### 4. Fee Tier Comparison

Compare different fee tiers and their tick spacing:

```bash
# 0.05% fee tier (tight spacing)
node scripts/lp-calc.mjs \
  --pool-key "0x4200000000000000000000000000000000000006,0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913,500,10,0x0000000000000000000000000000000000000000" \
  --range 10

# 1% fee tier (wide spacing)  
node scripts/lp-calc.mjs \
  --pool-key "0x4200000000000000000000000000000000000006,0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913,10000,200,0x0000000000000000000000000000000000000000" \
  --range 10
```

## Known Pool Constants

- **WETH**: `0x4200000000000000000000000000000000000006`
- **USDC**: `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`
- **AXIOM**: `0xf3ce5ddaab6c133f9875a4a46c55cf0b58111b07`

### Fee Tiers & Tick Spacing

- 500 (0.05%) → tick spacing 10
- 3000 (0.3%) → tick spacing 60  
- 10000 (1%) → tick spacing 200
- 0x800000 (dynamic) → tick spacing 200

## Warnings Guide

- **ERROR**: Critical issues that will cause transaction failures
- **WARNING: Wide range**: Lower fee APR but safer against impermanent loss
- **WARNING: Tight range**: High IL risk, requires frequent rebalancing
- **WARNING: Current tick outside range**: Position may be immediately out of range

## Math Reference

The core formula used (corrected from Feb 10 incident):

```javascript
// Convert percentage to tick range  
const tickRange = Math.round(Math.log(1 + range/100) / Math.log(1.0001));

// Snap to tick spacing
const tickLower = Math.floor((currentTick - tickRange) / tickSpacing) * tickSpacing;
const tickUpper = Math.ceil((currentTick + tickRange) / tickSpacing) * tickSpacing;

// Convert tick to price
const price = 1.0001 ** tick;
```

## Troubleshooting

### "Failed to fetch pool state"

- Check RPC endpoint is accessible
- Verify pool exists and pool key is correct
- Try using `--test` mode for offline calculation

### "tickLower must be multiple of tickSpacing"

- This indicates a bug in the calculation logic
- The tool should automatically handle tick spacing alignment

### "Current tick is outside the specified range"

- Pool has moved significantly since calculation
- Consider wider range or fetch fresh data
- Use `--current-tick` to override with latest value