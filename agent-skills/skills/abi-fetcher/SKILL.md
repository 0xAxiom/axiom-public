# ABI Fetcher

Fetch verified contract ABIs from Sourcify and Etherscan-family explorers. Handles proxy contracts automatically. Caches results locally. Zero dependencies — pure Node.js.

## When to use this skill

Use when:
- You need to interact with an onchain contract and don't have its ABI
- You want to understand what functions/events a contract exposes
- You're building a skill that needs to call or decode contract data
- You want to verify what a proxy contract's implementation exposes

Do NOT use for:
- Unverified contracts (bytecode only) — ABI won't be available
- Generating ABIs from source code (use forge/hardhat for that)

## Quick Start

```bash
# Fetch ABI for USDC on Base (chain 8453)
node scripts/abi-fetch.mjs 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 --chain 8453

# Get raw JSON ABI
node scripts/abi-fetch.mjs 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 --chain 8453 --json

# List only function signatures
node scripts/abi-fetch.mjs 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 --chain 8453 --functions

# List only events
node scripts/abi-fetch.mjs <address> --chain 1 --events

# Force fresh fetch (skip cache)
node scripts/abi-fetch.mjs <address> --chain 8453 --no-cache
```

## Agent Usage

```javascript
import { execSync } from 'child_process';

// Fetch ABI as JSON
function fetchABI(address, chainId = 8453) {
  const result = execSync(
    `node /path/to/abi-fetch.mjs ${address} --chain ${chainId} --json`,
    { encoding: 'utf8' }
  );
  return JSON.parse(result);
}

// Example: get all view functions
const abi = fetchABI('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', 8453);
const viewFns = abi.filter(x => x.type === 'function' && x.stateMutability === 'view');
console.log('View functions:', viewFns.map(f => f.name));
```

## Supported Chains

| Chain | ID |
|-------|----|
| Ethereum | 1 |
| Base | 8453 |
| Base Sepolia | 84532 |
| Polygon | 137 |
| Arbitrum One | 42161 |
| Optimism | 10 |
| BSC | 56 |
| Avalanche | 43114 |
| Fantom | 250 |
| Gnosis | 100 |
| Scroll | 534352 |
| Linea | 59144 |
| Zora | 7777777 |
| Sepolia | 11155111 |

## How It Works

1. **Proxy detection** — reads ERC-1967 / UUPS / Compound implementation storage slots via public RPC. If a proxy is detected, fetches the implementation's ABI.

2. **Sourcify first** — tries `full_match` then `partial_match` on Sourcify (free, no API key, high-quality verified source).

3. **Etherscan fallback** — if Sourcify misses, queries the chain's Etherscan-family explorer. Works without an API key but rate-limited; set `ETHERSCAN_API_KEY` env var or `--etherscan-key` for higher limits.

4. **Local cache** — saves to `~/.abi-cache/<chainId>/<address>.json`. Cache is permanent (ABIs don't change). Use `--no-cache` to force a fresh fetch.

## Options

| Flag | Description |
|------|-------------|
| `--chain <id>` | Chain ID (default: 1) |
| `--no-cache` | Skip cache, fetch fresh |
| `--cache-dir <path>` | Custom cache directory |
| `--etherscan-key <key>` | Etherscan API key |
| `--json` | Output raw JSON ABI array |
| `--functions` | List function signatures only |
| `--events` | List event signatures only |

## Environment Variables

- `ETHERSCAN_API_KEY` — optional, increases Etherscan rate limits

## Exit Codes

- `0` — ABI found and printed
- `1` — ABI not found (contract not verified)
- `2` — Bad input (invalid address, missing args)

## Requirements

- Node.js 18+ (uses built-in `fetch`)
- Network access to Sourcify and/or Etherscan

## Integration with Other Skills

Pairs well with:
- **calldata-decoder** — decode raw tx input using the fetched ABI
- **event-decoder** — decode raw logs using the fetched ABI
- **tx-simulator** — simulate calls using the fetched ABI
- **contract-reader** — read view functions using the fetched ABI
- **onchain-event-watcher** — watch events using the fetched ABI
