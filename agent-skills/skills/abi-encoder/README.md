# abi-encoder

Encode EVM function calls and constructor arguments from a human-readable signature and values. Zero dependencies.

The complement to [calldata-decoder](../calldata-decoder/) — one encodes, the other decodes.

## Quick Start

```bash
# ERC-20 transfer
node encode.mjs "transfer(address,uint256)" 0xRecipient 1000000000000000000
# → 0xa9059cbb000000000000000000000000...

# Max approval
node encode.mjs "approve(address,uint256)" 0xSpender 115792089237316195423570985008687907853269984665640564039457584007913129639935

# Constructor args (no function selector)
node encode.mjs --constructor "(string,uint8)" "MyToken" 18

# Raw abi.encode (no selector)
node encode.mjs --raw "(address,uint256)" 0xAbC 500
```

## Supported Types

| Type | Example |
|------|---------|
| `address` | `0xab5801a7d398351b8be11c439e05c5b3259aec9b` |
| `bool` | `true`, `false`, `1`, `0` |
| `uint8`–`uint256` | `42`, `1000000000000000000` |
| `int8`–`int256` | `-1`, `127` |
| `bytes1`–`bytes32` | `0xdeadbeef` |
| `bytes` | `0x48656c6c6f` |
| `string` | `"Hello World"` |
| `T[]` | `'["0xabc","0xdef"]'` (JSON array) |
| `T[N]` | `'["0xabc","0xdef"]'` (JSON array) |
| `(T1,T2)` | `'[100,"hello"]'` (JSON array) |

## How It Works

1. Parses the function signature to extract the name and parameter types
2. Computes the 4-byte function selector via keccak256 (built-in, no deps)
3. ABI-encodes each value according to the Solidity ABI spec (head/tail encoding for dynamic types)
4. Concatenates selector + encoded params

## Use Cases

- Craft raw transactions for multisig proposals
- Build calldata for `cast send` or ethers `provider.call`
- Encode constructor args for contract verification
- Generate test fixtures
- Pair with `calldata-decoder` for encode/decode round-trips
