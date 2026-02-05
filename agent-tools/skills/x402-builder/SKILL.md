# x402 Builder Skill

> Build paid APIs, agent services, and MCP tools using the x402 payment protocol on Base.
> Reference: ~/Github/x402 (forked from coinbase/x402)

## Overview

x402 is an open standard for internet-native payments. It turns HTTP 402 "Payment Required" into a real payment flow: clients auto-pay with USDC on Base (or other chains), servers verify and serve content. This skill covers everything needed to build on x402.

## Quick Reference

```
Fork: github.com/0xAxiom/x402
Upstream: github.com/coinbase/x402
Our PR: #1085 (insufficient funds error messages)
Facilitator (testnet): https://x402.org/facilitator
Facilitator (mainnet): https://facilitator.x402.org
Base USDC: 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
Base Sepolia USDC: 0x036CbD53842c5426634e7929541eC2318f3dCF7e
Our wallet: 0x523Eff3dB03938eaa31a5a6FBd41E3B9d23edde5
```

## Package Map

| Package | Purpose | Install |
|---------|---------|---------|
| `@x402/core` | Types, resource server, facilitator client | Required |
| `@x402/evm` | EVM payment schemes (Base, Ethereum) | Required for EVM |
| `@x402/svm` | Solana payment schemes | For Solana |
| `@x402/fetch` | Client: auto-pay wrapper for fetch() | Client-side |
| `@x402/axios` | Client: auto-pay wrapper for axios | Client-side |
| `@x402/express` | Server: Express middleware | Server-side |
| `@x402/hono` | Server: Hono middleware | Server-side |
| `@x402/next` | Server: Next.js middleware | Server-side |
| `@x402/mcp` | MCP paid tool calls | Agent use case |
| `@x402/extensions` | Bazaar discovery, SIWx auth | Optional |
| `@x402/paywall` | Browser paywall UI component | Frontend |

## Core Types

```typescript
// What the server requires
type PaymentRequirements = {
  scheme: string;              // "exact"
  network: Network;            // "eip155:8453" (Base)
  asset: string;               // USDC address
  amount: string;              // "1000000" (1 USDC in 6 decimals)
  payTo: string;               // Recipient address
  maxTimeoutSeconds: number;
  extra: Record<string, unknown>;
};

// 402 response
type PaymentRequired = {
  x402Version: number;
  error?: string;
  resource: ResourceInfo;
  accepts: PaymentRequirements[];  // Multiple options
  extensions?: Record<string, unknown>;
};

// What the client sends back
type PaymentPayload = {
  x402Version: number;
  resource: ResourceInfo;
  accepted: PaymentRequirements;   // Chosen option
  payload: Record<string, unknown>; // Signed payment data
  extensions?: Record<string, unknown>;
};
```

## Pattern 1: Server (Express)

The simplest way to expose a paid API:

```typescript
import express from "express";
import { paymentMiddleware } from "@x402/express";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { HTTPFacilitatorClient } from "@x402/core/http";

const app = express();
const facilitator = new HTTPFacilitatorClient({
  url: "https://facilitator.x402.org"
});

app.use(
  paymentMiddleware(facilitator, {
    "GET /api/data": {
      scheme: "exact",
      network: "eip155:8453",        // Base mainnet
      price: "$0.01",                // Human-readable pricing
      payTo: "0x523Eff3dB03938eaa31a5a6FBd41E3B9d23edde5",
      description: "Premium data endpoint",
    },
  })
);

app.get("/api/data", (req, res) => {
  res.json({ data: "premium content" });
});

app.listen(3000);
```

## Pattern 2: Client (fetch)

Auto-pay for x402-protected endpoints:

```typescript
import { x402Client, wrapFetchWithPayment } from "@x402/fetch";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";

const signer = privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`);

const client = new x402Client();
registerExactEvmScheme(client, { signer });

const fetchWithPayment = wrapFetchWithPayment(fetch, client);

// Automatic: gets 402, pays, retries, returns content
const response = await fetchWithPayment("https://api.example.com/data");
const data = await response.json();
```

## Pattern 3: MCP Paid Tools (THE Agent Use Case)

Make MCP tools that cost money. Other agents auto-pay:

### Server side:
```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createPaymentWrapper, x402ResourceServer } from "@x402/mcp";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { z } from "zod";

const mcpServer = new McpServer({ name: "axiom-tools", version: "1.0.0" });

const facilitator = new HTTPFacilitatorClient({
  url: "https://facilitator.x402.org"
});
const resourceServer = new x402ResourceServer(facilitator);
resourceServer.register("eip155:8453", new ExactEvmScheme());
await resourceServer.initialize();

const accepts = await resourceServer.buildPaymentRequirements({
  scheme: "exact",
  network: "eip155:8453",
  payTo: "0x523Eff3dB03938eaa31a5a6FBd41E3B9d23edde5",
  price: "$0.05",
});

const paid = createPaymentWrapper(resourceServer, { accepts });

// Paid tool: $0.05 per call
mcpServer.tool(
  "generate_image",
  "Generate an image with AI. Costs $0.05.",
  { prompt: z.string() },
  paid(async (args) => {
    const image = await generateImage(args.prompt);
    return { content: [{ type: "text", text: image.url }] };
  })
);

// Free tool: no wrapper
mcpServer.tool("ping", "Health check", {}, async () => ({
  content: [{ type: "text", text: "pong" }],
}));
```

### Client side:
```typescript
import { createX402MCPClient } from "@x402/mcp";
import { ExactEvmScheme } from "@x402/evm/exact/client";

const client = createX402MCPClient({
  name: "my-agent",
  version: "1.0.0",
  schemes: [{
    network: "eip155:8453",
    client: new ExactEvmScheme(walletAccount)
  }],
  autoPayment: true,
  onPaymentRequested: async ({ paymentRequired }) => {
    console.log(`Tool costs: ${paymentRequired.accepts[0].amount}`);
    return true; // approve payment
  },
});
```

## Pattern 4: Next.js Middleware

For Next.js API routes (like Postera uses):

```typescript
import { paymentProxy, x402ResourceServer } from "@x402/next";
import { HTTPFacilitatorClient } from "@x402/core/http";
import { ExactEvmScheme } from "@x402/evm/exact/server";

const facilitator = new HTTPFacilitatorClient({
  url: "https://facilitator.x402.org"
});
const resourceServer = new x402ResourceServer(facilitator)
  .register("eip155:8453", new ExactEvmScheme());

export const proxy = paymentProxy(
  {
    "/api/premium": {
      accepts: {
        scheme: "exact",
        price: "$0.10",
        network: "eip155:8453",
        payTo: "0x523Eff...",
      },
    },
  },
  resourceServer,
);
```

## Pattern 5: Multi-Network (Base + Solana)

Accept payments on multiple chains:

```typescript
app.use(
  paymentMiddleware(facilitator, {
    "GET /api/data": [
      {
        scheme: "exact",
        network: "eip155:8453",           // Base
        price: "$0.01",
        payTo: "0x523Eff...",
      },
      {
        scheme: "exact",
        network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",  // Solana
        price: "$0.01",
        payTo: "SolanaAddress...",
      },
    ],
  })
);
```

## Pattern 6: Discovery (Bazaar Extension)

Let agents discover your paid services:

```typescript
import { declareDiscoveryExtension } from "@x402/extensions/bazaar";

const resources = {
  "GET /api/weather": {
    accepts: { scheme: "exact", price: "$0.001", network: "eip155:8453", payTo },
    extensions: {
      ...declareDiscoveryExtension({
        input: { city: "San Francisco" },
        inputSchema: {
          properties: { city: { type: "string" } },
          required: ["city"]
        },
        output: { example: { city: "San Francisco", weather: "foggy", temp: 15 } },
      }),
    },
  },
};
```

## Pattern 7: Pay Once, Access Many (SIWx)

Authentication after initial payment:

```typescript
import { declareSIWxExtension, siwxResourceServerExtension, createSIWxSettleHook, createSIWxRequestHook, InMemorySIWxStorage } from "@x402/extensions/sign-in-with-x";

const storage = new InMemorySIWxStorage();

const resourceServer = new x402ResourceServer(facilitator)
  .register("eip155:8453", new ExactEvmScheme())
  .registerExtension(siwxResourceServerExtension)
  .onAfterSettle(createSIWxSettleHook({ storage }));

const routes = {
  "GET /api/premium": {
    accepts: [{ scheme: "exact", price: "$1.00", network: "eip155:8453", payTo }],
    extensions: declareSIWxExtension({
      statement: "Sign in to access purchased content",
    }),
  },
};

const httpServer = new x402HTTPResourceServer(resourceServer, routes)
  .onProtectedRequest(createSIWxRequestHook({ storage }));
```

## Payment Flow

```
Client                    Server                  Facilitator
  |                         |                         |
  |--- GET /api/data ------>|                         |
  |<-- 402 PaymentRequired -|                         |
  |                         |                         |
  |--- Sign payment ------->|                         |
  |--- GET + X-PAYMENT ---->|                         |
  |                         |--- Verify payment ----->|
  |                         |<-- Verified ------------|
  |                         |--- Serve content        |
  |<-- 200 + data ----------|                         |
  |                         |--- Settle payment ----->|
  |                         |<-- Settled -------------|
```

## Pricing

Human-readable pricing supported:
```typescript
price: "$0.01"      // 1 cent USDC
price: "$1.00"      // 1 dollar USDC
price: "$0.001"     // 0.1 cent USDC
```

Or raw amounts (6 decimal USDC):
```typescript
amount: "10000"     // 0.01 USDC
amount: "1000000"   // 1.00 USDC
```

## Testing

### Base Sepolia (testnet)
```typescript
// Use testnet facilitator
const facilitator = new HTTPFacilitatorClient({
  url: "https://x402.org/facilitator"  // Sepolia only
});

// Testnet network
network: "eip155:84532"  // Base Sepolia

// Get testnet USDC from faucet
// https://faucet.circle.com/
```

### Mock facilitator for local dev
```typescript
// Self-hosted facilitator for testing
import { x402Facilitator } from "@x402/core/facilitator";
const facilitator = new x402Facilitator();
facilitator.register("eip155:84532", new ExactEvmScheme());
```

## Contributing to coinbase/x402

```bash
cd ~/Github/x402
git fetch upstream
git checkout -b feature/my-feature
# Make changes
cd typescript && pnpm install && pnpm test
pnpm changeset  # Add changelog entry
git commit -S -m "feat: description (#issue)"
git push origin feature/my-feature
gh pr create --repo coinbase/x402
```

**Requirements:** Signed commits, tests, changelog fragments.

## Open Issues Worth Tackling

| # | Issue | Impact | Status |
|---|-------|--------|--------|
| 931 | ERC-8004 reputation extension | HIGH | Assigned but open |
| 869 | .well-known/x402 discovery | HIGH | Unassigned |
| 909 | Clear error messages | MED | **Our PR #1085** |
| 959 | Better failure diagnostics | MED | Unassigned |
| 1011 | Escrow scheme proposal | HIGH | Unassigned |
| 960 | Encrypt-then-pay extension | MED | Unassigned |

## PROJECT-IDEAS.md Opportunities

Coinbase offers **$3K micro-grants** for projects that unlock new demand/supply:
- Wealth-Manager Trading Bot
- Prediction-Market Oracle
- Agent Service Marketplace (our top pick)
- Unstoppable Agent (self-provisioning inference)
- Dynamic Endpoint Shopper (MCP registry + x402)

## Postera Integration Notes

Postera (`~/Github/Postera`) uses custom x402-like implementation, NOT the official SDK.
- Custom 402 headers in `src/lib/x402.ts` and `src/lib/payment.ts`
- Manual on-chain verification in `src/lib/payments/verify.ts`
- PosteraSplitter contract: `0x622C9f74fA66D4d7E0661F1fd541Cc72e367c938`
- Could be upgraded to use `@x402/core` for ecosystem compatibility

## Research Reports

Full deep-dive reports at `~/clawd/research/`:
- `x402-sdk-deep-dive.md` - Complete SDK architecture, all types, all patterns
- `x402-examples-specs-docs.md` - Every example dissected, protocol spec, issue tracker
- `x402-agent-patterns.md` - Practical agent builder guide with ready-to-use code
- `x402-opportunities.md` - Ecosystem map, gaps, hackathon angles
- `x402-build-ideas.md` - 10+ concrete build ideas with feasibility and revenue models
