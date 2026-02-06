import React from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';

const ActivityChart = ({ stats }) => {
  if (!stats) {
    return (
      <div className="bg-gray-800 rounded-lg border border-gray-700 p-6">
        <div className="animate-pulse">
          <div className="h-4 bg-gray-700 rounded w-1/4 mb-4"></div>
          <div className="h-64 bg-gray-700 rounded"></div>
        </div>
      </div>
    );
  }

  // Prepare hourly activity data
  const hourlyData = Array.from({ length: 24 }, (_, i) => {
    const hour = i.toString().padStart(2, '0');
    const activity = stats.hourly_activity?.find(h => h.hour === hour);
    return {
      hour: `${hour}:00`,
      transactions: activity?.count || 0
    };
  });

  // Prepare protocol data for pie chart
  const protocolData = stats.top_protocols?.slice(0, 5).map((protocol, index) => ({
    name: protocol.protocol,
    value: protocol.count,
    color: ['#3b82f6', '#06b6d4', '#f59e0b', '#8b5cf6', '#10b981'][index]
  })) || [];

  const CustomTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-gray-800 border border-gray-600 rounded-lg p-3 shadow-lg">
          <p className="text-white font-medium">{`${label}`}</p>
          <p className="text-blue-400">
            {`Transactions: ${payload[0].value}`}
          </p>
        </div>
      );
    }
    return null;
  };

  const PieTooltip = ({ active, payload }) => {
    if (active && payload && payload.length) {
      const data = payload[0];
      return (
        <div className="bg-gray-800 border border-gray-600 rounded-lg p-3 shadow-lg">
          <p className="text-white font-medium">{data.name}</p>
          <p className="text-blue-400">
            {`${data.value} transactions`}
          </p>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Hourly Activity Chart */}
      <div className="lg:col-span-2 bg-gray-800 rounded-lg border border-gray-700 p-6">
        <h3 className="text-lg font-bold text-white mb-4">24-Hour Activity Pattern</h3>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={hourlyData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
            <XAxis 
              dataKey="hour" 
              stroke="#9ca3af"
              fontSize={12}
              interval="preserveStartEnd"
            />
            <YAxis stroke="#9ca3af" fontSize={12} />
            <Tooltip content={<CustomTooltip />} />
            <Bar 
              dataKey="transactions" 
              fill="#3b82f6"
              radius={[2, 2, 0, 0]}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Protocol Distribution */}
      <div className="bg-gray-800 rounded-lg border border-gray-700 p-6">
        <h3 className="text-lg font-bold text-white mb-4">Protocol Distribution</h3>
        {protocolData.length > 0 ? (
          <>
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie
                  data={protocolData}
                  cx="50%"
                  cy="50%"
                  innerRadius={40}
                  outerRadius={80}
                  paddingAngle={5}
                  dataKey="value"
                >
                  {protocolData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip content={<PieTooltip />} />
              </PieChart>
            </ResponsiveContainer>
            
            {/* Legend */}
            <div className="mt-4 space-y-2">
              {protocolData.map((protocol, index) => (
                <div key={protocol.name} className="flex items-center justify-between text-sm">
                  <div className="flex items-center space-x-2">
                    <div 
                      className="w-3 h-3 rounded-full"
                      style={{ backgroundColor: protocol.color }}
                    ></div>
                    <span className="text-gray-300">{protocol.name}</span>
                  </div>
                  <span className="text-gray-400">{protocol.value}</span>
                </div>
              ))}
            </div>
          </>
        ) : (
          <div className="flex items-center justify-center h-48 text-gray-400">
            <div className="text-center">
              <svg className="mx-auto h-8 w-8 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
              <p className="mt-2">No protocol data</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ActivityChart;