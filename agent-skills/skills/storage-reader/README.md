# storage-reader

Read and decode EVM contract storage slots. Computes mapping and dynamic array slot positions via keccak-256. Zero dependencies.

## Usage

```bash
# Read a raw slot
node read.mjs <address> <slot> [--rpc URL]

# Read a mapping value: mapping(key => value) at base slot
node read.mjs <address> <slot> --map <key>

# Nested mapping: mapping(k1 => mapping(k2 => value))
node read.mjs <address> <slot> --map <key> --nested <key2>

# Dynamic array element at index
node read.mjs <address> <slot> --array <index>

# Explicit type decode
node read.mjs <address> <slot> --decode address|uint256|bool|string|bytes32

# Scan a range of slots
node read.mjs <address> --scan 0 20
```

## Examples

```bash
# Read slot 0 of USDC on Base
node read.mjs 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 0

# Read balanceOf mapping for vitalik.eth (USDC balances slot = 9)
node read.mjs 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 9 \
  --map 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045 \
  --decode uint256

# Scan first 10 storage slots
node read.mjs 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 --scan 0 10

# Read on Ethereum mainnet
node read.mjs 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48 0 --rpc https://eth.llamarpc.com
```

## Slot Computation

- **Mappings:** `keccak256(abi.encode(key, slot))` — standard Solidity layout
- **Nested mappings:** apply mapping computation twice
- **Dynamic arrays:** elements start at `keccak256(slot)`, element `i` at `keccak256(slot) + i`
- **Scan mode:** reads consecutive slots and auto-detects types

## Type Detection

When no `--decode` flag is given, the tool guesses the type:
- 12 leading zero bytes + 20 non-zero bytes -> address
- Small values -> uint256
- Value of 1 -> bool/uint256
- Everything else -> uint256|bytes32
