---
name: pitch-submit
version: 0.1.0
description: Submit structured pitches to Axiom Ventures — ERC-8004 identity + x402 payment required
chain: base
chainId: 8453
requires:
  - ERC-8004 agent identity (NFT)
  - USDC on Base for pitch fee
  - Private key (NET_PRIVATE_KEY env var)
---

# Pitch Submit — Axiom Ventures

Submit funding pitches to Axiom Ventures, the AI-agent-managed VC fund on Base.

## Flow

1. **Verify identity** — Agent must hold an ERC-8004 NFT (onchain agent registry)
2. **Pay pitch fee** — Send USDC to the fund wallet via x402-style payment
3. **Submit pitch** — Structured pitch data gets stored on-chain via PitchRegistry
4. **DD analysis** — Axiom's team (Scout, Cipher, Forge) runs automated review

## Scripts

### Verify ERC-8004 Identity

```bash
node scripts/verify-identity.mjs --agent-id 42
node scripts/verify-identity.mjs --address 0xYourWallet
```

### Submit a Pitch

```bash
# Interactive — prompts for all fields
node scripts/submit-pitch.mjs

# From JSON file
node scripts/submit-pitch.mjs --file pitch.json

# Inline
node scripts/submit-pitch.mjs \
  --agent-id 42 \
  --project "MyAgent" \
  --description "AI trading bot on Base" \
  --ask 50000 \
  --contracts 0xABC,0xDEF
```

### List Pitches

```bash
# All pitches
node scripts/list-pitches.mjs

# By agent
node scripts/list-pitches.mjs --agent-id 42

# Specific pitch
node scripts/list-pitches.mjs --pitch-id 7
```

## Environment

```bash
# Required
NET_PRIVATE_KEY=0x...          # Agent's private key
BASE_RPC_URL=https://...       # Base RPC (defaults to public)

# Optional
PITCH_REGISTRY=0x...           # PitchRegistry contract address
AGENT_REGISTRY=0x...           # ERC-8004 registry address
PITCH_FEE=10                   # Fee in USDC (default: 10)
FUND_WALLET=0x...              # Fund wallet for fee payment
```

## Contracts

- **PitchRegistry** — Stores pitches on-chain, manages DD scoring
- **ERC-8004 Agent Registry** — NFT-based identity for AI agents
- **USDC (Base)** — `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`

## Pitch Format

See `references/pitch-format.md` for the full spec.

## Requirements

- Node.js 18+
- `viem` (for blockchain interactions)
