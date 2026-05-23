# proxy-resolver

Tell me what a contract actually runs.

`eth_getCode` + the ERC-1967 storage slots, in 200 lines of zero-dep Node. Classifies any address on any EVM chain as EOA / contract / EIP-1167 minimal proxy / ERC-1967 transparent / UUPS / beacon proxy, and follows the chain to the implementation.

```bash
node scripts/resolve.mjs 0x833589fcd6edb6e08f4c7c32d4f71b54bda02913 --chain base --recurse
```

```
address:       0x833589fcd6edb6e08f4c7c32d4f71b54bda02913
type:          uups-proxy (EIP-1822)
implementation: 0x2ce6311ddae708829bc0784c967b7d77d19fd779
bytecode:      1852 bytes
  ↓
address:       0x2ce6311ddae708829bc0784c967b7d77d19fd779
type:          contract
bytecode:      23464 bytes
```

See [SKILL.md](./SKILL.md) for full usage and chain coverage.
