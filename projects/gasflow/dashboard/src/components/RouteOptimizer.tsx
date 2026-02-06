import React, { useState } from 'react';
import { GasFlowAPI } from '../api';
import type { RouteComparison } from '../types';

const actions = [
  { value: 'transfer', label: 'ETH Transfer' },
  { value: 'erc20_transfer', label: 'ERC20 Transfer' },
  { value: 'swap', label: 'Token Swap' },
  { value: 'add_lp', label: 'Add Liquidity' },
  { value: 'remove_lp', label: 'Remove Liquidity' }
];

const chains = [
  { id: 8453, name: 'Base' },
  { id: 42161, name: 'Arbitrum' },
  { id: 137, name: 'Polygon' },
  { id: 10, name: 'Optimism' }
];

export const RouteOptimizer: React.FC = () => {
  const [action, setAction] = useState('swap');
  const [value, setValue] = useState('1000');
  const [userChain, setUserChain] = useState<number | undefined>(undefined);
  const [result, setResult] = useState<RouteComparison | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const optimize = async () => {
    if (!value || isNaN(Number(value))) {
      setError('Please enter a valid transaction value');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const response = await GasFlowAPI.optimizeRoute(action, Number(value), userChain);
      setResult(response.optimization);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to optimize route');
      setResult(null);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="card">
      <h3 className="text-lg font-semibold mb-4 flex items-center">
        🗺️ Route Optimizer
        <span className="ml-2 text-sm text-gray-500 font-normal">
          Find the cheapest chain for your transaction
        </span>
      </h3>

      <div className="space-y-4 mb-6">
        {/* Action Selector */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Transaction Type
          </label>
          <select
            value={action}
            onChange={(e) => setAction(e.target.value)}
            className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          >
            {actions.map(act => (
              <option key={act.value} value={act.value}>
                {act.label}
              </option>
            ))}
          </select>
        </div>

        {/* Transaction Value */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Transaction Value (USD)
          </label>
          <input
            type="number"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="1000"
            className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>

        {/* Current Chain (Optional) */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Current Chain (optional)
          </label>
          <select
            value={userChain || ''}
            onChange={(e) => setUserChain(e.target.value ? Number(e.target.value) : undefined)}
            className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          >
            <option value="">Select your current chain...</option>
            {chains.map(chain => (
              <option key={chain.id} value={chain.id}>
                {chain.name}
              </option>
            ))}
          </select>
        </div>

        <button
          onClick={optimize}
          disabled={loading}
          className="btn-primary w-full disabled:opacity-50"
        >
          {loading ? 'Optimizing...' : 'Find Best Route'}
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4">
          <p className="text-red-800 text-sm">{error}</p>
        </div>
      )}

      {result && (
        <div className="space-y-4">
          {/* Summary */}
          <div className="bg-green-50 border border-green-200 rounded-lg p-4">
            <h4 className="font-semibold text-green-800 mb-2">
              💰 Best Route: {result.bestChainName}
            </h4>
            <p className="text-green-700 text-sm">
              Max savings: <span className="font-bold">${result.maxSavingsUSD.toFixed(2)}</span>
            </p>
          </div>

          {/* Route Comparison Table */}
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-2 px-3 font-medium text-gray-900">Chain</th>
                  <th className="text-right py-2 px-3 font-medium text-gray-900">Gas Cost</th>
                  <th className="text-right py-2 px-3 font-medium text-gray-900">Bridge Cost</th>
                  <th className="text-right py-2 px-3 font-medium text-gray-900">Total Cost</th>
                  <th className="text-right py-2 px-3 font-medium text-gray-900">Savings</th>
                </tr>
              </thead>
              <tbody>
                {result.routes.map((route) => (
                  <tr 
                    key={route.chainId} 
                    className={`border-b border-gray-100 ${
                      route.chainId === result.bestChain ? 'bg-green-50' : ''
                    }`}
                  >
                    <td className="py-2 px-3">
                      <div className="flex items-center">
                        {route.chainId === result.bestChain && (
                          <span className="mr-2">🏆</span>
                        )}
                        <span className="font-medium">{route.chainName}</span>
                      </div>
                    </td>
                    <td className="py-2 px-3 text-right font-mono text-sm">
                      ${route.gasCostUSD.toFixed(2)}
                    </td>
                    <td className="py-2 px-3 text-right font-mono text-sm">
                      {route.bridgeCostUSD > 0 ? `$${route.bridgeCostUSD.toFixed(2)}` : '-'}
                    </td>
                    <td className="py-2 px-3 text-right font-mono text-sm font-semibold">
                      ${route.totalCostUSD.toFixed(2)}
                    </td>
                    <td className="py-2 px-3 text-right">
                      {route.savings > 0 ? (
                        <span className="text-green-600 font-mono text-sm">
                          +${route.savings.toFixed(2)}
                        </span>
                      ) : (
                        <span className="text-gray-500">-</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {userChain && (
            <div className="text-xs text-gray-500">
              * Bridge costs are estimated and may vary based on network conditions
            </div>
          )}
        </div>
      )}
    </div>
  );
};