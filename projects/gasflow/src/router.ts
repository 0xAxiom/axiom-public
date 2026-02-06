import { RouteComparison, CHAINS } from './types';
import { GasDatabase } from './database';

// Common gas estimates for different transaction types
const GAS_ESTIMATES: Record<string, bigint> = {
  'transfer': 21000n,
  'erc20_transfer': 65000n,
  'swap': 200000n,
  'add_lp': 300000n,
  'remove_lp': 250000n,
  'stake': 150000n,
  'unstake': 120000n
};

// Bridge costs (rough estimates in USD)
const BRIDGE_COSTS = {
  'from_mainnet': {
    8453: 3.50, // Base
    42161: 2.00, // Arbitrum
    137: 1.50, // Polygon
    10: 3.00 // Optimism
  } as Record<number, number>,
  'l2_to_l2': 5.00 // General L2 to L2 bridge cost
};

// ETH/token prices in USD (would be fetched from API in production)
const TOKEN_PRICES: Record<string, number> = {
  'ETH': 3500,
  'MATIC': 1.20
};

export class RouteOptimizer {
  private db: GasDatabase;

  constructor(db: GasDatabase) {
    this.db = db;
  }

  // Convert gas cost to USD
  private gasToUSD(gasAmount: bigint, gasPriceWei: bigint, tokenSymbol: string): number {
    const gasCostEth = Number(gasAmount * gasPriceWei) / 1e18;
    const tokenPrice = TOKEN_PRICES[tokenSymbol] || TOKEN_PRICES.ETH;
    return gasCostEth * tokenPrice;
  }

  // Estimate bridge cost for cross-chain transaction
  private estimateBridgeCost(fromChain: number, toChain: number, value: number): number {
    if (fromChain === toChain) return 0;

    // If moving from mainnet to L2
    if (fromChain === 1) {
      return BRIDGE_COSTS.from_mainnet[toChain] || 5.00;
    }

    // L2 to L2 bridging
    if (fromChain !== 1 && toChain !== 1) {
      return BRIDGE_COSTS.l2_to_l2;
    }

    // L2 to mainnet (typically more expensive)
    return 8.00;
  }

  async optimizeRoute(
    action: string,
    value: number = 1000, // USD value of transaction
    userChain?: number // Current chain user is on
  ): Promise<RouteComparison> {
    const gasEstimate = GAS_ESTIMATES[action] || GAS_ESTIMATES.swap;
    const snapshots = this.db.getAllLatestSnapshots();

    if (snapshots.length === 0) {
      throw new Error('No gas data available');
    }

    const routes: Array<{
      chainId: number;
      chainName: string;
      estimatedGas: bigint;
      gasCost: bigint;
      gasCostUSD: number;
      bridgeCost?: bigint;
      totalCost: bigint;
      totalCostUSD: number;
    }> = [];

    for (const snapshot of snapshots) {
      const chain = CHAINS[snapshot.chainId];
      if (!chain) continue;

      const totalGas = snapshot.baseFee + snapshot.priorityFee;
      const gasCost = gasEstimate * totalGas;
      const gasCostUSD = this.gasToUSD(gasCost, 1n, chain.symbol);

      // Calculate bridge cost if needed
      let bridgeCost = 0n;
      let bridgeCostUSD = 0;
      
      if (userChain && userChain !== snapshot.chainId) {
        bridgeCostUSD = this.estimateBridgeCost(userChain, snapshot.chainId, value);
        // Convert bridge cost back to wei for consistency (approximate)
        bridgeCost = BigInt(Math.round(bridgeCostUSD / TOKEN_PRICES[chain.symbol] * 1e18));
      }

      const totalCost = gasCost + bridgeCost;
      const totalCostUSD = gasCostUSD + bridgeCostUSD;

      routes.push({
        chainId: snapshot.chainId,
        chainName: chain.name,
        estimatedGas: gasEstimate,
        gasCost,
        gasCostUSD,
        bridgeCost: bridgeCost > 0n ? bridgeCost : undefined,
        totalCost,
        totalCostUSD
      });
    }

    // Sort by total cost
    routes.sort((a, b) => a.totalCostUSD - b.totalCostUSD);

    const bestRoute = routes[0]?.chainId || snapshots[0].chainId;
    const worstCost = Math.max(...routes.map(r => r.totalCostUSD));
    const bestCost = Math.min(...routes.map(r => r.totalCostUSD));
    const savings = worstCost - bestCost;

    return {
      action,
      routes,
      bestRoute,
      savings
    };
  }

  // Get cost comparison for popular actions
  async getActionComparisons(): Promise<Record<string, RouteComparison>> {
    const actions = ['transfer', 'erc20_transfer', 'swap', 'add_lp'];
    const comparisons: Record<string, RouteComparison> = {};

    for (const action of actions) {
      try {
        comparisons[action] = await this.optimizeRoute(action);
      } catch (error) {
        console.error(`Error getting comparison for ${action}:`, error);
      }
    }

    return comparisons;
  }

  // Get savings opportunity summary
  async getSavingsOpportunities(): Promise<{
    totalChains: number;
    maxSavingsUSD: number;
    bestChainForSwaps: number;
    bestChainForTransfers: number;
    avgGasSavings: number;
  }> {
    try {
      const [swapComparison, transferComparison] = await Promise.all([
        this.optimizeRoute('swap'),
        this.optimizeRoute('transfer')
      ]);

      const snapshots = this.db.getAllLatestSnapshots();
      
      // Calculate average potential savings
      const allSavings = [swapComparison.savings, transferComparison.savings];
      const avgGasSavings = allSavings.reduce((a, b) => a + b, 0) / allSavings.length;

      return {
        totalChains: snapshots.length,
        maxSavingsUSD: Math.max(swapComparison.savings, transferComparison.savings),
        bestChainForSwaps: swapComparison.bestRoute,
        bestChainForTransfers: transferComparison.bestRoute,
        avgGasSavings
      };
    } catch (error) {
      console.error('Error calculating savings opportunities:', error);
      return {
        totalChains: 0,
        maxSavingsUSD: 0,
        bestChainForSwaps: 8453, // Default to Base
        bestChainForTransfers: 8453,
        avgGasSavings: 0
      };
    }
  }

  // Estimate total cost for a specific transaction
  estimateTransactionCost(
    chainId: number,
    action: string,
    gasPrice?: bigint
  ): { gasCost: bigint; gasCostUSD: number } {
    const gasEstimate = GAS_ESTIMATES[action] || GAS_ESTIMATES.swap;
    const chain = CHAINS[chainId];
    
    if (!chain) {
      throw new Error(`Unsupported chain: ${chainId}`);
    }

    // Use provided gas price or fetch latest
    let effectiveGasPrice = gasPrice;
    if (!effectiveGasPrice) {
      const snapshot = this.db.getLatestSnapshot(chainId);
      if (!snapshot) {
        throw new Error(`No gas data for chain ${chainId}`);
      }
      effectiveGasPrice = snapshot.baseFee + snapshot.priorityFee;
    }

    const gasCost = gasEstimate * effectiveGasPrice;
    const gasCostUSD = this.gasToUSD(gasCost, 1n, chain.symbol);

    return { gasCost, gasCostUSD };
  }
}