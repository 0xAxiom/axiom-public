const WebSocket = require('ws');

class WebSocketServer {
  constructor(server) {
    this.wss = new WebSocket.Server({ server, path: '/ws' });
    this.clients = new Map(); // Store client connections with subscriptions
    this.init();
  }

  init() {
    this.wss.on('connection', (ws, req) => {
      const clientId = Math.random().toString(36).substr(2, 9);
      this.clients.set(clientId, {
        ws,
        subscriptions: new Set(['feed']) // Default subscription
      });

      console.log(`🔌 Client ${clientId} connected`);

      ws.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString());
          this.handleMessage(clientId, message);
        } catch (error) {
          console.error('Invalid WebSocket message:', error);
        }
      });

      ws.on('close', () => {
        this.clients.delete(clientId);
        console.log(`🔌 Client ${clientId} disconnected`);
      });

      ws.on('error', (error) => {
        console.error('WebSocket error:', error);
        this.clients.delete(clientId);
      });

      // Send welcome message
      this.sendToClient(clientId, {
        type: 'connected',
        data: { clientId, subscriptions: ['feed'] }
      });
    });

    console.log('✅ WebSocket server initialized');
  }

  handleMessage(clientId, message) {
    const client = this.clients.get(clientId);
    if (!client) return;

    switch (message.type) {
      case 'subscribe':
        if (Array.isArray(message.channels)) {
          message.channels.forEach(channel => {
            client.subscriptions.add(channel);
          });
          this.sendToClient(clientId, {
            type: 'subscribed',
            data: { channels: message.channels }
          });
        }
        break;

      case 'unsubscribe':
        if (Array.isArray(message.channels)) {
          message.channels.forEach(channel => {
            client.subscriptions.delete(channel);
          });
          this.sendToClient(clientId, {
            type: 'unsubscribed',
            data: { channels: message.channels }
          });
        }
        break;

      case 'ping':
        this.sendToClient(clientId, { type: 'pong', timestamp: Date.now() });
        break;

      default:
        console.log('Unknown message type:', message.type);
    }
  }

  sendToClient(clientId, message) {
    const client = this.clients.get(clientId);
    if (client && client.ws.readyState === WebSocket.OPEN) {
      try {
        client.ws.send(JSON.stringify(message));
      } catch (error) {
        console.error('Error sending to client:', error);
      }
    }
  }

  broadcast(channel, message) {
    const data = {
      type: channel,
      timestamp: Date.now(),
      data: message
    };

    this.clients.forEach((client, clientId) => {
      if (client.subscriptions.has(channel)) {
        this.sendToClient(clientId, data);
      }
    });
  }

  // Broadcast new transaction
  broadcastTransaction(tx) {
    this.broadcast('tx', tx);
  }

  // Broadcast updated stats
  broadcastStats(stats) {
    this.broadcast('stats', stats);
  }

  // Get connection count
  getConnectionCount() {
    return this.clients.size;
  }
}

module.exports = WebSocketServer;