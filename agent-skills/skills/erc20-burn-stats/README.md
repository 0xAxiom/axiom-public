# erc20-burn-stats

Zero-dep CLI that counts ERC-20 burns by scanning `Transfer` events to a dead address. Pure JSON-RPC, works on any EVM chain.

```bash
node scripts/burn-stats.mjs --token 0xTOKEN
node scripts/burn-stats.mjs --token 0xTOKEN --dead 0x0 --json
node scripts/burn-stats.mjs --token 0xTOKEN --rpc https://eth.llamarpc.com
```

See [SKILL.md](./SKILL.md) for full docs.
