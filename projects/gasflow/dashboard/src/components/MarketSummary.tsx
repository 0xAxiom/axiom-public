import React, { useState, useEffect } from 'react';
import { GasFlowAPI } from '../api';
import type { MarketSummary } from '../types';

export const MarketSummaryCard: React.FC = () => {
  const [summary, setSummary] = useState<MarketSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadSummary = async () => {
    try {
      const response = await GasFlowAPI.getSummary();
      setSummary(response.summary);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load summary');
      setSummary(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSummary();
    
    // Refresh every 30 seconds
    const interval = setInterval(loadSummary, 30000);
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <div className="card">
        <div className="animate-pulse">
          <div className="h-4 bg-gray-200 rounded w-1/2 mb-4"></div>
          <div className="space-y-3">
            <div className="h-3 bg-gray-200 rounded"></div>
            <div className="h-3 bg-gray-200 rounded w-5/6"></div>
            <div className="h-3 bg-gray-200 rounded w-4/6"></div>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="card">
        <div className="text-center py-4">
          <p className="text-red-600 mb-2">{error}</p>
          <button onClick={loadSummary} className="btn-primary">
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!summary) return null;

  return (
    <div className="card">
      <h3 className="text-lg font-semibold mb-4 flex items-center">
        📊 Market Overview
      </h3>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Market Stats */}
        <div>
          <h4 className="font-medium text-gray-700 mb-3">Current Market</h4>
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-600">Active Chains</span>
              <span className="font-semibold">{summary.market.totalChains}</span>
            </div>
            
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-600">Average Gas</span>
              <span className="font-semibold">
                {(summary.market.averageGas / 1e9).toFixed(2)} gwei
              </span>
            </div>

            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-600">Trending Up</span>
              <div className="flex items-center">
                <span className="text-red-600 mr-1">↗</span>
                <span className="font-semibold">{summary.market.trendsUp}</span>
              </div>
            </div>

            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-600">Trending Down</span>
              <div className="flex items-center">
                <span className="text-green-600 mr-1">↘</span>
                <span className="font-semibold">{summary.market.trendsDown}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Best Chains */}
        <div>
          <h4 className="font-medium text-gray-700 mb-3">Best Chains</h4>
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-600">Cheapest Gas</span>
              <div className="flex items-center">
                <span className="text-green-600 mr-1">🏆</span>
                <span className="font-semibold">
                  {summary.bestChains.cheapest || 'N/A'}
                </span>
              </div>
            </div>

            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-600">Most Expensive</span>
              <div className="flex items-center">
                <span className="text-red-600 mr-1">💸</span>
                <span className="font-semibold">
                  {summary.bestChains.mostExpensive || 'N/A'}
                </span>
              </div>
            </div>

            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-600">Best for Swaps</span>
              <span className="font-semibold">
                {summary.bestChains.forSwaps}
              </span>
            </div>

            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-600">Best for Transfers</span>
              <span className="font-semibold">
                {summary.bestChains.forTransfers}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Savings Opportunities */}
      <div className="mt-6 pt-4 border-t border-gray-200">
        <h4 className="font-medium text-gray-700 mb-3">💰 Savings Opportunities</h4>
        
        <div className="bg-gradient-to-r from-green-50 to-blue-50 p-4 rounded-lg">
          <div className="flex justify-between items-center">
            <div>
              <p className="text-sm text-gray-600">Max Savings Available</p>
              <p className="text-2xl font-bold text-green-600">
                ${summary.savings.maxSavingsUSD.toFixed(2)}
              </p>
            </div>
            <div className="text-right">
              <p className="text-sm text-gray-600">Avg Gas Savings</p>
              <p className="text-lg font-semibold text-blue-600">
                ${summary.savings.avgGasSavings.toFixed(2)}
              </p>
            </div>
          </div>
          
          <p className="text-xs text-gray-500 mt-2">
            Choose the right chain and save on transaction costs
          </p>
        </div>
      </div>

      <div className="mt-4 text-xs text-gray-500 text-center">
        Updates every 30 seconds
      </div>
    </div>
  );
};