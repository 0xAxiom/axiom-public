import React from 'react';

const StatsCards = ({ stats }) => {
  if (!stats) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="bg-gray-800 rounded-lg p-6 animate-pulse">
            <div className="h-4 bg-gray-700 rounded w-3/4 mb-2"></div>
            <div className="h-8 bg-gray-700 rounded w-1/2"></div>
          </div>
        ))}
      </div>
    );
  }

  const formatVolume = (volume) => {
    if (volume >= 1000000) {
      return `$${(volume / 1000000).toFixed(1)}M`;
    } else if (volume >= 1000) {
      return `$${(volume / 1000).toFixed(1)}K`;
    }
    return `$${volume.toFixed(2)}`;
  };

  const formatNumber = (num) => {
    return num?.toLocaleString() || '0';
  };

  const topProtocol = stats.top_protocols?.[0]?.protocol || 'None';

  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
      {/* 24h Volume */}
      <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
        <div className="flex items-center">
          <div className="p-2 bg-green-500/20 rounded-lg">
            <svg className="w-6 h-6 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1" />
            </svg>
          </div>
          <div className="ml-4">
            <p className="text-sm font-medium text-gray-400">24h Volume</p>
            <p className="text-2xl font-bold text-white">
              {formatVolume(stats.total_volume * 2000)} {/* Assuming ETH ~$2000 for demo */}
            </p>
          </div>
        </div>
      </div>

      {/* Active Agents */}
      <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
        <div className="flex items-center">
          <div className="p-2 bg-blue-500/20 rounded-lg">
            <svg className="w-6 h-6 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div className="ml-4">
            <p className="text-sm font-medium text-gray-400">Active Agents</p>
            <p className="text-2xl font-bold text-white">
              {formatNumber(stats.active_agents)}
            </p>
          </div>
        </div>
      </div>

      {/* Transactions/Hour */}
      <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
        <div className="flex items-center">
          <div className="p-2 bg-purple-500/20 rounded-lg">
            <svg className="w-6 h-6 text-purple-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <div className="ml-4">
            <p className="text-sm font-medium text-gray-400">Txns/24h</p>
            <p className="text-2xl font-bold text-white">
              {formatNumber(stats.total_txs)}
            </p>
          </div>
        </div>
      </div>

      {/* Top Protocol */}
      <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
        <div className="flex items-center">
          <div className="p-2 bg-orange-500/20 rounded-lg">
            <svg className="w-6 h-6 text-orange-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z" />
            </svg>
          </div>
          <div className="ml-4">
            <p className="text-sm font-medium text-gray-400">Top Protocol</p>
            <p className="text-2xl font-bold text-white truncate">
              {topProtocol}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default StatsCards;