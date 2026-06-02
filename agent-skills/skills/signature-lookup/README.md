# signature-lookup

Resolve EVM function selectors (4-byte) and event topic hashes (32-byte) to human-readable signatures.

Zero dependencies. Uses openchain.xyz + 4byte.directory with a built-in fallback DB of 50+ common signatures.

## Usage

```bash
# Function selector
node lookup.mjs 0xa9059cbb
# => [fn] 0xa9059cbb  transfer(address,uint256)  [builtin]

# Event topic
node lookup.mjs 0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef
# => [event] 0xddf252ad...  Transfer(address,address,uint256)  [builtin]

# Batch
node lookup.mjs 0xa9059cbb 0x095ea7b3 0x23b872dd

# Scan bytecode for selectors
node lookup.mjs --scan 0x6080604052...

# Pipe
echo "0xa9059cbb" | node lookup.mjs
```

## How it works

1. Checks the built-in database first (ERC-20, ERC-721, Uniswap, OpenZeppelin patterns).
2. If not found, queries openchain.xyz and 4byte.directory in parallel.
3. Deduplicates and displays all matching signatures.

Bytecode scan mode (`--scan`) extracts PUSH4 opcodes to find function selectors, then resolves each one.
