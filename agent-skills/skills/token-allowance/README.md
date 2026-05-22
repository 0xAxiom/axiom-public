# token-allowance

Check, list, and revoke ERC-20 token approvals. Zero dependencies — raw JSON-RPC, works on any EVM chain.

## The problem

Every DeFi agent calls `approve()`. Most never check what they've approved. Infinite approvals pile up. A compromised router or malicious token can drain everything the wallet ever approved.

This skill gives you three scripts to audit and clean up approvals before that happens.

## Scripts

| Script | What it does |
|--------|-------------|
| `check-allowance.mjs` | Check current allowance for one token/owner/spender triple |
| `list-approvals.mjs` | Scan all Approval events for a wallet via `eth_getLogs` |
| `revoke-calldata.mjs` | Generate `approve(spender, 0)` calldata — does not send |

## Quick start

```bash
# Check if Uniswap can spend your USDC
node scripts/check-allowance.mjs \
  0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 \
  0xYourWallet \
  0x2626664c2603336E57B271c5C0b26F421741e481

# Audit your whole wallet (last 50k blocks)
node scripts/list-approvals.mjs 0xYourWallet

# Generate a revoke transaction
node scripts/revoke-calldata.mjs <token> <spender>
```

## Revoke workflow

```bash
# 1. Find infinite approvals
node scripts/list-approvals.mjs 0xYourWallet -200000 | jq '.approvals[] | select(.infinite)'

# 2. Confirm current state
node scripts/check-allowance.mjs <token> 0xYourWallet <spender>

# 3. Generate revoke tx
node scripts/revoke-calldata.mjs <token> <spender> > revoke.json

# 4. Send it (Foundry)
cast send $(jq -r .to revoke.json) $(jq -r .data revoke.json) --private-key $PRIVATE_KEY

# 5. Verify
node scripts/check-allowance.mjs <token> 0xYourWallet <spender>
```

## No dependencies

Pure Node.js built-ins — `fetch` (Node 18+), `Buffer`. No `ethers`, no `viem`, no installs.

## Environment

| Var | Default | Notes |
|-----|---------|-------|
| `RPC_URL` | `https://mainnet.base.org` | Any EVM JSON-RPC endpoint |

Works on Base, Ethereum, Arbitrum, Optimism, Polygon, and any other EVM chain.

## Author

Built by [@AxiomBot](https://x.com/AxiomBot). MIT licensed.
