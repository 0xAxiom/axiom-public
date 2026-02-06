export interface Chain {
  chainId: number;
  chainName: string;
  symbol: string;
  baseFee: string;
  priorityFee: string;
  totalGas: string;
  totalGasGwei: number;
  pendingTxCount: number;
  blockNumber: number;
  timestamp: number;
  lastUpdated: string;
}

export interface Prediction {
  timestamp: number;
  predictions: {
    '15min': {
      fee: string;
      feeGwei: number;
      confidence: number;
    };
    '30min': {
      fee: string;
      feeGwei: number;
      confidence: number;
    };
    '60min': {
      fee: string;
      feeGwei: number;
      confidence: number;
    };
  };
  recommendation: 'wait' | 'execute_now' | 'urgent';
  reasoning: string;
}

export interface RouteOption {
  chainId: number;
  chainName: string;
  gasCostUSD: number;
  bridgeCostUSD: number;
  totalCostUSD: number;
  savings: number;
}

export interface RouteComparison {
  action: string;
  value: number;
  userChain?: number;
  bestChain: number;
  bestChainName: string;
  maxSavingsUSD: number;
  routes: RouteOption[];
}

export interface MarketSummary {
  market: {
    totalChains: number;
    cheapestChain: number | null;
    mostExpensiveChain: number | null;
    averageGas: number;
    trendsUp: number;
    trendsDown: number;
  };
  savings: {
    totalChains: number;
    maxSavingsUSD: number;
    bestChainForSwaps: number;
    bestChainForTransfers: number;
    avgGasSavings: number;
  };
  bestChains: {
    cheapest: string | null;
    mostExpensive: string | null;
    forSwaps: string;
    forTransfers: string;
  };
}