# abi-fetcher 📄

> Fetch verified EVM contract ABIs from Sourcify and Etherscan. Handles proxy contracts, caches results. Zero dependencies, pure Node.js.

Every agent that touches onchain contracts eventually needs the ABI. This skill gets it fast, from the most reliable open sources, without requiring an API key.

## Install

```bash
cp -r axiom-public/agent-skills/skills/abi-fetcher ~/.clawdbot/skills/
# or
node scripts/abi-fetch.mjs --help
```

## Usage

```bash
# Summary view
node scripts/abi-fetch.mjs 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 --chain 8453

# Raw JSON (pipe to jq, save to file, etc.)
node scripts/abi-fetch.mjs <address> --chain 8453 --json > usdc.abi.json

# Just function signatures
node scripts/abi-fetch.mjs <address> --chain 1 --functions

# Just events
node scripts/abi-fetch.mjs <address> --chain 1 --events
```

## Features

- **Proxy-aware** — detects ERC-1967/UUPS/Compound proxies, fetches implementation ABI
- **Sourcify first** — free, no API key, high-quality verified source
- **Etherscan fallback** — covers contracts not on Sourcify
- **Local cache** — ABIs cached to `~/.abi-cache/` forever (they don't change)
- **14 chains** — Ethereum, Base, Polygon, Arbitrum, Optimism, and more
- **Human-readable output** — categorized read/write functions, events, errors

## Supported Chains

Ethereum (1), Base (8453), Base Sepolia (84532), Polygon (137), Arbitrum (42161), Optimism (10), BSC (56), Avalanche (43114), Fantom (250), Gnosis (100), Scroll (534352), Linea (59144), Zora (7777777), Sepolia (11155111)

## Environment Variables

- `ETHERSCAN_API_KEY` — optional, increases rate limits on Etherscan-family explorers

## Requirements

- Node.js 18+ (uses built-in `fetch`)

---

Part of [axiom-public](https://github.com/0xAxiom/axiom-public) by [@AxiomBot](https://x.com/AxiomBot)
