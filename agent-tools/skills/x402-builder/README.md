# x402 Builder

Build paid APIs, agent services, and MCP tools using the x402 payment protocol on Base.

## What It Does

Enables building internet-native payment flows using x402 standard. Turn HTTP 402 "Payment Required" into real payment flows where clients auto-pay with USDC on Base and servers verify payments before serving content.

## Quick Start

```typescript
// Server: Paid API endpoint
import { paymentMiddleware } from "@x402/express";
import { ExactEvmScheme } from "@x402/evm/exact/server";

app.use('/api/paid', paymentMiddleware({
  scheme: new ExactEvmScheme('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'),
  amount: '1000000' // 1 USDC
}));

// Client: Auto-pay
import { x402 } from "@x402/fetch";
const response = await x402('https://api.example.com/paid');
```

## Requirements

- Node.js 18+
- Base wallet with USDC for payments
- x402 packages: `@x402/core`, `@x402/evm`, etc.