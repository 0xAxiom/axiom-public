import express from 'express';
import { x402Gate, X402GateConfig } from '@axiom/x402-gate';

const app = express();
app.use(express.json());

// Example configuration for an AI agent's API
const paymentConfig: X402GateConfig = {
  wallet: '0x523Eff3dB03938eaa31a5a6FBd41E3B9d23edde5', // Replace with your wallet
  debug: process.env.NODE_ENV !== 'production',
  routes: {
    // Data endpoints
    'GET /api/data/prices': {
      price: '$0.01',
      description: 'Real-time market prices'
    },
    'GET /api/data/news': {
      price: '$0.02',
      description: 'Curated news feed'
    },
    
    // AI services
    'POST /api/ai/summarize': {
      price: '$0.05',
      description: 'Text summarization service'
    },
    'POST /api/ai/translate': {
      price: '$0.03',
      description: 'Language translation'
    },
    'POST /api/ai/analyze': {
      price: '$0.10',
      description: 'Advanced content analysis'
    },
    
    // Premium services
    'POST /api/premium/forecast': {
      price: '$0.25',
      description: 'AI-powered market forecasting'
    },
    'GET /api/premium/signals': {
      price: '$0.50',
      description: 'Trading signals and insights'
    },
    
    // Wildcard pattern for dynamic routes
    'GET /api/data/*': {
      price: '$0.01',
      description: 'Dynamic data endpoints'
    }
  }
};

// Apply payment gate middleware
app.use(x402Gate(paymentConfig));

// Free public endpoints
app.get('/', (req, res) => {
  res.json({
    name: 'AI Agent API',
    version: '1.0.0',
    endpoints: Object.keys(paymentConfig.routes),
    wallet: paymentConfig.wallet
  });
});

app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// Protected endpoints - payment required
app.get('/api/data/prices', (req, res) => {
  res.json({
    btc: { price: 45000, change: '+2.5%' },
    eth: { price: 3200, change: '+1.8%' },
    usdc: { price: 1.00, change: '0.0%' },
    timestamp: new Date().toISOString()
  });
});

app.get('/api/data/news', (req, res) => {
  res.json({
    headlines: [
      'Crypto adoption reaches new milestone',
      'DeFi protocol launches innovative features',
      'Web3 gaming sees explosive growth'
    ],
    timestamp: new Date().toISOString()
  });
});

app.post('/api/ai/summarize', (req, res) => {
  const { text } = req.body;
  if (!text) {
    return res.status(400).json({ error: 'Text content required' });
  }
  
  res.json({
    summary: `Summary of provided text: ${text.substring(0, 100)}...`,
    originalLength: text.length,
    summaryLength: 50,
    compressionRatio: '90%'
  });
});

app.post('/api/ai/translate', (req, res) => {
  const { text, targetLanguage = 'en' } = req.body;
  
  res.json({
    originalText: text,
    translatedText: `[${targetLanguage.toUpperCase()}] ${text}`,
    sourceLanguage: 'auto-detected',
    targetLanguage,
    confidence: 0.95
  });
});

app.post('/api/ai/analyze', (req, res) => {
  const { content } = req.body;
  
  res.json({
    sentiment: 'positive',
    topics: ['technology', 'finance', 'innovation'],
    keyPhrases: ['blockchain', 'decentralized', 'smart contracts'],
    complexity: 'intermediate',
    readabilityScore: 85,
    wordCount: content?.length || 0
  });
});

app.post('/api/premium/forecast', (req, res) => {
  const { asset, timeframe = '24h' } = req.body;
  
  res.json({
    asset,
    timeframe,
    prediction: {
      direction: 'bullish',
      confidence: 0.72,
      targetPrice: '$47,500',
      reasoning: 'Technical indicators suggest upward momentum'
    },
    disclaimer: 'Not financial advice. Do your own research.'
  });
});

app.get('/api/premium/signals', (req, res) => {
  res.json({
    signals: [
      {
        asset: 'BTC',
        action: 'BUY',
        strength: 'STRONG',
        price: '$45,200',
        target: '$47,500',
        stopLoss: '$43,000'
      },
      {
        asset: 'ETH',
        action: 'HOLD',
        strength: 'MODERATE',
        price: '$3,180',
        target: '$3,400',
        stopLoss: '$3,000'
      }
    ],
    generated: new Date().toISOString()
  });
});

// Dynamic route example
app.get('/api/data/:category', (req, res) => {
  const { category } = req.params;
  res.json({
    category,
    data: `Dynamic data for ${category}`,
    timestamp: new Date().toISOString()
  });
});

// Error handling
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Server error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 3000;

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`🤖 AI Agent API running on port ${PORT}`);
    console.log(`💰 Payments directed to: ${paymentConfig.wallet}`);
    console.log(`🔗 Base blockchain (Chain ID: 8453)`);
    console.log(`📚 API documentation: http://localhost:${PORT}`);
  });
}

export default app;