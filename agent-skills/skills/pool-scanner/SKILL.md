---
name: pool-scanner
description: Find Uniswap V2/V3 liquidity pools for any token on Base or Ethereum — reserves, pricing, TVL
version: 1.0.0
tags: [defi, uniswap, liquidity, pools, pricing, base, ethereum]
author: Axiom
---

# pool-scanner

Find all Uniswap V2 and V3 liquidity pools for a given token. Reports reserves, pricing, fee tiers, and concentrated liquidity state.

## When to use

- Evaluating a new token's liquidity depth before buying or providing liquidity
- Finding the best pool to route a swap through
- Checking if a token has any on-chain liquidity at all
- Agent tooling: let agents assess token tradability before executing trades
- Quick price discovery without an API key

## Usage

```bash
node pool-scanner.mjs <token-address> [options]
```

### Options

| Flag | Description |
|------|-------------|
| `--chain <base\|mainnet>` | Chain to scan (default: base) |
| `--v2-only` | Only scan Uniswap V2 pools |
| `--v3-only` | Only scan Uniswap V3 pools |
| `--json` | Output as JSON |

### Examples

```bash
# Find all pools for AXIOM on Base
node pool-scanner.mjs 0xf3Ce5d55c1602F3370A3E3C7a03431e40A311F48

# Find DEGEN pools, JSON output
node pool-scanner.mjs 0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed --json

# Scan Ethereum for UNI pools, V3 only
node pool-scanner.mjs 0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984 --chain mainnet --v3-only
```

## What it checks

- **Uniswap V2**: Queries the factory's `getPair()` for each quote token, then reads reserves
- **Uniswap V3**: Queries all 4 fee tiers (0.01%, 0.05%, 0.3%, 1%) for each quote token, reads `slot0` for pricing and `liquidity` for depth
- **Quote tokens scanned**: WETH, USDC, USDbC, DAI (Base) or WETH, USDC, USDT, DAI (mainnet)
- Results sorted by quote-side reserves (deepest liquidity first)

## Output

Human-readable table showing pool type, address, price, reserves, and liquidity. Use `--json` for structured output suitable for piping into other tools.

## Dependencies

None. Uses `eth_call` against public RPCs.
