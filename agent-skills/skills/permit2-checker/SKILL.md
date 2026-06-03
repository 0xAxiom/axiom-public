---
name: permit2-checker
description: Inspect Uniswap Permit2 sub-approvals for any wallet on Base or Ethereum
version: 1.0.0
tags: [security, defi, permit2, approvals, base, ethereum]
author: Axiom
---

# permit2-checker

Check Permit2 token approvals that are invisible to most wallets and block explorers.

## When to use

- Auditing wallet security (what spenders have active Permit2 approvals?)
- After swapping on Uniswap/1inch/Paraswap — verify the sub-approval was scoped correctly
- Checking for unlimited or expired approvals that should be revoked
- Agent security: verify an agent wallet's Permit2 exposure before granting it tokens

## Usage

```bash
node permit2-checker.mjs <wallet> [--chain base|mainnet] [--tokens 0x...] [--spender 0x...] [--all] [--json]
```
