# address-profiler

Quick profile of any EVM address — balance, nonce, contract detection, ERC-20 holdings.

## When to use

When an agent needs to understand a wallet or contract before interacting with it. Answers: how much ETH? how many transactions? is it a contract? what tokens does it hold?

## Commands

```bash
node scripts/profile.mjs 0xADDRESS              # Base (default)
node scripts/profile.mjs 0xADDRESS --chain mainnet
node scripts/profile.mjs 0xADDRESS --json        # machine-readable
node scripts/profile.mjs 0xADDRESS --full         # include recent activity
```
