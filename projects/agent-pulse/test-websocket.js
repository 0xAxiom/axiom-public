// Simple WebSocket test script
const WebSocket = require('ws');

console.log('🔌 Testing Agent Pulse WebSocket connection...');

const ws = new WebSocket('ws://localhost:3001/ws');

ws.on('open', () => {
  console.log('✅ Connected to Agent Pulse WebSocket');
  
  // Subscribe to feeds
  ws.send(JSON.stringify({
    type: 'subscribe',
    channels: ['feed', 'stats']
  }));
  
  // Send ping
  setTimeout(() => {
    ws.send(JSON.stringify({ type: 'ping' }));
  }, 1000);
});

ws.on('message', (data) => {
  try {
    const message = JSON.parse(data.toString());
    console.log('📦 Received:', JSON.stringify(message, null, 2));
  } catch (error) {
    console.log('📦 Raw message:', data.toString());
  }
});

ws.on('close', () => {
  console.log('🔌 WebSocket connection closed');
});

ws.on('error', (error) => {
  console.error('❌ WebSocket error:', error);
});

// Keep alive for 10 seconds
setTimeout(() => {
  console.log('⏰ Test complete, closing connection...');
  ws.close();
  process.exit(0);
}, 10000);