import React, { useState, useEffect } from 'react';
import StatsCards from './components/StatsCards';
import LiveFeed from './components/LiveFeed';
import AgentLeaderboard from './components/AgentLeaderboard';
import ActivityChart from './components/ActivityChart';

const App = () => {
  const [stats, setStats] = useState(null);
  const [agents, setAgents] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [wsConnected, setWsConnected] = useState(false);

  useEffect(() => {
    // Initial data fetch
    fetchStats();
    fetchAgents();
    fetchFeed();

    // Setup WebSocket connection
    const ws = new WebSocket(`ws://localhost:3001/ws`);
    
    ws.onopen = () => {
      setWsConnected(true);
      console.log('🔌 Connected to Agent Pulse');
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        
        switch (message.type) {
          case 'tx':
            setTransactions(prev => [message.data, ...prev.slice(0, 49)]);
            break;
          case 'stats':
            setStats(message.data);
            break;
          default:
            console.log('Received:', message);
        }
      } catch (error) {
        console.error('WebSocket message error:', error);
      }
    };

    ws.onclose = () => {
      setWsConnected(false);
      console.log('🔌 Disconnected from Agent Pulse');
    };

    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };

    // Cleanup
    return () => {
      ws.close();
    };
  }, []);

  const fetchStats = async () => {
    try {
      const response = await fetch('/api/stats');
      const data = await response.json();
      setStats(data);
    } catch (error) {
      console.error('Error fetching stats:', error);
    }
  };

  const fetchAgents = async () => {
    try {
      const response = await fetch('/api/agents');
      const data = await response.json();
      setAgents(data);
    } catch (error) {
      console.error('Error fetching agents:', error);
    }
  };

  const fetchFeed = async () => {
    try {
      const response = await fetch('/api/feed?limit=50');
      const data = await response.json();
      setTransactions(data);
    } catch (error) {
      console.error('Error fetching feed:', error);
    }
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      {/* Header */}
      <header className="bg-gray-800 border-b border-gray-700">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center">
              <h1 className="text-2xl font-bold text-base">Agent Pulse</h1>
              <span className="ml-3 text-sm text-gray-400">
                Real-time AI Agent Activity on Base
              </span>
            </div>
            <div className="flex items-center space-x-4">
              <div className="flex items-center">
                <div className={`w-2 h-2 rounded-full mr-2 ${wsConnected ? 'bg-green-500' : 'bg-red-500'}`}></div>
                <span className="text-sm text-gray-400">
                  {wsConnected ? 'Live' : 'Offline'}
                </span>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Stats Cards */}
        <StatsCards stats={stats} />

        {/* Dashboard Grid */}
        <div className="mt-8 grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Live Feed - Takes up 2 columns */}
          <div className="lg:col-span-2">
            <LiveFeed transactions={transactions} />
          </div>

          {/* Sidebar - Agent Leaderboard */}
          <div>
            <AgentLeaderboard agents={agents} />
          </div>
        </div>

        {/* Activity Chart */}
        <div className="mt-8">
          <ActivityChart stats={stats} />
        </div>
      </main>

      {/* Footer */}
      <footer className="bg-gray-800 border-t border-gray-700 mt-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="text-center text-gray-400 text-sm">
            Built with ❤️ for the Agent Economy • Powered by Base
          </div>
        </div>
      </footer>
    </div>
  );
};

export default App;