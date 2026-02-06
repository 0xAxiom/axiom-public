import React from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import type { Chain } from '../types';

interface GasChartProps {
  chains: Chain[];
}

const getGasColor = (gasGwei: number) => {
  if (gasGwei < 10) return '#10b981'; // green
  if (gasGwei < 50) return '#f59e0b'; // yellow
  return '#ef4444'; // red
};

const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    const data = payload[0].payload;
    return (
      <div className="bg-white p-3 rounded-lg shadow-lg border">
        <p className="font-semibold">{label}</p>
        <p className="text-sm text-gray-600">
          Gas: <span className="font-mono">{data.totalGasGwei.toFixed(2)} gwei</span>
        </p>
        <p className="text-sm text-gray-600">
          Pending: {data.pendingTxCount} txs
        </p>
        <p className="text-xs text-gray-500">
          Block: {data.blockNumber}
        </p>
      </div>
    );
  }
  return null;
};

export const GasChart: React.FC<GasChartProps> = ({ chains }) => {
  const chartData = chains.map(chain => ({
    name: chain.chainName,
    totalGasGwei: chain.totalGasGwei,
    pendingTxCount: chain.pendingTxCount,
    blockNumber: chain.blockNumber,
    color: getGasColor(chain.totalGasGwei)
  }));

  return (
    <div className="card">
      <h3 className="text-lg font-semibold mb-4 flex items-center">
        ⛽ Multi-Chain Gas Comparison
        <span className="ml-2 text-sm text-gray-500 font-normal">
          (Current Prices in Gwei)
        </span>
      </h3>
      
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="name" />
          <YAxis 
            label={{ value: 'Gas Price (Gwei)', angle: -90, position: 'insideLeft' }}
          />
          <Tooltip content={<CustomTooltip />} />
          <Bar dataKey="totalGasGwei" radius={[4, 4, 0, 0]}>
            {chartData.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={entry.color} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      <div className="flex justify-center mt-4 space-x-6 text-sm">
        <div className="flex items-center">
          <div className="w-3 h-3 bg-gas-low rounded mr-2"></div>
          <span>Low (&lt;10 gwei)</span>
        </div>
        <div className="flex items-center">
          <div className="w-3 h-3 bg-gas-medium rounded mr-2"></div>
          <span>Medium (10-50 gwei)</span>
        </div>
        <div className="flex items-center">
          <div className="w-3 h-3 bg-gas-high rounded mr-2"></div>
          <span>High (&gt;50 gwei)</span>
        </div>
      </div>
    </div>
  );
};