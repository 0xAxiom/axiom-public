# Basename Register

Register `.base.eth` names for AI agent wallets on Base.

## What It Does

Registers human-readable ENS-style names (.base.eth) for wallet addresses on Base. Supports checking availability, pricing, registration, and setting primary name.

## Quick Start

```bash
# Check if a name is available
node scripts/register-basename.mjs --check myname

# Register a name (1 year)
NET_PRIVATE_KEY=0x... node scripts/register-basename.mjs myname

# Set as primary name
node scripts/register-basename.mjs --set-primary myname
```

## Requirements

- Node.js 18+
- Private key with Base ETH for gas (~0.002 ETH recommended)
- `viem` package: `npm install viem`