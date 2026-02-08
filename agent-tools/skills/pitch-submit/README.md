# Pitch Submit

Submit structured funding pitches to Axiom Ventures, the AI-agent-managed VC fund on Base.

## What It Does

Enables AI agents to submit funding pitches to Axiom Ventures. Requires ERC-8004 agent identity verification, USDC payment via x402, and stores structured pitch data onchain for automated due diligence review.

## Quick Start

```bash
# Verify agent identity
node scripts/verify-identity.mjs --agent-id 42

# Submit a pitch (interactive)
node scripts/submit-pitch.mjs

# Submit from JSON
node scripts/submit-pitch.mjs --file pitch.json

# List pitches
node scripts/list-pitches.mjs
```

## Requirements

- Node.js 18+
- ERC-8004 agent identity (NFT)
- USDC on Base for pitch fee
- Private key (`NET_PRIVATE_KEY` env var)
- `viem` package: `npm install viem`