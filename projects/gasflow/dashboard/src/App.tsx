import { useState, useEffect } from 'react';
import { GasChart } from './components/GasChart';
import { PredictionPanel } from './components/PredictionPanel';
import { RouteOptimizer } from './components/RouteOptimizer';
import { MarketSummaryCard } from './components/MarketSummary';
import { GasFlowAPI } from './api';
import type { Chain } from './types';

function App() {
  const [gasData, setGasData] = useState<Chain[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  const loadGasData = async () => {
    try {
      const response = await GasFlowAPI.getGasData();
      setGasData(response.chains);
      setLastUpdated(new Date());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load gas data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Initial load
    loadGasData();

    // Set up WebSocket for real-time updates
    let ws: WebSocket;
    
    const connectWebSocket = () => {
      try {
        ws = GasFlowAPI.createWebSocket();
        
        ws.onopen = () => {
          console.log('WebSocket connected');
          setIsConnected(true);
        };

        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data.type === 'gas_update' && data.data) {
              // Convert WebSocket format to our Chain format
              const chains: Chain[] = data.data.map((chain: any) => ({
                chainId: chain.chainId,
                chainName: chain.chainName,
                symbol: 'ETH', // Default, would be in full API response
                baseFee: '0', // Would be in full response
                priorityFee: '0',
                totalGas: (chain.totalGasGwei * 1e9).toString(),
                totalGasGwei: chain.totalGasGwei,
                pendingTxCount: 0, // Would be in full response
                blockNumber: 0,
                timestamp: chain.timestamp,
                lastUpdated: new Date(chain.timestamp).toISOString()
              }));
              
              setGasData(chains);
              setLastUpdated(new Date());
            }
          } catch (err) {
            console.error('Error parsing WebSocket message:', err);
          }
        };

        ws.onclose = () => {
          console.log('WebSocket disconnected');
          setIsConnected(false);
          // Reconnect after 5 seconds
          setTimeout(connectWebSocket, 5000);
        };

        ws.onerror = (error) => {
          console.error('WebSocket error:', error);
          setIsConnected(false);
        };
      } catch (err) {
        console.error('Failed to connect WebSocket:', err);
        // Fall back to polling
        const interval = setInterval(loadGasData, 10000);
        return () => clearInterval(interval);
      }
    };

    connectWebSocket();

    return () => {
      if (ws) {
        ws.close();
      }
    };
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading GasFlow...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex justify-between items-center">
            <div className="flex items-center">
              <h1 className="text-2xl font-bold text-gray-900 flex items-center">
                <span className="text-3xl mr-2">⛽</span>
                GasFlow
              </h1>
              <span className="ml-3 px-2 py-1 text-xs bg-blue-100 text-blue-800 rounded-full">
                Predictive Multi-Chain Gas Optimizer
              </span>
            </div>
            
            <div className="flex items-center space-x-4">
              {/* Connection Status */}
              <div className="flex items-center text-sm">
                <div className={`status-dot mr-2 ${isConnected ? 'bg-green-500' : 'bg-red-500'}`}></div>
                <span className="text-gray-600">
                  {isConnected ? 'Live' : 'Disconnected'}
                </span>
              </div>
              
              {/* Last Updated */}
              {lastUpdated && (
                <div className="text-sm text-gray-500">
                  Updated: {lastUpdated.toLocaleTimeString()}
                </div>
              )}
              
              {/* Refresh Button */}
              <button
                onClick={loadGasData}
                className="btn-secondary text-sm"
                disabled={loading}
              >
                {loading ? '↻' : '🔄'} Refresh
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
            <div className="flex">
              <div className="text-red-400 mr-3">⚠️</div>
              <div>
                <h3 className="text-sm font-medium text-red-800">
                  Error loading data
                </h3>
                <p className="text-sm text-red-700 mt-1">{error}</p>
                <button 
                  onClick={loadGasData}
                  className="text-sm text-red-600 underline mt-2 hover:text-red-500"
                >
                  Try again
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Top Row */}
          <div className="lg:col-span-2">
            {gasData.length > 0 && <GasChart chains={gasData} />}
          </div>

          {/* Market Summary */}
          <MarketSummaryCard />

          {/* Predictions */}
          <PredictionPanel />

          {/* Route Optimizer */}
          <div className="lg:col-span-2">
            <RouteOptimizer />
          </div>
        </div>

        {/* Footer */}
        <footer className="mt-12 text-center text-gray-500 text-sm">
          <p>
            GasFlow - Predictive Multi-Chain Gas Optimizer | 
            <a 
              href="https://github.com/axiom/gasflow" 
              className="text-blue-600 hover:underline ml-1"
              target="_blank" 
              rel="noopener noreferrer"
            >
              GitHub
            </a>
          </p>
          <p className="mt-1">
            Built with React, Viem, and Recharts | Data from Base, Arbitrum, Polygon, Optimism
          </p>
        </footer>
      </main>
    </div>
  );
}

export default App;