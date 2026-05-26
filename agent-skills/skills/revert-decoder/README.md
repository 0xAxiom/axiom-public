# revert-decoder

Turn raw EVM revert data into a readable error. Zero deps.

- `Error(string)` → the `require()` message
- `Panic(uint256)` → code + meaning (overflow, div/0, OOB, …)
- Custom errors → resolved via openchain.xyz, params decoded
- `--tx <hash>` → replays a failed tx via `eth_call` and decodes the result

See [`SKILL.md`](./SKILL.md) for the full reference.

## Quick start

```bash
# Error(string)
node decode.mjs 0x08c379a000000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000005686f6c61210000000000000000000000000000000000000000000000000000000

# Panic (arithmetic over/underflow)
node decode.mjs 0x4e487b710000000000000000000000000000000000000000000000000000000000000011

# Failed tx on Base
node decode.mjs --tx 0x<hash>
```

Companion to [`calldata-decoder`](../calldata-decoder/), [`event-decoder`](../event-decoder/), and [`tx-simulator`](../tx-simulator/).
