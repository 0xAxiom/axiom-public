---
name: proxy-resolver
description: Detect EIP-1167 minimal proxies, ERC-1967 / UUPS / beacon upgradeable proxies, and resolve them to the implementation address on any EVM chain. Zero deps. Use when verifying tokens before swaps, auditing unknown contracts, or chasing what a proxy actually delegates to.
---

# proxy-resolver

Zero-dependency Node script that classifies a contract address and resolves proxies to their implementation.

Detects:
- **EIP-1167 minimal proxies** — exact, PUSH0 variant, and OpenZeppelin Clones-with-immutable-args
- **ERC-1967** transparent / UUPS proxies (reads slot `0x3608…d382bbc`)
- **EIP-1822** UUPS legacy slot (`0x7050…ed3f8c3`)
- **ERC-1967 beacon proxies** (reads beacon slot)
- **EOA vs contract vs empty**

Most Clanker tokens, Zora 1155s, and Safes on Base are EIP-1167 clones — this tells you what they actually run.

## Usage

```bash
node scripts/resolve.mjs <address> [--chain base|mainnet|optimism|arbitrum|polygon|sepolia] [--rpc URL] [--json] [--recurse]
```

### Examples

```bash
# USDC on Base — ERC-1967 (UUPS-style)
node scripts/resolve.mjs 0x833589fcd6edb6e08f4c7c32d4f71b54bda02913 --chain base --recurse
# address:       0x833589fcd6edb6e08f4c7c32d4f71b54bda02913
# type:          uups-proxy (EIP-1822)
# implementation: 0x2ce6311ddae708829bc0784c967b7d77d19fd779
#   ↓
# address:       0x2ce6311ddae708829bc0784c967b7d77d19fd779
# type:          contract

# Custom RPC
node scripts/resolve.mjs 0xabc... --rpc https://my.rpc

# JSON for programmatic use
node scripts/resolve.mjs 0xabc... --chain base --json
```

## When to use

- **Before swapping into a token** — does it delegate to a known Clanker / Zora / OZ template, or is the implementation custom?
- **Auditing unknown contracts** — surfaces the actual logic contract behind a proxy
- **Debugging "function not found"** — proxy ABIs lie; you need the implementation's ABI
- **Detecting clone-spam tokens** — Clanker-style EIP-1167 clones all share one implementation; surfacing it groups them

## Output shape (JSON)

```json
{
  "address": "0x...",
  "type": "minimal-proxy" | "erc1967-proxy" | "uups-proxy" | "beacon-proxy" | "contract" | "eoa",
  "standard": "EIP-1167" | "ERC-1967" | "EIP-1822" | "ERC-1967-beacon" | null,
  "implementation": "0x..." | null,
  "beacon": "0x..." | null,
  "admin": "0x..." | null,
  "immutableArgsBytes": 32,
  "bytecodeLen": 1852
}
```

With `--recurse`, returns an array following the proxy chain until a non-proxy or a loop is hit.

## Limits

- Does not detect EIP-2535 Diamonds reliably (no standard slot; would need facet introspection)
- Does not detect non-standard proxies that hide the implementation in custom storage
- Public RPCs throttle; pass `--rpc` with a private endpoint for batch use
