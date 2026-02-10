# stripe-x402 💳

Paid API endpoints using Stripe Machine Payments + x402 protocol. USDC on Base.

## Endpoints

| Path | Price | Description |
|------|-------|-------------|
| `GET /health` | Free | Status + endpoint catalog |
| `GET /research?q=<topic>` | $0.05 | AI research summary |
| `GET /analyze?contract=<addr>` | $0.10 | Contract analysis |

## Setup

```bash
npm install
export STRIPE_SECRET_KEY=sk_...  # requires crypto payins enabled
node scripts/server.mjs
```

Runs on port 4020 (or `PORT` env). Without Stripe key, runs in dry-run mode returning 402 responses with treasury address as payTo.

## How It Works

1. Agent hits endpoint without payment → gets HTTP 402 + x402 payment requirements
2. Agent pays USDC on Base to the deposit address
3. Agent retries with `X-PAYMENT` header containing payment proof
4. Server verifies via Stripe → returns content

## Test

```bash
# Health check
curl http://localhost:4020/health

# Get payment requirements (402)
curl http://localhost:4020/research?q=uniswap
```

## License

MIT
