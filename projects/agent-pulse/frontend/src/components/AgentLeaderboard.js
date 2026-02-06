import React from 'react';

const AgentLeaderboard = ({ agents }) => {
  const formatValue = (value) => {
    if (value >= 1000000) {
      return `$${(value * 2000 / 1000000).toFixed(1)}M`;
    } else if (value >= 1000) {
      return `$${(value * 2000 / 1000).toFixed(1)}K`;
    }
    return `$${(value * 2000).toFixed(0)}`;
  };

  const truncateAddress = (address) => {
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  };

  const getFrameworkColor = (framework) => {
    const colors = {
      clawdbot: 'bg-blue-500',
      eliza: 'bg-purple-500',
      autogpt: 'bg-green-500',
      custom: 'bg-orange-500',
      unknown: 'bg-gray-500'
    };
    return colors[framework] || colors.unknown;
  };

  const sortedAgents = [...agents].sort((a, b) => (b.stats?.volume_eth || 0) - (a.stats?.volume_eth || 0));

  return (
    <div className="bg-gray-800 rounded-lg border border-gray-700">
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-700">
        <h2 className="text-xl font-bold text-white">Top Agents (24h)</h2>
        <p className="text-sm text-gray-400 mt-1">Ranked by volume</p>
      </div>

      {/* Agent List */}
      <div className="divide-y divide-gray-700">
        {sortedAgents.length === 0 ? (
          <div className="px-6 py-8 text-center text-gray-400">
            <svg className="mx-auto h-12 w-12 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857M15 11a3 3 0 11-6 0 3 3 0 016 0zm6 2a2 2 0 11-4 0 2 2 0 014 0zm-10 2a2 2 0 11-4 0 2 2 0 014 0z" />
            </svg>
            <p className="mt-2">No agents tracked yet</p>
          </div>
        ) : (
          sortedAgents.map((agent, index) => (
            <div key={agent.address} className="px-6 py-4 hover:bg-gray-700/50 transition-colors">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  {/* Rank */}
                  <div className="flex-shrink-0 w-6 text-center">
                    {index < 3 ? (
                      <span className="text-lg">
                        {index === 0 ? '🥇' : index === 1 ? '🥈' : '🥉'}
                      </span>
                    ) : (
                      <span className="text-gray-400 font-medium">#{index + 1}</span>
                    )}
                  </div>

                  {/* Agent Info */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center space-x-2">
                      <h3 className="font-medium text-white truncate">
                        {agent.name}
                      </h3>
                      {agent.framework && (
                        <div className={`w-2 h-2 rounded-full ${getFrameworkColor(agent.framework)}`}></div>
                      )}
                    </div>
                    <p className="text-sm text-gray-400">
                      {truncateAddress(agent.address)}
                    </p>
                    {agent.twitter && (
                      <p className="text-xs text-blue-400">
                        {agent.twitter}
                      </p>
                    )}
                  </div>
                </div>

                {/* Stats */}
                <div className="text-right">
                  <div className="text-sm font-medium text-white">
                    {formatValue(agent.stats?.volume_eth || 0)}
                  </div>
                  <div className="text-xs text-gray-400">
                    {agent.stats?.tx_count || 0} txns
                  </div>
                  {agent.stats?.success_rate !== undefined && (
                    <div className="text-xs text-gray-400">
                      {Math.round((agent.stats.success_rate || 0) * 100)}% success
                    </div>
                  )}
                </div>
              </div>

              {/* Activity indicators */}
              {agent.stats?.category_breakdown && (
                <div className="mt-3 flex space-x-1">
                  {Object.entries(agent.stats.category_breakdown).map(([category, count]) => (
                    <div
                      key={category}
                      className="h-1 bg-gray-600 rounded-full flex-1"
                      style={{
                        backgroundColor: 
                          category === 'swap' ? '#3b82f6' :
                          category === 'lp' ? '#06b6d4' :
                          category === 'mint' ? '#f59e0b' :
                          category === 'bridge' ? '#8b5cf6' :
                          category === 'transfer' ? '#10b981' : '#6b7280'
                      }}
                      title={`${category}: ${count}`}
                    ></div>
                  ))}
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* Legend */}
      {sortedAgents.length > 0 && (
        <div className="px-6 py-3 border-t border-gray-700 bg-gray-800/50">
          <div className="flex items-center justify-between text-xs text-gray-400">
            <span>Framework:</span>
            <div className="flex items-center space-x-3">
              {['clawdbot', 'eliza', 'custom', 'unknown'].map(framework => (
                <div key={framework} className="flex items-center space-x-1">
                  <div className={`w-2 h-2 rounded-full ${getFrameworkColor(framework)}`}></div>
                  <span>{framework}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AgentLeaderboard;