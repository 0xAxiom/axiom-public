# allowance-scanner

Scan ERC-20 token approvals for any wallet. Shows which contracts have permission to spend your tokens and how much. Zero dependencies — just Node.js 18+.

## Why

Every time you interact with a DEX, bridge, or DeFi protocol, you grant a token allowance. Many of these are unlimited. If a spender contract gets compromised, your entire token balance is at risk. This tool shows you what's exposed.

## Usage

```bash
# Scan a wallet on Base (default)
node allowance-scanner.mjs 0xYourWallet

# Scan on Ethereum
node allowance-scanner.mjs 0xYourWallet --chain ethereum

# Start from a specific block (faster for old wallets)
node allowance-scanner.mjs 0xYourWallet --from 15000000

# JSON output for scripting
node allowance-scanner.mjs 0xYourWallet --json
```

## Supported chains

- Base (default)
- Ethereum
- Arbitrum
- Optimism

## How it works

1. Fetches all `Approval(owner, spender, value)` events where the wallet is the owner
2. Deduplicates by token + spender pair
3. Checks current on-chain allowance state for each pair
4. Fetches token metadata (symbol, decimals, name)
5. Reports active, revoked, and unlimited approvals

## Output

```
--- ACTIVE APPROVALS (3) ---

  USDC (0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48)
    Spender: 0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45
    Amount:  UNLIMITED [HIGH RISK]
    Since block: 16234567

  WETH (0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2)
    Spender: 0x1111111254eeb25477b68fb85ed929f73a960582
    Amount:  1,000.0
    Since block: 17891234

--- SUMMARY ---
  Active approvals:    3
  Unlimited approvals: 1
  Revoked:             12
  Errors:              0
```

## License

MIT
