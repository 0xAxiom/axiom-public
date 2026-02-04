# x402 Content Gate

[![npm version](https://img.shields.io/npm/v/@axiom/x402-gate.svg)](https://www.npmjs.com/package/@axiom/x402-gate)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

🚀 **Monetize any AI agent's API endpoints instantly with USDC micropayments on Base**

An OpenClaw skill and npm package that implements the [x402 protocol](https://github.com/coinbase/x402) for HTTP 402 Payment Required responses. Drop it into any Express app to start charging for API access using USDC on Base blockchain.

## 🎯 Features

- **Zero-config setup** - Just provide a wallet address
- **USDC on Base** - Fast, cheap transactions via x402 protocol
- **Express middleware** - Drop into any existing Node.js API
- **TypeScript support** - Fully typed for better DX
- **Demo included** - Working example with test client
- **OpenClaw skill** - Ready-to-use agent capability

## 🚀 Quick Start

### Install

```bash
npm install @axiom/x402-gate
```

### Basic Usage

```javascript
import express from 'express';
import { x402Gate } from '@axiom/x402-gate';

const app = express();

// Configure payment gate
app.use(x402Gate({
  wallet: '0xYourWalletAddress',  // Where USDC payments go
  routes: {
    'GET /api/data': { price: '$0.01', description: 'Get data' },
    'POST /api/generate': { price: '$0.10', description: 'AI generation' },
  }
}));

// Your API routes (now monetized!)
app.get('/api/data', (req, res) => {
  res.json({ data: 'valuable information' });
});

app.listen(3000);
```

### Client Usage

Use [@x402/fetch](https://www.npmjs.com/package/@x402/fetch) to automatically handle payments:

```javascript
import { x402Fetch } from '@x402/fetch';

// Client automatically pays and gets data
const response = await x402Fetch('http://localhost:3000/api/data');
const data = await response.json();
```

## 💡 How It Works

1. **Client requests** protected endpoint
2. **Server responds** with 402 Payment Required + payment details
3. **Client pays** USDC on Base via x402 facilitator
4. **Server verifies** payment and returns data
5. **Everyone profits!** 💰

## 🔧 Configuration

```typescript
interface X402GateConfig {
  wallet: string;              // Your wallet address (required)
  routes: Record<string, {     // Route payment configuration
    price: string | number;    // '$0.01' or USDC units (10000)
    description: string;       // Human readable description
    facilitatorUrl?: string;   // Optional custom facilitator
  }>;
  chainId?: number;           // Default: 8453 (Base)
  usdcAddress?: string;       // Default: Base USDC contract
  debug?: boolean;            // Enable logging
}
```

### Route Patterns

```javascript
routes: {
  // Exact paths
  'GET /api/weather': { price: '$0.01', description: 'Weather data' },
  'POST /api/generate': { price: '$0.10', description: 'AI generation' },
  
  // Wildcards (future feature)
  'GET /api/data/*': { price: '$0.005', description: 'Any data endpoint' },
}
```

### Price Formats

```javascript
// USD strings (converted to USDC automatically)
price: '$0.01'    // 10,000 USDC units (6 decimals)
price: '$1.50'    // 1,500,000 USDC units

// Direct USDC units
price: 10000      // $0.01 USD
price: 1500000    // $1.50 USD
```

## 🎮 Try the Demo

```bash
git clone https://github.com/0xAxiom/axiom-public.git
cd axiom-public/agent-tools/skills/x402-gate

npm install
npm run build

# Start demo server
npm run demo

# Test in another terminal
npm run test-client
```

Visit http://localhost:3000 to explore the API and see payment requirements.

## 📚 Examples

### AI Agent API

See [examples/express-api.ts](examples/express-api.ts) for a complete AI agent setup with:

- Data endpoints ($0.01-$0.02)
- AI services ($0.03-$0.10) 
- Premium features ($0.25-$0.50)
- Free public endpoints

### OpenClaw Skill

This package includes an OpenClaw skill for easy agent integration. See [SKILL.md](SKILL.md) for usage instructions.

## 🔒 Security

- **No private keys** - Only wallet addresses are stored
- **Payment verification** - All payments verified via x402 facilitator
- **Error handling** - Graceful failure modes
- **Rate limiting** - Use with express-rate-limit for additional protection

## 🌐 Protocol Details

Built on [x402 by Coinbase](https://github.com/coinbase/x402):

- **Chain**: Base (8453)
- **Token**: USDC (0x833589fcd6edb6e08f4c7c32d4f71b54bda02913)
- **Facilitator**: https://x402.org/facilitator
- **Standard**: HTTP 402 Payment Required

## 🛠 API Reference

### `x402Gate(config)`

Express middleware that protects routes with payment requirements.

### `verifyPayment(hash, payment, facilitator)`

Verify a payment hash with the x402 facilitator.

### `parsePriceToUsdc(price)`

Convert price strings to USDC units.

### `formatUsdcToPrice(usdc)`

Format USDC units as human-readable prices.

## 🤝 Contributing

Built for the [USDC Agent Hackathon](https://usdc.party). Contributions welcome!

1. Fork the repo
2. Make your changes
3. Add tests
4. Submit a PR

## 📄 License

MIT License - see [LICENSE](LICENSE) file for details.

## 🔗 Links

- [x402 Protocol](https://github.com/coinbase/x402)
- [Base Network](https://base.org)
- [USDC Agent Hackathon](https://usdc.party)
- [Axiom GitHub](https://github.com/0xAxiom/axiom-public)

---

**Made with ⚡ by [Axiom](https://github.com/0xAxiom) for the agent economy**