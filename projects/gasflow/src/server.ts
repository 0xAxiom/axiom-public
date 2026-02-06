import express from 'express';
import cors from 'cors';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import { GasCollector } from './collector';
import { GasPredictor } from './predictor';
import { RouteOptimizer } from './router';
import { CHAINS } from './types';

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

// Initialize services
const collector = new GasCollector();
const db = collector.getDatabase();
const predictor = new GasPredictor(db);
const router = new RouteOptimizer(db);

// Middleware
app.use(cors());
app.use(express.json());

// Add request logging
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: Date.now(),
    chains: Object.keys(CHAINS).length,
    uptime: process.uptime()
  });
});

// Get current gas prices for all chains
app.get('/api/gas', async (req, res) => {
  try {
    const snapshots = db.getAllLatestSnapshots();
    const gasData = snapshots.map(snapshot => {
      const chain = CHAINS[snapshot.chainId];
      const totalGas = snapshot.baseFee + snapshot.priorityFee;
      
      return {
        chainId: snapshot.chainId,
        chainName: chain.name,
        symbol: chain.symbol,
        baseFee: snapshot.baseFee.toString(),
        priorityFee: snapshot.priorityFee.toString(),
        totalGas: totalGas.toString(),
        totalGasGwei: Number(totalGas) / 1e9,
        pendingTxCount: snapshot.pendingTxCount,
        blockNumber: snapshot.blockNumber,
        timestamp: snapshot.timestamp,
        lastUpdated: new Date(snapshot.timestamp).toISOString()
      };
    });

    // Sort by total gas cost
    gasData.sort((a, b) => Number(a.totalGas) - Number(b.totalGas));

    res.json({
      success: true,
      timestamp: Date.now(),
      chains: gasData
    });
  } catch (error) {
    console.error('Error fetching gas data:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch gas data'
    });
  }
});

// Get gas data for specific chain
app.get('/api/gas/:chainId', async (req, res) => {
  try {
    const chainId = parseInt(req.params.chainId);
    const chain = CHAINS[chainId];
    
    if (!chain) {
      return res.status(404).json({
        success: false,
        error: 'Chain not supported'
      });
    }

    const snapshot = db.getLatestSnapshot(chainId);
    if (!snapshot) {
      return res.status(404).json({
        success: false,
        error: 'No data available for this chain'
      });
    }

    const totalGas = snapshot.baseFee + snapshot.priorityFee;
    
    // Get historical data for context
    const historical = db.getRecentSnapshots(chainId, 1).slice(0, 100); // Last 100 data points
    
    res.json({
      success: true,
      chainId,
      chainName: chain.name,
      current: {
        baseFee: snapshot.baseFee.toString(),
        priorityFee: snapshot.priorityFee.toString(),
        totalGas: totalGas.toString(),
        totalGasGwei: Number(totalGas) / 1e9,
        pendingTxCount: snapshot.pendingTxCount,
        blockNumber: snapshot.blockNumber,
        timestamp: snapshot.timestamp
      },
      historical: historical.map(h => ({
        timestamp: h.timestamp,
        totalGas: (h.baseFee + h.priorityFee).toString(),
        totalGasGwei: Number(h.baseFee + h.priorityFee) / 1e9
      }))
    });
  } catch (error) {
    console.error('Error fetching chain gas data:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch chain data'
    });
  }
});

// Get predictions for specific chain
app.get('/api/predict/:chainId', async (req, res) => {
  try {
    const chainId = parseInt(req.params.chainId);
    const chain = CHAINS[chainId];
    
    if (!chain) {
      return res.status(404).json({
        success: false,
        error: 'Chain not supported'
      });
    }

    // Get latest prediction
    let prediction = db.getLatestPrediction(chainId);
    
    // Generate new prediction if none exists or it's old (>5 minutes)
    if (!prediction || Date.now() - prediction.timestamp > 5 * 60 * 1000) {
      prediction = await predictor.generatePrediction(chainId);
    }

    if (!prediction) {
      return res.status(404).json({
        success: false,
        error: 'Unable to generate prediction - insufficient data'
      });
    }

    res.json({
      success: true,
      chainId,
      chainName: chain.name,
      prediction: {
        timestamp: prediction.timestamp,
        predictions: {
          '15min': {
            fee: prediction.predicted15min.fee.toString(),
            feeGwei: Number(prediction.predicted15min.fee) / 1e9,
            confidence: prediction.predicted15min.confidence
          },
          '30min': {
            fee: prediction.predicted30min.fee.toString(),
            feeGwei: Number(prediction.predicted30min.fee) / 1e9,
            confidence: prediction.predicted30min.confidence
          },
          '60min': {
            fee: prediction.predicted60min.fee.toString(),
            feeGwei: Number(prediction.predicted60min.fee) / 1e9,
            confidence: prediction.predicted60min.confidence
          }
        },
        recommendation: prediction.recommendation,
        reasoning: prediction.reasoning
      }
    });
  } catch (error) {
    console.error('Error generating prediction:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate prediction'
    });
  }
});

// Get route optimization
app.get('/api/route', async (req, res) => {
  try {
    const { action = 'swap', value, userChain } = req.query;
    
    const numValue = value ? parseFloat(value as string) : 1000;
    const numUserChain = userChain ? parseInt(userChain as string) : undefined;

    const comparison = await router.optimizeRoute(
      action as string,
      numValue,
      numUserChain
    );

    res.json({
      success: true,
      optimization: {
        action,
        value: numValue,
        userChain: numUserChain,
        bestChain: comparison.bestRoute,
        bestChainName: CHAINS[comparison.bestRoute]?.name,
        maxSavingsUSD: comparison.savings,
        routes: comparison.routes.map(route => ({
          chainId: route.chainId,
          chainName: route.chainName,
          gasCostUSD: route.gasCostUSD,
          bridgeCostUSD: route.bridgeCost ? route.totalCostUSD - route.gasCostUSD : 0,
          totalCostUSD: route.totalCostUSD,
          savings: comparison.routes[0].totalCostUSD === route.totalCostUSD ? 0 :
                   comparison.routes[0].totalCostUSD - route.totalCostUSD
        }))
      }
    });
  } catch (error) {
    console.error('Error optimizing route:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to optimize route'
    });
  }
});

// Get market summary
app.get('/api/summary', async (req, res) => {
  try {
    const [marketSummary, savingsOpp] = await Promise.all([
      predictor.getMarketSummary(),
      router.getSavingsOpportunities()
    ]);

    res.json({
      success: true,
      summary: {
        market: marketSummary,
        savings: savingsOpp,
        bestChains: {
          cheapest: marketSummary.cheapestChain ? CHAINS[marketSummary.cheapestChain]?.name : null,
          mostExpensive: marketSummary.mostExpensiveChain ? CHAINS[marketSummary.mostExpensiveChain]?.name : null,
          forSwaps: CHAINS[savingsOpp.bestChainForSwaps]?.name,
          forTransfers: CHAINS[savingsOpp.bestChainForTransfers]?.name
        }
      }
    });
  } catch (error) {
    console.error('Error generating summary:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate summary'
    });
  }
});

// WebSocket for real-time updates
wss.on('connection', (ws) => {
  console.log('WebSocket client connected');

  // Send initial data
  const sendUpdate = async () => {
    try {
      const snapshots = db.getAllLatestSnapshots();
      const gasData = snapshots.map(snapshot => {
        const chain = CHAINS[snapshot.chainId];
        const totalGas = snapshot.baseFee + snapshot.priorityFee;
        
        return {
          chainId: snapshot.chainId,
          chainName: chain.name,
          totalGasGwei: Number(totalGas) / 1e9,
          timestamp: snapshot.timestamp
        };
      });

      ws.send(JSON.stringify({
        type: 'gas_update',
        data: gasData,
        timestamp: Date.now()
      }));
    } catch (error) {
      console.error('Error sending WebSocket update:', error);
    }
  };

  // Send initial update
  sendUpdate();

  // Set up periodic updates every 10 seconds
  const interval = setInterval(sendUpdate, 10000);

  ws.on('close', () => {
    console.log('WebSocket client disconnected');
    clearInterval(interval);
  });

  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
    clearInterval(interval);
  });
});

// Error handling
app.use((error: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Unhandled error:', error);
  res.status(500).json({
    success: false,
    error: 'Internal server error'
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint not found'
  });
});

const PORT = process.env.PORT || 3001;

// Start the server
server.listen(PORT, () => {
  console.log(`🚀 GasFlow API server running on port ${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/api/health`);
  console.log(`⛽ Gas data: http://localhost:${PORT}/api/gas`);
  console.log(`🔮 Predictions: http://localhost:${PORT}/api/predict/8453`);
  console.log(`🗺️ Route optimization: http://localhost:${PORT}/api/route?action=swap`);
  
  // Start gas collection
  collector.startPolling(5).catch(console.error);
  
  // Generate predictions every 2 minutes
  setInterval(async () => {
    try {
      await predictor.generateAllPredictions();
    } catch (error) {
      console.error('Error generating periodic predictions:', error);
    }
  }, 2 * 60 * 1000);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down GasFlow API server...');
  collector.stop();
  db.close();
  server.close(() => {
    console.log('✅ Server closed gracefully');
    process.exit(0);
  });
});