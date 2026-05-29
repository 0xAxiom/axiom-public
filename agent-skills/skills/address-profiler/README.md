# address-profiler

Quick profile of any EVM address. Returns balance, nonce (tx count), contract status, ERC-20 token holdings, and recent block activity. Zero deps, pure JSON-RPC.

## Usage

```bash
# Basic profile on Base
node scripts/profile.mjs 0xADDRESS

# Ethereum mainnet
node scripts/profile.mjs 0xADDRESS --chain mainnet

# Only check specific tokens
node scripts/profile.mjs 0xADDRESS --tokens USDC,WETH

# Include recent block activity (last 100 blocks)
node scripts/profile.mjs 0xADDRESS --full

# JSON output (for piping to other tools)
node scripts/profile.mjs 0xADDRESS --json

# Multiple addresses
node scripts/profile.mjs 0xADDR1 0xADDR2 0xADDR3

# Custom RPC
node scripts/profile.mjs 0xADDRESS --rpc https://my-rpc.example.com
```

## Output

```
  Address:  0x523E...dde5
  Chain:    base
  Balance:  0.0444 ETH
  Nonce:    3521 txs
  Type:     EOA
  Tokens:
    USDC     1,234.56
    WETH     0.5000
```

## Default Tokens

**Base:** USDC, WETH, DAI, USDbC, cbETH, DEGEN, AERO, BRETT

**Mainnet:** USDC, WETH, DAI, USDT, WBTC, LINK

## Requirements

Node 18+ (uses native `fetch`). No dependencies.
