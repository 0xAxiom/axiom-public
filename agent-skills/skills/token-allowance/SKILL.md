# token-allowance

Check, audit, and revoke ERC-20 token approvals. Zero dependencies — raw JSON-RPC, any EVM chain.

## When to use this skill

- "check allowance" / "how much can [spender] spend"
- "infinite approval" / "revoke approval" / "revoke infinite"
- "list approvals" / "audit approvals" / "what has access to my tokens"
- "ERC-20 approve" / "token spending permission"
- Before any DeFi interaction — verify approvals are what you expect
- Security audits of wallets or smart contracts

## Scripts

### check-allowance.mjs — Check a single allowance

```bash
node check-allowance.mjs <token> <owner> <spender> [rpc_url]
```

Returns: symbol, decimals, raw allowance, human-readable amount, risk level (NONE / LIMITED / HIGH).

Flags INFINITE approvals with a warning and instructions to revoke.

```bash
# Is Uniswap allowed to spend your USDC?
node check-allowance.mjs \
  0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 \
  0xYourWallet \
  0x2626664c2603336E57B271c5C0b26F421741e481 \
  https://mainnet.base.org
```

### list-approvals.mjs — Audit all approvals for a wallet

```bash
node list-approvals.mjs <owner> [fromBlock_or_-N] [rpc_url]
```

Scans Approval events via `eth_getLogs`. Dedupes by (token, spender) keeping the latest state.

```bash
# Last 50,000 blocks (default)
node list-approvals.mjs 0xYourWallet

# Last 200,000 blocks
node list-approvals.mjs 0xYourWallet -200000

# From genesis (slow on mainnet)
node list-approvals.mjs 0xYourWallet 0 https://eth.llamarpc.com
```

Output includes `activeApprovals`, `infiniteCount`, and full list sorted by recency.

### revoke-calldata.mjs — Generate a revoke transaction

```bash
node revoke-calldata.mjs <token> <spender> [rpc_url]
```

Outputs a JSON tx object (`to`, `data`, `value`) for `approve(spender, 0)`.
Does NOT send — paste into your signing tool.

```bash
node revoke-calldata.mjs \
  0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 \
  0x2626664c2603336E57B271c5C0b26F421741e481

# Then verify after sending:
node check-allowance.mjs <token> <owner> <spender>
```

## Full workflow

```bash
# 1. Audit: find all approvals
node list-approvals.mjs 0xYourWallet -100000

# 2. Inspect a suspicious one
node check-allowance.mjs <token> 0xYourWallet <spender>

# 3. Generate revoke
node revoke-calldata.mjs <token> <spender> > revoke.json

# 4. Send via cast (Foundry)
cast send $(jq -r .to revoke.json) $(jq -r .data revoke.json) --private-key $PRIVATE_KEY

# 5. Confirm it worked
node check-allowance.mjs <token> 0xYourWallet <spender>
```

## Environment

| Variable | Default | Notes |
|----------|---------|-------|
| `RPC_URL` | `https://mainnet.base.org` | Any EVM JSON-RPC endpoint |

Works on Base, Ethereum, Arbitrum, Optimism, Polygon — any EVM chain with a public RPC.

## Key facts

- `allowance(address,address)` selector: `0xdd62ed3e`
- `approve(address,uint256)` selector: `0x095ea7b3`
- Approval event topic0: `0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925`
- Infinite approval threshold: values > 10^28 (covers both max uint256 and near-max approvals)
- `list-approvals` dedupes per (token, spender) pair — shows current net state, not raw event history

## Common spenders to audit

- Uniswap V3 Router (Base): `0x2626664c2603336E57B271c5C0b26F421741e481`
- Uniswap Universal Router (Base): `0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD`
- Permit2 (all chains): `0x000000000022D473030F116dDEE9F6B43aC78BA3`

Always verify addresses on the block explorer before revoking.
