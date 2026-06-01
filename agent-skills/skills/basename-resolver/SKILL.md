---
name: basename-resolver
description: Resolve Basenames (.base.eth) to addresses and back on Base
version: 1.0.0
tags: [base, ens, basenames, resolution, identity]
dependencies: []
---

# Basename Resolver

Resolve Basenames (.base.eth) on Base — forward (name→address), reverse (address→name), and text records.

## When to Use

- Agent receives a .base.eth name and needs the wallet address
- Agent has an address and wants the human-readable basename
- Looking up social profiles (twitter, github) or metadata tied to a basename

## Scripts

- `scripts/resolve.mjs` — CLI for all resolution operations

## Usage

```bash
# Forward resolve
node scripts/resolve.mjs <name>

# Reverse resolve
node scripts/resolve.mjs -r <address>

# Text record
node scripts/resolve.mjs -t <key> <name>

# JSON output
node scripts/resolve.mjs --json <name>
```

## Integration

```javascript
// Import the functions directly for programmatic use
// resolveName(name) → address string or null
// reverseResolve(address) → name string or null
// resolveText(name, key) → value string or null
```

## Technical Details

- Uses Base universal resolver at `0xC6d566A56A1aFf6508b41f6c90ff131615583BCD`
- Computes ENS namehashes via `web3_sha3` RPC (keccak-256) — zero crypto deps
- Pairs with `basename-register` skill for write operations (registration, setting records)
