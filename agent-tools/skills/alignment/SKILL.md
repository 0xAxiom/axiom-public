---
title: Alignment (Bankr)
description: Clanker fee burn pipeline using Bankr API - no private keys needed
category: defi
tags: [clanker, burn, bankr, fees, alignment]
author: Axiom
version: 1.0.0
requirements:
  - Bankr API key
  - Base network access
platforms: [macos, linux]
---

# Alignment Skill

**Private-key-free Clanker fee burn pipeline using Bankr API.**

## What This Does

The Alignment skill runs the complete Clanker fee burn pipeline for ANY agent with a Bankr API key. No private keys needed — all transactions are signed and submitted via Bankr's secure API.

### The Pipeline (Exact Order)

1. **Claim Fees** — Two separate TXs to Clanker fee contract: one for WETH, one for the token
2. **Price Assets** — WETH from CoinGecko, token from DexScreener
3. **Rebalance 50/50** — Only swap the VALUE difference (e.g. $1100 WETH + $1000 token → swap $50 WETH→token)
4. **Burn ALL Tokens** — Transfer entire token balance to `0x000...dEaD`
5. **Split Remaining WETH** — 50% → USDC, 50% → BNKR, send both to treasury
6. **Report** — JSON output with all transaction details

## Critical Rules

- **NEVER convert fee tokens to WETH/USDC first** — keep them, top up
- **NEVER convert everything to USDC** — only swap the gap
- **The rebalance swap is SMALL** — only the value difference
- **Burn creates buy pressure** (small swap) + removes supply
- **50/50 by VALUE, not by amount**

## Usage

### Basic Run
```bash
node alignment.mjs \
  --token 0xf3ce5ddaab6c133f9875a4a46c55cf0b58111b07 \
  --treasury 0x19fe674a83e98c44ad4c2172e006c542b8e8fe08 \
  --bankr-key YOUR_API_KEY
```

### Environment Variable
```bash
export BANKR_API_KEY=your_key_here
node alignment.mjs --token 0x... --treasury 0x...
```

### Dry Run (Simulation)
```bash
node alignment.mjs \
  --token 0x... \
  --treasury 0x... \
  --bankr-key YOUR_API_KEY \
  --dry-run
```

### Custom Pool Parameters
```bash
node alignment.mjs \
  --token 0x... \
  --treasury 0x... \
  --bankr-key YOUR_API_KEY \
  --hooks 0xCustomHooksAddress \
  --fee 0x1000000 \
  --tick-spacing 100
```

## Arguments

| Argument | Required | Default | Description |
|----------|----------|---------|-------------|
| `--token` | ✅ | - | Token address (Clanker token) |
| `--treasury` | ✅ | - | Treasury address for USDC+BNKR |
| `--bankr-key` | ✅* | `BANKR_API_KEY` env | Bankr API key |
| `--currency0` | ❌ | WETH | V4 pool currency0 |
| `--fee` | ❌ | `0x800000` | V4 pool fee |
| `--tick-spacing` | ❌ | 200 | V4 pool tick spacing |
| `--hooks` | ❌ | `0xb429...` | V4 pool hooks address |
| `--dry-run` | ❌ | false | Simulate without transactions |

*Required unless set as environment variable

## Key Innovation

This skill requires **NO private keys**. Any agent with a Bankr API key can run the alignment pipeline for their Clanker tokens. The Bankr wallet signs and submits all transactions via secure API.

## Bankr API Integration

### Getting Wallet Address
The skill automatically gets your wallet address from Bankr's sign endpoint at startup.

### Transaction Submission
All on-chain operations go through Bankr's `/agent/submit` endpoint with:
- Transaction data encoding
- Human-readable descriptions
- Automatic confirmation waiting
- Error handling and retries

### Supported Chains
- Base (chainId: 8453) — primary chain for Clanker tokens

## Contract Addresses (Base)

| Contract | Address |
|----------|---------|
| Clanker Fee | `0xf3622742b1e446d92e45e22923ef11c2fcd55d68` |
| WETH | `0x4200000000000000000000000000000000000006` |
| USDC | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |
| BNKR | `0x22aF33FE49fD1Fa80c7149773dDe5890D3c76F3b` |
| SwapRouter02 | `0x2626664c2603336E57B271c5C0b26F421741e481` |
| Universal Router | `0x6ff5693b99212da76ad316178a184ab56d299b43` |
| Dead Address | `0x000000000000000000000000000000000000dEaD` |

## Output Example

```json
{
  "fees_claimed": {
    "weth": "0.0521",
    "token": "15420.531",
    "weth_usd": "126.43",
    "token_usd": "123.18"
  },
  "rebalance": {
    "swapped_amount": "0.0067",
    "direction": "WETH→TOKEN",
    "tx_hash": "0x..."
  },
  "burned": {
    "amount": "16089.442",
    "tx_hash": "0x..."
  },
  "treasury": {
    "usdc_amount": "62.15",
    "usdc_tx": "0x...",
    "bnkr_amount": "1847.32",
    "bnkr_tx": "0x..."
  },
  "total_burned_to_date": "8420691.331",
  "burn_percentage": "8.4207%"
}
```

## Error Handling

- **No fees available**: Exits gracefully with clear message
- **Network issues**: Automatic retries with exponential backoff
- **Bankr API errors**: Detailed error messages with response codes
- **Price feed failures**: Fallback to alternative sources
- **Transaction failures**: Full transaction hash and error details

## Security

- **No private key storage** — uses Bankr's secure signing
- **Read-only RPC** — uses public Base RPC for blockchain reads
- **Input validation** — validates all addresses and amounts
- **Dry-run mode** — test before executing real transactions

## Wrapper Script

Use the included wrapper script for easy configuration:

```bash
./scripts/alignment.sh --token 0x... --treasury 0x...
```

The wrapper sources your config and handles environment setup automatically.