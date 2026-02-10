# lp-calc 📐

Uniswap V4 LP tick bound calculator and validator. Computes correct tick ranges from percentages using logarithmic math, validates against pool state, and previews positions before you spend gas.

## Why

Converting "±15% range" to valid V4 ticks requires logarithmic math. Linear approximation (`percent * 46054`) breaks above ±10% — the error at ±90% is thousands of ticks. This tool gets it right every time.

## Install

```bash
npm install
```

## Usage

```bash
# Live pool data from Base
node scripts/lp-calc.mjs \
  --token0 0x4200000000000000000000000000000000000006 \
  --token1 0xf3ce5ddaab6c133f9875a4a46c55cf0b58111b07 \
  --range 15

# Offline test mode
node scripts/lp-calc.mjs --range 15 --test

# Verbose intermediate math
node scripts/lp-calc.mjs --range 15 --test --verbose
```

## Output

```json
{
  "currentTick": 196423,
  "currentPrice": "3245.67",
  "tickLower": 194000,
  "tickUpper": 198800,
  "actualRangePercent": { "lower": 15.0, "upper": 15.0 },
  "tickSpacing": 200,
  "ticksInRange": 24,
  "warnings": []
}
```

## Core Math

```javascript
// Correct — logarithmic, accurate at any range
const tickRange = Math.round(Math.log(1 + range / 100) / Math.log(1.0001));

// Snap to tick spacing
const tickLower = Math.floor((currentTick - tickRange) / tickSpacing) * tickSpacing;
const tickUpper = Math.ceil((currentTick + tickRange) / tickSpacing) * tickSpacing;
```

## Options

| Flag | Description |
|------|-------------|
| `--token0`, `--token1` | Token addresses |
| `--range` | Desired range in percent (e.g., 15 for ±15%) |
| `--tick-spacing` | Override tick spacing |
| `--current-tick` | Override current tick |
| `--rpc` | RPC URL (default: Base mainnet) |
| `--test` | Offline mode with hardcoded values |
| `--verbose` | Show intermediate calculations |

## License

MIT
