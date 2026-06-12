# bytecode-hasher

Fingerprint deployed contracts by hashing their runtime bytecode. Detect clones, verify implementations match, and compare deployments across chains.

## Usage

```bash
# Hash a contract on Base
./bytecode-hasher.mjs 0x91DA9FAb0b371CAAFd211FE68ab956F774d8ddE8

# Compare two contracts — are they clones?
./bytecode-hasher.mjs 0xaaa...111 0xbbb...222

# Check same address across all chains
./bytecode-hasher.mjs 0xaaa...111 --cross-chain

# Use a different chain
./bytecode-hasher.mjs 0xaaa...111 --chain ethereum
```

## What it does

- Fetches runtime bytecode via `eth_getCode`
- Produces a **raw hash** (exact bytecode match) and a **normalized hash** (strips Solidity CBOR metadata so same-source contracts match even if compiled with different settings)
- Reports contract size and notable opcodes (DELEGATECALL, CREATE2, SELFDESTRUCT, PUSH0)
- When given multiple addresses, groups them by normalized hash to find clones
- Cross-chain mode compares the same address across Base, Ethereum, Arbitrum, and Optimism

## Why

- **Clone detection**: Minimal proxy (EIP-1167) factories deploy hundreds of clones. Hash them to verify they're identical.
- **Implementation verification**: After a proxy upgrade, confirm the new implementation matches what you expect.
- **Cross-chain parity**: Verify a protocol deployed the same contract across multiple chains.
- **Due diligence**: Quick fingerprint check before interacting with an unknown contract.

## Zero dependencies

Node.js 18+ only. Uses native `fetch` and `crypto`.
