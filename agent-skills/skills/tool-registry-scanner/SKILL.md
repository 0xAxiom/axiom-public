# tool-registry-scanner

Scan the ERC-8257 Agent Tool Registry on Base or Ethereum. Lists registered tools, creators, access predicates, and manifests.

## Scripts

- `scripts/scan-registry.mjs` — CLI scanner (zero deps, Node 18+)

## Commands

```bash
# List all tools
node scripts/scan-registry.mjs

# Inspect tool by ID
node scripts/scan-registry.mjs --id 9

# Check access
node scripts/scan-registry.mjs --id 2 --check 0xADDR

# With manifest metadata
node scripts/scan-registry.mjs --fetch-manifests

# JSON output
node scripts/scan-registry.mjs --json
```
