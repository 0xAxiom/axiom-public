# x402 Content Gate - OpenClaw Skill

**Monetize your AI agent's API endpoints with USDC micropayments on Base**

This skill provides the x402 Content Gate middleware and utilities for implementing HTTP 402 Payment Required responses with USDC payments on Base blockchain.

## 🎯 What It Does

- **Protects API endpoints** behind micropayments
- **Uses x402 protocol** (HTTP 402 + USDC on Base)
- **Zero-config setup** with sensible defaults
- **Works with any Express app** via middleware
- **Includes demo server** for testing

## 📦 Installation

The skill includes both the npm package source and OpenClaw integration.

### As npm package:
```bash
npm install @axiom/x402-gate
```

### As OpenClaw skill:
This directory is the skill - copy or link it into your OpenClaw skills folder.

## 🚀 Usage

### Quick Start

```javascript
import express from 'express';
import { x402Gate } from '@axiom/x402-gate';

const app = express();

// Add payment gate
app.use(x402Gate({
  wallet: '0x523Eff3dB03938eaa31a5a6FBd41E3B9d23edde5',
  routes: {
    'GET /api/data': { price: '$0.01', description: 'Data access' },
    'POST /api/ai': { price: '$0.10', description: 'AI generation' },
  }
}));

// Your monetized endpoints
app.get('/api/data', (req, res) => {
  res.json({ valuable: 'data' });
});

app.listen(3000);
```

### Configuration

```typescript
interface X402GateConfig {
  wallet: string;              // Where USDC payments go
  routes: Record<string, {     // Route configurations
    price: string | number;    // '$0.01' or USDC units
    description: string;       // What the endpoint provides
    facilitatorUrl?: string;   // Optional custom facilitator
  }>;
  chainId?: number;           // Default: 8453 (Base)
  usdcAddress?: string;       // Default: Base USDC
  debug?: boolean;            // Enable debug logging
}
```

## 🎮 Demo

Run the included demo to see it in action:

```bash
# Start demo server (runs on port 3000)
npm run demo

# Test the endpoints
npm run test-client

# Or manually test
curl http://localhost:3000/api/weather
```

The demo includes:
- **Free endpoints**: `/` and `/health`
- **Paid endpoints**: `/api/weather` ($0.01), `/api/crypto` ($0.05), `/api/generate` ($0.10)

## 🔧 OpenClaw Integration

### Agent Usage

```javascript
// In your agent's API setup
const { x402Gate } = require('./skills/x402-gate/dist');

// Configure payment for your agent's services
app.use(x402Gate({
  wallet: process.env.AGENT_WALLET,
  debug: process.env.NODE_ENV !== 'production',
  routes: {
    'GET /agent/analyze': {
      price: '$0.05',
      description: 'AI content analysis'
    },
    'POST /agent/generate': {
      price: '$0.20',
      description: 'AI content generation'
    },
    'GET /agent/data/*': {
      price: '$0.02',
      description: 'Dynamic data endpoints'
    }
  }
}));
```

### Environment Variables

```bash
# Set in your agent's environment
AGENT_WALLET=0x523Eff3dB03938eaa31a5a6FBd41E3B9d23edde5
NODE_ENV=production
PORT=3000
```

## 🌊 Payment Flow

1. **Client requests** protected endpoint without payment
2. **Server returns 402** with payment requirements:
   ```json
   {
     "error": "Payment Required",
     "payment": {
       "amount": "10000",
       "currency": "USDC", 
       "recipient": "0x523Eff...",
       "facilitator": "https://x402.org/facilitator",
       "chainId": 8453
     }
   }
   ```
3. **Client pays** using x402-compatible wallet/library
4. **Server verifies** payment and returns data

## 🛠 Utilities

### Price Conversion

```javascript
import { parsePriceToUsdc, formatUsdcToPrice } from '@axiom/x402-gate';

// Convert prices
const usdcUnits = parsePriceToUsdc('$0.01');  // '10000'
const priceDisplay = formatUsdcToPrice(10000); // '$0.01'
```

### Payment Verification

```javascript
import { verifyPayment } from '@axiom/x402-gate';

const result = await verifyPayment(
  paymentHash,
  {
    amount: '10000',
    currency: 'USDC',
    recipient: '0x523Eff...',
    facilitator: 'https://x402.org/facilitator',
    description: 'API access'
  }
);

if (result.valid) {
  // Payment confirmed, serve content
}
```

## 🎯 Use Cases

### Data APIs
```javascript
routes: {
  'GET /api/prices': { price: '$0.01', description: 'Market prices' },
  'GET /api/news': { price: '$0.02', description: 'Curated news' }
}
```

### AI Services
```javascript
routes: {
  'POST /ai/summarize': { price: '$0.05', description: 'Text summary' },
  'POST /ai/translate': { price: '$0.03', description: 'Translation' },
  'POST /ai/analyze': { price: '$0.10', description: 'Deep analysis' }
}
```

### Premium Features
```javascript
routes: {
  'POST /premium/forecast': { price: '$0.25', description: 'AI forecasts' },
  'GET /premium/signals': { price: '$0.50', description: 'Trading signals' }
}
```

## 🔒 Security Notes

- **Never store private keys** in your config
- **Only wallet addresses** are needed for receiving payments
- **All payments verified** via x402 facilitator before serving content
- **Use HTTPS** in production
- **Consider rate limiting** for additional protection

## 🧪 Testing

```bash
# Build the TypeScript
npm run build

# Start demo server
npm run demo

# Test with client
npm run test-client

# Manual testing
curl http://localhost:3000/api/weather
# Returns 402 Payment Required

curl http://localhost:3000/health  
# Returns data (no payment required)
```

## 🔗 Client Libraries

Use these libraries to consume x402-protected endpoints:

- **[@x402/fetch](https://www.npmjs.com/package/@x402/fetch)** - Auto-paying fetch wrapper
- **[@x402/core](https://www.npmjs.com/package/@x402/core)** - Core x402 utilities
- **Browser extensions** - Wallet integrations for seamless UX

## 📚 Examples

See the `examples/` directory for:

- **express-api.ts** - Complete AI agent API setup
- **Integration patterns** for different use cases
- **Error handling** best practices

## 🐛 Troubleshooting

### Common Issues

1. **"Payment verification failed"**
   - Check facilitator URL is correct
   - Ensure wallet address matches payment recipient
   - Verify payment was actually sent

2. **"Invalid wallet address"**
   - Wallet must be valid Ethereum address starting with 0x
   - Use checksummed addresses when possible

3. **"Module not found"**
   - Run `npm run build` to compile TypeScript
   - Check import paths are correct

### Debug Mode

Enable debug logging to see payment flow:

```javascript
app.use(x402Gate({
  wallet: '0x...',
  debug: true,  // Shows payment attempts and verification
  routes: { ... }
}));
```

## 🚀 Production Deployment

1. **Build the package**: `npm run build`
2. **Set environment variables**:
   ```bash
   AGENT_WALLET=0xYourWallet
   NODE_ENV=production
   PORT=8080
   ```
3. **Use HTTPS** for secure payments
4. **Monitor payments** via your wallet or Base block explorer
5. **Consider caching** verification results for performance

---

**Ready to monetize your agent? Drop the middleware in and start earning USDC! 💰**