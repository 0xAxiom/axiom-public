import React, { useState } from 'react';

const LiveFeed = ({ transactions }) => {
  const [filter, setFilter] = useState('all');

  const categoryIcons = {
    swap: '🔄',
    lp: '💧',
    bridge: '🌉',
    mint: '🪙',
    transfer: '📤',
    other: '❓'
  };

  const categoryColors = {
    swap: 'text-blue-400 bg-blue-500/20',
    lp: 'text-cyan-400 bg-cyan-500/20',
    bridge: 'text-purple-400 bg-purple-500/20',
    mint: 'text-yellow-400 bg-yellow-500/20',
    transfer: 'text-green-400 bg-green-500/20',
    other: 'text-gray-400 bg-gray-500/20'
  };

  const filteredTransactions = transactions.filter(tx => 
    filter === 'all' || tx.category === filter
  );

  const timeAgo = (timestamp) => {
    const seconds = Math.floor(Date.now() / 1000 - timestamp);
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
    return `${Math.floor(seconds / 86400)}d`;
  };

  const truncateHash = (hash) => {
    return `${hash.slice(0, 6)}...${hash.slice(-4)}`;
  };

  const formatValue = (value) => {
    if (value === 0) return '';
    if (value < 0.01) return '<$0.01';
    if (value >= 1000) return `$${(value * 2000 / 1000).toFixed(1)}K`; // Assuming ETH ~$2000
    return `$${(value * 2000).toFixed(2)}`;
  };

  return (
    <div className="bg-gray-800 rounded-lg border border-gray-700">
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-700">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold text-white flex items-center">
            <span className="animate-pulse text-green-500 mr-2">●</span>
            Live Feed
          </h2>
          
          {/* Filter buttons */}
          <div className="flex space-x-2">
            {['all', 'swap', 'lp', 'mint', 'bridge', 'transfer'].map(category => (
              <button
                key={category}
                onClick={() => setFilter(category)}
                className={`px-3 py-1 text-sm rounded-md transition-colors ${
                  filter === category 
                    ? 'bg-base text-white' 
                    : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                }`}
              >
                {category === 'all' ? 'All' : `${categoryIcons[category]} ${category}`}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Feed Content */}
      <div className="h-96 overflow-y-auto">
        {filteredTransactions.length === 0 ? (
          <div className="flex items-center justify-center h-full text-gray-400">
            <div className="text-center">
              <svg className="mx-auto h-12 w-12 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="mt-2">Waiting for agent activity...</p>
            </div>
          </div>
        ) : (
          <div className="space-y-1">
            {filteredTransactions.map((tx, index) => (
              <div 
                key={tx.hash} 
                className={`px-6 py-3 border-b border-gray-700/50 hover:bg-gray-700/50 transition-colors ${
                  index === 0 ? 'bg-gray-700/30' : ''
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3 flex-1">
                    {/* Category Icon */}
                    <div className={`px-2 py-1 rounded-md text-sm font-medium ${categoryColors[tx.category]}`}>
                      {categoryIcons[tx.category]} {tx.category}
                    </div>

                    {/* Transaction Details */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center space-x-2">
                        <span className="font-medium text-white truncate">
                          {tx.agent_name || 'Unknown Agent'}
                        </span>
                        <span className="text-gray-400">
                          {tx.decoded_data?.signature_name || 'unknown'}
                        </span>
                        {tx.protocol && (
                          <span className="text-xs bg-gray-600 text-gray-300 px-2 py-1 rounded">
                            {tx.protocol}
                          </span>
                        )}
                      </div>
                      
                      <div className="flex items-center space-x-2 text-sm text-gray-400">
                        <span>{truncateHash(tx.hash)}</span>
                        {tx.value_eth > 0 && (
                          <>
                            <span>•</span>
                            <span className="text-green-400">{formatValue(tx.value_eth)}</span>
                          </>
                        )}
                        {!tx.success && (
                          <>
                            <span>•</span>
                            <span className="text-red-400">Failed</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Time */}
                  <div className="text-sm text-gray-400">
                    {timeAgo(tx.timestamp)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default LiveFeed;