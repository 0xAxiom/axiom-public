#!/usr/bin/env node

// import { x402Fetch } from '@x402/fetch'; // For real payment handling

const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3000';
const CLIENT_WALLET = process.env.CLIENT_WALLET || 'demo-wallet-key'; // In real use, this would be a private key

console.log('🧪 x402 Content Gate Test Client');
console.log('=====================================');
console.log(`Server: ${SERVER_URL}`);
console.log(`Client wallet: ${CLIENT_WALLET}`);
console.log('');

async function testEndpoint(path, method = 'GET', body = null) {
  console.log(`Testing ${method} ${path}...`);
  
  try {
    const options = {
      method,
      headers: {
        'Content-Type': 'application/json'
      }
    };
    
    if (body) {
      options.body = JSON.stringify(body);
    }

    // First, try without payment to see the 402 response
    console.log('  📤 Making request without payment...');
    const normalResponse = await fetch(`${SERVER_URL}${path}`, options);
    
    if (normalResponse.status === 402) {
      console.log('  💳 Payment required! Trying with x402...');
      const paymentInfo = await normalResponse.json();
      console.log(`  💰 Price: ${paymentInfo.payment?.description} - $${(paymentInfo.payment?.amount / 1000000).toFixed(2)}`);
      
      // Try with x402Fetch (this would handle payment in real scenario)
      // Note: In demo mode, we'll simulate the payment flow
      console.log('  🔄 Simulating payment with x402...');
      
      // For demo purposes, we'll show what a real implementation would look like
      console.log('  ⚠️  Demo mode: In production, x402Fetch would:');
      console.log('     1. Prompt user to sign USDC transfer transaction');
      console.log('     2. Submit payment to facilitator');
      console.log('     3. Include payment hash in request header');
      console.log('     4. Receive actual data from server');
      
      return {
        demo: true,
        paymentRequired: paymentInfo.payment,
        note: 'This is a demo. Real x402Fetch would handle payment automatically.'
      };
    } else {
      const data = await normalResponse.json();
      console.log('  ✅ Success (no payment required)');
      return data;
    }
    
  } catch (error) {
    console.log(`  ❌ Error: ${error.message}`);
    return { error: error.message };
  }
}

async function runTests() {
  console.log('1. Testing free endpoints:');
  console.log('---------------------------');
  
  const healthResult = await testEndpoint('/health');
  console.log('  Result:', JSON.stringify(healthResult, null, 2));
  console.log('');
  
  const homeResult = await testEndpoint('/');
  console.log('  Result:', JSON.stringify(homeResult, null, 2));
  console.log('');
  
  console.log('2. Testing paid endpoints:');
  console.log('--------------------------');
  
  const weatherResult = await testEndpoint('/api/weather?city=London');
  console.log('  Result:', JSON.stringify(weatherResult, null, 2));
  console.log('');
  
  const cryptoResult = await testEndpoint('/api/crypto');
  console.log('  Result:', JSON.stringify(cryptoResult, null, 2));
  console.log('');
  
  const generateResult = await testEndpoint('/api/generate', 'POST', { 
    prompt: 'Write a haiku about blockchain payments' 
  });
  console.log('  Result:', JSON.stringify(generateResult, null, 2));
  console.log('');
  
  console.log('3. Integration with real x402:');
  console.log('------------------------------');
  console.log('To use with real payments, install a wallet extension and use:');
  console.log('');
  console.log('```javascript');
  console.log("import { x402Fetch } from '@x402/fetch';");
  console.log('');
  console.log('// This would automatically handle USDC payments');
  console.log("const response = await x402Fetch('http://localhost:3000/api/weather');");
  console.log('const data = await response.json();');
  console.log('```');
  console.log('');
  console.log('💡 Next steps:');
  console.log('- Set up a Base wallet with USDC');
  console.log('- Use a browser extension or wallet that supports x402');
  console.log('- Try the endpoints with real micropayments!');
}

runTests().catch(console.error);