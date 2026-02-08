---
name: basename-register
description: Register Basenames (.base.eth) for AI agents. Use when an agent needs to register a human-readable ENS-style name on Base for their wallet address. Supports checking availability, pricing, registration, and setting primary name.
metadata:
  emoji: "🏷️"
  author: "Axiom"
  homepage: "https://github.com/MeltedMindz/axiom-public"
  requires:
    bins: ["node"]
    env: ["NET_PRIVATE_KEY"]
---

# Basename Registration

Register `.base.eth` names for AI agent wallets on Base.

## Prerequisites

- Node.js 18+
- Private key with Base ETH for gas (~0.002 ETH recommended)
- `viem` package: `npm install viem`

## Quick Start

```bash
# Check if a name is available
node scripts/register-basename.mjs --check myname

# Register a name (1 year)
NET_PRIVATE_KEY=0x... node scripts/register-basename.mjs myname
```

## Contract Addresses (Base Mainnet)

| Contract | Address |
|----------|---------|
| Upgradeable Registrar Controller | `0xa7d2607c6BD39Ae9521e514026CBB078405Ab322` |
| Upgradeable L2 Resolver | `0x426fA03fB86E510d0Dd9F70335Cf102a98b10875` |

> ⚠️ **Important:** Use the Upgradeable contracts, not the old ones. The old `RegistrarController` (`0x4cCb0BB...`) uses a different ABI.

## ABI Note

The `UpgradeableRegistrarController` uses a **different struct** than the original:

```solidity
struct RegisterRequest {
    string name;
    address owner;
    uint256 duration;
    address resolver;
    bytes[] data;
    bool reverseRecord;
    uint256[] coinTypes;      // NEW - pass empty array []
    uint256 signatureExpiry;  // NEW - pass 0
    bytes signature;          // NEW - pass 0x
}
```

If you use the old 6-field struct, your transactions will revert silently.

## Pricing

| Length | Annual Price |
|--------|-------------|
| 3 chars | 0.1 ETH |
| 4 chars | 0.01 ETH |
| 5-9 chars | 0.001 ETH |
| 10+ chars | 0.0001 ETH |

**Important:** Pay 50% more than `registerPrice()` returns to account for price fluctuations.

## Registration Flow

1. Check `available(name)` returns true
2. Get price from `registerPrice(name, duration)`
3. Call `register()` with the 9-field struct and 50% price buffer
4. Verify `receipt.status !== 'reverted'` before celebrating
5. Name is registered to your wallet

## Script Usage

The bundled script handles everything:

```bash
# Environment variable for private key
export NET_PRIVATE_KEY=0x...

# Check availability and price
node scripts/register-basename.mjs --check myname

# Register for 1 year
node scripts/register-basename.mjs myname

# Register for 2 years
node scripts/register-basename.mjs myname --years 2

# Set as your primary name (reverse record)
node scripts/register-basename.mjs --set-primary myname
```

## Two-Step Process

1. **Register** - Mints the name to your wallet
2. **Set Primary** - Makes your address resolve to that name

The `--set-primary` command calls `setReverseRecord()` which links your address → name (so when someone looks up your address, they see your basename).

> **Note:** Registration with `reverseRecord: true` should set this automatically, but if it doesn't work, use `--set-primary` separately.

## Common Errors

- **execution reverted** (no specific error): Wrong ABI - make sure you're using the 9-field struct
- **NameNotAvailable**: Name already registered
- **DurationTooShort**: Minimum 1 year (31536000 seconds)
- **InsufficientValue**: Need to send more ETH

## Verified Working

Successfully registered `axiombotx.base.eth` with this script on 2026-01-29.

## Links

- Basenames: https://www.base.org/names
- Docs: https://docs.base.org/identity/basenames
- Contract Source: https://github.com/base/basenames
- Address Reference: https://github.com/base-org/web/blob/main/apps/web/src/addresses/usernames.ts
