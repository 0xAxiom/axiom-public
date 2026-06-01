# tool-builder

Build, test, and ship paid agent tools to the correct lane. Two lanes exist — never cross them.

## Two Lanes

### Lane A — Agentic Tools (Surface A)
- **Repo:** `~/Github/axiom-agentic-tools/`
- **URL:** `agentic.clawbots.org`
- **Deploy:** Auto on push to main (Vercel Git Integration)
- **Registration:** IPFS (Pinata) + MCP Registry + Smithery — NOT ERC-8257
- **Gate:** x402 only (USDC on Base), no NFT pass
- **Discovery:** Bazaar, MCP Registry, Smithery
- **Audience:** Broad agent economy, any agent can pay and call

### Lane B — OpenSea / Tool Pass Tools (Surface B)
- **Repo:** `~/Github/axiom-toolpass/` (submodule in website at `vendor/axiom-toolpass`)
- **URL:** `clawbots.org/tools/<lane>/<slug>`
- **Deploy:** Edit toolpass repo → bump submodule in website → `vercel --prod`
- **Registration:** ERC-8257 on Base (`0x265BB2DBFC0A8165C9A1941Eb1372F349baD2cf1`)
- **Gate:** SIWE (Tool Pass NFT) for free access OR x402 per-call
- **Discovery:** clawbots.org/tools page only, NOT on Bazaar
- **Audience:** Tool Pass holders, NFT-gated community tools

### Hard Rules
1. NEVER register agentic tools on ERC-8257
2. NEVER add opensea tools to agentic repo
3. NEVER add agentic tools to toolpass repo
4. NEVER put library code (axiom-public, normies-tools) behind a paywall

## Lane A: Build an Agentic Tool

### Step 1: Create spec.mjs

```
tools/<slug>/spec.mjs
```

Required fields (validated by `scripts/generate-manifest.mjs` → `api/_lib/descriptor.mjs`):

```javascript
export const spec = {
  slug: "my-tool",                    // kebab-case, unique
  name: "My Tool",
  version: "1.0.0",
  category: "<MARKETPLACE_CATEGORY>", // see categories below
  description: "...",                 // what it does, 1-3 sentences
  agentReadableSummary: "...",        // shorter, for agent consumption
  priceUsd: 0.05,                    // NUMBER, not string, 0..1000
  x402: {
    network: "base",
    asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",  // USDC on Base
    payTo: "0x523Eff3dB03938eaa31a5a6FBd41E3B9d23edde5",   // our wallet
    maxTimeoutSeconds: 60,
  },
  inputSchema: { type: "object", ... },
  outputSchema: { type: "object", ... },
  examples: [{ input: {...}, output: {...} }],
  tags: ["tag1", "tag2"],
  latencySlaMs: 8000,
  freshness: { mode: "live" },        // OBJECT, not string
  trustSignals: {
    evidenceFieldRequired: true,
    dataSources: ["https://..."],
  },
  marketplace: {
    bazaar: { discoverable: true },   // nested object, not boolean
    agenticMarket: { eligible: true },
  },
  deprecation: null,
  owner: {
    name: "Axiom",
    wallet: "0x523Eff3dB03938eaa31a5a6FBd41E3B9d23edde5",
  },
  supportUrl: "https://github.com/0xAxiom/axiom-agentic-tools/issues",
};
```

**Marketplace categories:** agent-business-intelligence, agent-builder-tooling, agent-operations, agent-strategy, defi-analytics, nft-analytics, onchain-data, security-audit, social-intelligence, token-analytics, wallet-analytics

### Step 2: Create handler.mjs

```
tools/<slug>/handler.mjs
```

```javascript
import { AgenticToolError } from "../../api/_lib/errors.mjs";

// SSRF guard — ALWAYS include for URL-accepting tools
const BLOCKED = /^(localhost|127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|0\.0\.0\.0|::1)/i;
function assertPublicHost(url) {
  const { hostname } = new URL(url);
  if (BLOCKED.test(hostname))
    throw new AgenticToolError("bad_input", `Private URL: ${hostname}`, 400);
}

export async function handler({ input }) {
  // Validate
  if (!input.requiredField)
    throw new AgenticToolError("bad_input", "requiredField is required", 400);

  // Do work (fetch external data, compute, etc.)
  try {
    const result = await doWork(input);
    return result;  // Must match outputSchema
  } catch (e) {
    if (e instanceof AgenticToolError) throw e;
    throw new AgenticToolError("tool_error", e.message, 500);
  }
}

// Optional: preview endpoint (free, no x402)
export async function previewHandler() {
  return { preview: "Description of what this tool does", exampleInput: {} };
}
```

**Error codes:** bad_input (400), upstream_unavailable (502), upstream_timeout (504), tool_error (500), rate_limited (429)

### Step 3: Build + Validate

```bash
cd ~/Github/axiom-agentic-tools
npm run build     # generates .well-known/agentic/{manifest,openapi,tools/<slug>}.json
npm run validate  # validates all descriptors + MCP tool list
```

### Step 4: Test handler directly

```bash
node -e '
import { handler } from "./tools/<slug>/handler.mjs";
const result = await handler({ input: { /* test input */ } });
console.log(JSON.stringify(result, null, 2));
'
```

### Step 5: Update smithery.yaml

Add entry to `tools:` array in `smithery.yaml`:

```yaml
  - name: my-tool
    title: My Tool
    description: "..."
    annotations:
      readOnlyHint: true
      destructiveHint: false
      openWorldHint: true  # true if tool fetches external data
```

### Step 6: Commit + Push

```bash
git add tools/<slug>/ smithery.yaml
git commit -m "feat: add <tool-name> (agentic tool #N)"
git push origin main
# Auto-deploys via Vercel Git Integration
```

### Step 7: Publish registrations

```bash
~/clawd/scripts/with-secrets.sh bash scripts/publish-all.sh
```

This runs: build → validate → IPFS pin (updates ERC-8004 agentURI) → MCP Registry (GitHub Actions) → Smithery

Flags: `--dry-run`, `--skip-mcp`, `--skip-smithery`

### Step 8: Verify

- `agentic.clawbots.org/.well-known/agentic/manifest.json` — tool appears
- `agentic.clawbots.org/api/agentic/tools/<slug>` — returns 402 envelope
- MCP Registry (after workflow completes)
- Smithery (if published)

## Lane B: Build an OpenSea / Tool Pass Tool

### Step 1: Add to axiom-toolpass

```
~/Github/axiom-toolpass/tools/<lane>/<slug>/
  manifest.json    — tool metadata
  handler.mjs      — implementation (optional, can be inline in website API)
```

Lanes: nft, normies, axiom, base, agent, bankr

### Step 2: Bump submodule in website

```bash
cd ~/Github/axiom/website
cd vendor/axiom-toolpass && git pull origin main && cd ../..
git add vendor/axiom-toolpass
git commit -m "chore: bump axiom-toolpass (add <slug>)"
```

### Step 3: Deploy website

```bash
NODE_OPTIONS=--tls-min-v1.2 VERCEL_TOKEN=$(security find-generic-password -s openclaw.VERCEL_TOKEN -w) \
  npx vercel --prod --yes --token $VERCEL_TOKEN --archive=tgz
```

### Step 4: Register on ERC-8257

```bash
cd ~/Github/axiom/website
~/clawd/scripts/with-secrets.sh node scripts/registry-audit.mjs --execute
```

### Step 5: Verify

- `clawbots.org/tools/<lane>/<slug>` — tool page loads
- `clawbots.org/api/tools/<slug>` — returns 402 or tool response
- ERC-8257 registry — toolId assigned on Base

## Pre-Ship Checklist

- [ ] `npm run build` passes (Lane A) or website builds (Lane B)
- [ ] `npm run validate` passes (Lane A)
- [ ] Handler tested with valid input → correct output
- [ ] Handler tested with bad input → AgenticToolError (not crash)
- [ ] SSRF guard present for any URL-accepting input
- [ ] No hardcoded secrets, no env vars in client-visible output
- [ ] Output matches outputSchema exactly
- [ ] latencySlaMs is realistic (tested, not guessed)
- [ ] examples[].output is realistic (not placeholder data)
- [ ] smithery.yaml updated (Lane A) or toolpass manifest updated (Lane B)
- [ ] Committed and pushed
- [ ] Registration pipeline run successfully
- [ ] Live endpoint verified (402 envelope or tool response)

## Common Mistakes

1. **priceUsd as string** — must be number (e.g. `0.05` not `"0.05"`)
2. **x402.asset as token symbol** — must be USDC contract address `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`
3. **x402.recipient** — field name is `payTo`, not `recipient`
4. **freshness as string** — must be object `{ mode: "live" }` not `"realtime"`
5. **marketplace.bazaar as boolean** — must be `{ discoverable: true }` not `true`
6. **Crossing lanes** — agentic tools go to agentic repo, opensea tools go to toolpass repo. Period.
7. **Missing SSRF guard** — any tool that accepts URLs must validate against private/local addresses
8. **Forgetting smithery.yaml** — new agentic tools must be added to the tools array
