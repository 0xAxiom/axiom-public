#!/usr/bin/env node

import express from 'express';
import { x402Gate } from '../dist/index.js';

const app = express();
const PORT = process.env.PORT || 3000;
const WALLET = process.env.WALLET || '0x523Eff3dB03938eaa31a5a6FBd41E3B9d23edde5';

app.use(express.json());

// Configure x402 payment gate
app.use(x402Gate({
  wallet: WALLET,
  debug: true,
  routes: {
    'GET /api/weather': {
      price: '$0.01',
      description: 'Current weather data for any city'
    },
    'GET /api/crypto': {
      price: '$0.05', 
      description: 'Real-time cryptocurrency prices'
    },
    'POST /api/generate': {
      price: '$0.10',
      description: 'AI-powered content generation'
    }
  }
}));

// Free endpoint (no payment required)
app.get('/', (req, res) => {
  res.json({
    message: 'x402 Content Gate Demo Server',
    endpoints: {
      'GET /': 'This endpoint (free)',
      'GET /health': 'Health check (free)',
      'GET /api/weather': 'Weather data ($0.01)',
      'GET /api/crypto': 'Crypto prices ($0.05)',
      'POST /api/generate': 'AI generation ($0.10)'
    },
    instructions: {
      step1: 'Try accessing a paid endpoint to see the 402 response',
      step2: 'Use the test client: npm run test-client',
      step3: 'Or use @x402/fetch in your own code'
    }
  });
});

// Free health check
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Paid endpoints - these require payment
app.get('/api/weather', (req, res) => {
  const city = req.query.city || 'San Francisco';
  res.json({
    city,
    temperature: Math.round(15 + Math.random() * 20), // Mock data
    condition: ['Sunny', 'Cloudy', 'Rainy', 'Windy'][Math.floor(Math.random() * 4)],
    humidity: Math.round(30 + Math.random() * 40),
    timestamp: new Date().toISOString()
  });
});

app.get('/api/crypto', (req, res) => {
  res.json({
    bitcoin: {
      price: 42000 + Math.random() * 10000,
      change24h: -5 + Math.random() * 10
    },
    ethereum: {
      price: 2500 + Math.random() * 1000,
      change24h: -5 + Math.random() * 10
    },
    usdc: {
      price: 1.00 + (Math.random() - 0.5) * 0.01,
      change24h: (Math.random() - 0.5) * 0.5
    },
    timestamp: new Date().toISOString()
  });
});

app.post('/api/generate', (req, res) => {
  const { prompt } = req.body;
  if (!prompt) {
    return res.status(400).json({ error: 'Prompt required' });
  }
  
  res.json({
    prompt,
    generated: `This is AI-generated content based on: "${prompt}". Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.`,
    model: 'demo-ai-v1',
    tokens: Math.round(50 + Math.random() * 200),
    timestamp: new Date().toISOString()
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ 
    error: 'Not Found',
    message: `Endpoint ${req.method} ${req.path} does not exist`
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ 
    error: 'Internal Server Error',
    message: err.message 
  });
});

app.listen(PORT, () => {
  console.log(`🚀 x402 Content Gate Demo Server running on port ${PORT}`);
  console.log(`💰 Payments go to wallet: ${WALLET}`);
  console.log(`📖 Visit http://localhost:${PORT} for endpoint documentation`);
  console.log(`💳 Try: curl http://localhost:${PORT}/api/weather`);
});