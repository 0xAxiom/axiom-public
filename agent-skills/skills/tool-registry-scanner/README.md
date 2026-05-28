# tool-registry-scanner

Read the [ERC-8257 Agent Tool Registry](https://8257.ai) on Base or Ethereum mainnet. Zero deps, Node 18+, pure JSON-RPC.

Lists all registered agent tools, their creators, access predicates, and manifest metadata — directly from the onchain registry at `0x265BB2DBFC0A8165C9A1941Eb1372F349baD2cf1`.

## Usage

```bash
# List all tools on Base
node scripts/scan-registry.mjs

# Inspect a specific tool
node scripts/scan-registry.mjs --id 9

# Check if an address has access to a gated tool
node scripts/scan-registry.mjs --id 2 --check 0xYourAddress

# Fetch manifest metadata (name, description, endpoint)
node scripts/scan-registry.mjs --id 7 --fetch-manifests

# List all tools with manifest details
node scripts/scan-registry.mjs --fetch-manifests

# JSON output
node scripts/scan-registry.mjs --json

# Ethereum mainnet
node scripts/scan-registry.mjs --chain mainnet

# Custom RPC
node scripts/scan-registry.mjs --rpc https://your-rpc.example.com
```

## What it reads

For each tool registered on ERC-8257:
- **toolId** — sequential integer
- **creator** — address that registered the tool
- **metadataURI** — URL to the tool manifest (`.well-known/ai-tool/*.json`)
- **manifestHash** — keccak256 of the manifest for integrity verification
- **accessPredicate** — smart contract that gates access (0x0 = open)

With `--fetch-manifests`, also fetches the manifest JSON to show:
- Tool name and description
- API endpoint URL
- Pricing info (if present)

## Example output

```
ToolRegistry v0.2 on base
17 tools registered

# 1  creator=0x5eca0441...  predicate=open
      https://nft-appraisal-tool.vercel.app/.well-known/ai-tool/nft-appraiser.json
# 2  creator=0x5eca0441...  predicate=0xc8721c9a...
      https://nft-appraisal-tool.vercel.app/.well-known/ai-tool/nft-appraiser-chonks.json
...
```

## Why

MetaMask is building with x402. OpenSea shipped `@opensea/tool-sdk`. The ERC-8257 registry is the onchain app store for agent tools. This scanner lets you see what's registered without installing the full SDK.
