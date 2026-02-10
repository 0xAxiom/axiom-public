# Stripe x402 Machine Payments

Paid API server using Stripe's machine payments (x402 protocol) for agent-to-agent commerce. USDC on Base.

## Prerequisites
- Stripe account with crypto payins enabled
- `STRIPE_SECRET_KEY` in environment
- Node.js 18+

## Run
```bash
cd /Users/melted/Github/axiom-public/agent-skills/skills/stripe-x402
npm install
STRIPE_SECRET_KEY=sk_... node scripts/server.mjs
```

## Endpoints
- `GET /health` — free status
- `GET /research?q=<topic>` — $0.05 USDC, AI research
- `GET /analyze?contract=<addr>` — $0.10 USDC, contract analysis

## Adding New Endpoints
Use `requirePayment(priceUSD)` middleware on any Hono route.
