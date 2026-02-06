export interface Chain {
  id: number;
  name: string;
  rpcUrl: string;
  symbol: string;
}

export interface GasSnapshot {
  chainId: number;
  timestamp: number;
  baseFee: bigint;
  priorityFee: bigint;
  pendingTxCount: number;
  blockNumber: number;
}

export interface GasPrediction {
  chainId: number;
  timestamp: number;
  predicted15min: { fee: bigint; confidence: number };
  predicted30min: { fee: bigint; confidence: number };
  predicted60min: { fee: bigint; confidence: number };
  recommendation: 'wait' | 'execute_now' | 'urgent';
  reasoning: string;
}

export interface RouteComparison {
  action: string;
  routes: Array<{
    chainId: number;
    chainName: string;
    estimatedGas: bigint;
    gasCost: bigint;
    gasCostUSD: number;
    bridgeCost?: bigint;
    totalCost: bigint;
    totalCostUSD: number;
  }>;
  bestRoute: number; // chainId
  savings: number; // USD saved compared to worst
}

export const CHAINS: Record<number, Chain> = {
  1: {
    id: 1,
    name: 'Ethereum',
    rpcUrl: 'https://eth.llamarpc.com',
    symbol: 'ETH'
  },
  8453: {
    id: 8453,
    name: 'Base',
    rpcUrl: 'https://mainnet.base.org',
    symbol: 'ETH'
  },
  42161: {
    id: 42161,
    name: 'Arbitrum',
    rpcUrl: 'https://arb1.arbitrum.io/rpc',
    symbol: 'ETH'
  },
  137: {
    id: 137,
    name: 'Polygon',
    rpcUrl: 'https://polygon-rpc.com',
    symbol: 'MATIC'
  },
  10: {
    id: 10,
    name: 'Optimism',
    rpcUrl: 'https://mainnet.optimism.io',
    symbol: 'ETH'
  }
};