# pool-scanner

Find Uniswap V2/V3 liquidity pools for any token on Base or Ethereum. Zero dependencies.

Reports reserves, pricing, fee tiers, and concentrated liquidity depth for every pool found against WETH + major stablecoins.

## Quick start

```bash
node pool-scanner.mjs 0xf3Ce5d55c1602F3370A3E3C7a03431e40A311F48
```

## Options

- `--chain base|mainnet` - Chain to scan (default: base)
- `--v2-only` / `--v3-only` - Filter pool type
- `--json` - Structured output

See [SKILL.md](SKILL.md) for full docs.
