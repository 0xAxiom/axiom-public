require('dotenv').config();
const express = require('express');
const cors = require('cors');
const http = require('http');
const path = require('path');
const cron = require('node-cron');

const AgentPulseDB = require('./database');
const TransactionProcessor = require('./txProcessor');
const WebSocketServer = require('./websocket');
const { generateSampleData } = require('./sampleData');

// Initialize services
const app = express();
const server = http.createServer(app);
const db = new AgentPulseDB();
const txProcessor = new TransactionProcessor(process.env.ETHERSCAN_API_KEY || '47JMQ2USAJHMGF6URVA2D85D7Q77XXDI9F');
const wsServer = new WebSocketServer(server);

// Middleware
app.use(cors());
app.use(express.json());

// Serve static frontend files
app.use(express.static(path.join(__dirname, '../../frontend/build')));

// API Routes
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: Date.now(),
    connections: wsServer.getConnectionCount(),
    database: 'connected'
  });
});

app.get('/api/agents', (req, res) => {
  try {
    const agents = db.getAgents();
    const agentsWithStats = agents.map(agent => ({
      ...agent,
      stats: db.getAgentStats(agent.address, 24)
    }));
    res.json(agentsWithStats);
  } catch (error) {
    console.error('Error getting agents:', error);
    res.status(500).json({ error: 'Failed to get agents' });
  }
});

app.get('/api/agents/:address', (req, res) => {
  try {
    const { address } = req.params;
    const agent = db.getAgent(address);
    
    if (!agent) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    const stats = db.getAgentStats(address, 24);
    const recentTxs = db.getTransactions(50, null, address);

    res.json({
      ...agent,
      stats,
      recent_transactions: recentTxs
    });
  } catch (error) {
    console.error('Error getting agent:', error);
    res.status(500).json({ error: 'Failed to get agent' });
  }
});

app.get('/api/stats', (req, res) => {
  try {
    const window = parseInt(req.query.window) || 24;
    const stats = db.getAggregateStats(window);
    res.json(stats);
  } catch (error) {
    console.error('Error getting stats:', error);
    res.status(500).json({ error: 'Failed to get stats' });
  }
});

app.get('/api/feed', (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    const category = req.query.category;
    const agent = req.query.agent;
    
    const transactions = db.getTransactions(limit, category, agent);
    res.json(transactions);
  } catch (error) {
    console.error('Error getting feed:', error);
    res.status(500).json({ error: 'Failed to get feed' });
  }
});

app.post('/api/agents', (req, res) => {
  try {
    const { address, name, twitter, framework } = req.body;
    
    if (!address || !name) {
      return res.status(400).json({ error: 'Address and name are required' });
    }

    // Validate address format
    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
      return res.status(400).json({ error: 'Invalid address format' });
    }

    const existing = db.getAgent(address);
    if (existing) {
      return res.status(409).json({ error: 'Agent already exists' });
    }

    db.addAgent({
      address: address.toLowerCase(),
      name,
      twitter,
      framework: framework || 'unknown'
    });

    // Start fetching historical transactions for this agent
    fetchHistoricalData(address.toLowerCase());

    res.json({ success: true, message: 'Agent added successfully' });
  } catch (error) {
    console.error('Error adding agent:', error);
    res.status(500).json({ error: 'Failed to add agent' });
  }
});

// Catch-all handler for React frontend
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../../frontend/build/index.html'));
});

// Background tasks
async function fetchHistoricalData(address = null) {
  try {
    console.log('📊 Fetching historical data...');
    
    const agents = address ? [{ address }] : db.getAgents();
    
    for (const agent of agents) {
      console.log(`📥 Fetching history for ${agent.address}...`);
      const transactions = await txProcessor.getHistoricalTransactions(agent.address);
      
      let added = 0;
      for (const tx of transactions) {
        try {
          const result = db.addTransaction(tx);
          if (result.changes > 0) {
            added++;
            // Broadcast new transaction
            wsServer.broadcastTransaction({
              ...tx,
              agent_name: agent.name || 'Unknown'
            });
          }
        } catch (error) {
          console.error('Error adding transaction:', error);
        }
      }
      
      console.log(`✅ Added ${added} new transactions for ${agent.address}`);
      
      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    // Broadcast updated stats
    const stats = db.getAggregateStats(24);
    wsServer.broadcastStats(stats);
    
  } catch (error) {
    console.error('Error in fetchHistoricalData:', error);
  }
}

// Monitor for new transactions (every 2 minutes)
cron.schedule('*/2 * * * *', () => {
  fetchHistoricalData();
});

// Broadcast stats update every 5 minutes
cron.schedule('*/5 * * * *', () => {
  try {
    const stats = db.getAggregateStats(24);
    wsServer.broadcastStats(stats);
  } catch (error) {
    console.error('Error broadcasting stats:', error);
  }
});

// Initial data fetch on startup
setTimeout(() => {
  fetchHistoricalData();
  
  // Add sample data for demo (remove in production)
  setTimeout(() => {
    generateSampleData(db);
    // Broadcast updated stats after adding sample data
    const stats = db.getAggregateStats(24);
    wsServer.broadcastStats(stats);
  }, 2000);
}, 5000); // Wait 5 seconds after startup

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('🛑 Shutting down gracefully...');
  db.close();
  server.close(() => {
    process.exit(0);
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`🚀 Agent Pulse server running on port ${PORT}`);
  console.log(`📊 Database initialized`);
  console.log(`🔌 WebSocket server ready at ws://localhost:${PORT}/ws`);
  console.log(`🌐 Dashboard available at http://localhost:${PORT}`);
});