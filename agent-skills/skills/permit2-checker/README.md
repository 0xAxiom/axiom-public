# permit2-checker

Inspect Uniswap Permit2 approvals for any wallet on Base or Ethereum. Zero dependencies.

## Why

Uniswap's [Permit2](https://github.com/Uniswap/permit2) contract (`0x000000000022D473030F116dDEE9F6B43aC78BA3`) is the canonical approval manager used by Uniswap, 1inch, Paraswap, and most modern DEX routers. Instead of approving each router separately, you approve Permit2 once, and it manages sub-approvals to individual spenders.

The problem: these sub-approvals are invisible in most wallets and block explorers. If a router gets compromised, or you forget to revoke after a swap, the approval persists. This tool reads those sub-approvals directly from the contract so you can audit what's active.

## Usage

```bash
# Check common tokens on Base
node permit2-checker.mjs 0xYourWallet

# Check on Ethereum mainnet
node permit2-checker.mjs 0xYourWallet --chain mainnet

# Check specific tokens
node permit2-checker.mjs 0xYourWallet --tokens 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913

# Filter by spender
node permit2-checker.mjs 0xYourWallet --spender 0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD

# Scan ALL tokens (uses event logs — slower but comprehensive)
node permit2-checker.mjs 0xYourWallet --all

# JSON output (for piping to other tools)
node permit2-checker.mjs 0xYourWallet --json
```

## What it checks

For each token, the tool:

1. Scans `Approval` events on Permit2 to find all spenders you've authorized
2. Reads the current `allowance(owner, token, spender)` for each
3. Reports: amount, expiration date, and nonce
4. Labels known spenders (Uniswap routers, 1inch, Paraswap, etc.)
5. Flags unlimited and expired approvals

## Supported chains

- **Base** (default) — WETH, USDC, DAI, USDbC, cbETH, wstETH, AERO, cbBTC, DEGEN, AXIOM
- **Ethereum** — WETH, USDC, USDT, DAI, WBTC, wstETH, cbETH, UNI

Custom tokens work on any chain via `--tokens`.

## How Permit2 works

```
User → approve(Permit2, MAX) on token    [one-time, visible on Etherscan]
User → Permit2.approve(token, router, amount, expiry)  [sub-approval, NOT visible on Etherscan]
Router → Permit2.transferFrom(user, recipient, amount, token)
```

The sub-approvals are stored in Permit2's internal mapping, not as standard ERC-20 allowances. That's why they're invisible to most tools. This CLI reads them directly.

## Revoking

To revoke a Permit2 sub-approval:

```
Permit2.approve(tokenAddress, spenderAddress, 0, 0)
```

Or use the Uniswap UI at [app.uniswap.org](https://app.uniswap.org) → Settings → Approvals.
