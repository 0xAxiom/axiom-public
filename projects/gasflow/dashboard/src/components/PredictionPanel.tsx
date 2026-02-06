import React, { useState, useEffect } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { GasFlowAPI } from '../api';
import type { Prediction } from '../types';

const chainNames = {
  8453: 'Base',
  42161: 'Arbitrum',
  137: 'Polygon',
  10: 'Optimism'
};

const getRecommendationColor = (rec: string) => {
  switch (rec) {
    case 'wait': return 'text-blue-600 bg-blue-50';
    case 'execute_now': return 'text-green-600 bg-green-50';
    case 'urgent': return 'text-red-600 bg-red-50';
    default: return 'text-gray-600 bg-gray-50';
  }
};

const getRecommendationIcon = (rec: string) => {
  switch (rec) {
    case 'wait': return '⏳';
    case 'execute_now': return '✅';
    case 'urgent': return '🚨';
    default: return '❓';
  }
};

export const PredictionPanel: React.FC = () => {
  const [selectedChain, setSelectedChain] = useState<number>(8453); // Default to Base
  const [prediction, setPrediction] = useState<Prediction | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadPrediction = async (chainId: number) => {
    setLoading(true);
    setError(null);
    try {
      const response = await GasFlowAPI.getPrediction(chainId);
      setPrediction(response.prediction);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load prediction');
      setPrediction(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPrediction(selectedChain);
  }, [selectedChain]);

  const chartData = prediction ? [
    { 
      time: 'Now', 
      gas: 0, // We don't have current in this format, would need to fetch
      confidence: 100 
    },
    { 
      time: '15m', 
      gas: prediction.predictions['15min'].feeGwei,
      confidence: prediction.predictions['15min'].confidence * 100
    },
    { 
      time: '30m', 
      gas: prediction.predictions['30min'].feeGwei,
      confidence: prediction.predictions['30min'].confidence * 100
    },
    { 
      time: '60m', 
      gas: prediction.predictions['60min'].feeGwei,
      confidence: prediction.predictions['60min'].confidence * 100
    }
  ].slice(1) : []; // Skip 'Now' for now since we don't have current data

  return (
    <div className="card">
      <h3 className="text-lg font-semibold mb-4 flex items-center">
        🔮 Gas Price Predictions
      </h3>

      {/* Chain Selector */}
      <div className="flex space-x-2 mb-6">
        {Object.entries(chainNames).map(([chainId, name]) => (
          <button
            key={chainId}
            onClick={() => setSelectedChain(Number(chainId))}
            className={`px-3 py-2 rounded-lg text-sm transition-colors ${
              selectedChain === Number(chainId)
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 hover:bg-gray-200 text-gray-700'
            }`}
          >
            {name}
          </button>
        ))}
      </div>

      {loading && (
        <div className="text-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
          <p className="text-gray-500 mt-2">Loading predictions...</p>
        </div>
      )}

      {error && (
        <div className="text-center py-8 text-red-600">
          <p>{error}</p>
          <button 
            onClick={() => loadPrediction(selectedChain)}
            className="btn-primary mt-2"
          >
            Retry
          </button>
        </div>
      )}

      {prediction && !loading && !error && (
        <div className="space-y-6">
          {/* Recommendation */}
          <div className={`p-4 rounded-lg ${getRecommendationColor(prediction.recommendation)}`}>
            <div className="flex items-center mb-2">
              <span className="text-2xl mr-2">
                {getRecommendationIcon(prediction.recommendation)}
              </span>
              <span className="font-semibold capitalize">
                {prediction.recommendation.replace('_', ' ')}
              </span>
            </div>
            <p className="text-sm">{prediction.reasoning}</p>
          </div>

          {/* Prediction Chart */}
          <div>
            <h4 className="font-medium mb-3">Predicted Gas Prices</h4>
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="time" />
                <YAxis label={{ value: 'Gas (Gwei)', angle: -90, position: 'insideLeft' }} />
                <Tooltip 
                  formatter={(value, name) => [
                    name === 'gas' ? `${Number(value).toFixed(2)} gwei` : `${Number(value).toFixed(1)}%`,
                    name === 'gas' ? 'Gas Price' : 'Confidence'
                  ]}
                />
                <Line 
                  type="monotone" 
                  dataKey="gas" 
                  stroke="#3b82f6" 
                  strokeWidth={2}
                  dot={{ r: 4 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Prediction Details */}
          <div className="grid grid-cols-3 gap-4">
            {Object.entries(prediction.predictions).map(([timeframe, pred]) => (
              <div key={timeframe} className="bg-gray-50 p-3 rounded-lg">
                <div className="text-xs text-gray-500 uppercase tracking-wide">
                  {timeframe}
                </div>
                <div className="text-lg font-bold text-gray-900">
                  {pred.feeGwei.toFixed(2)} gwei
                </div>
                <div className="text-xs text-gray-600">
                  {(pred.confidence * 100).toFixed(0)}% confidence
                </div>
              </div>
            ))}
          </div>

          <div className="text-xs text-gray-500 text-center">
            Last updated: {new Date(prediction.timestamp).toLocaleTimeString()}
          </div>
        </div>
      )}
    </div>
  );
};