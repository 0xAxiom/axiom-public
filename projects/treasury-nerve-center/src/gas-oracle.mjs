/**
 * Gas Oracle - Base RPC gas prices with historical percentile logic
 * 15-second cache
 */

import { createPublicClient, http, formatGwei, parseGwei } from 'viem';
import { base, mainnet } from 'viem/chains';

// Cache storage
let gasCache = null;
const CACHE_TTL = 15 * 1000; // 15 seconds

// Historical gas prices for percentile calculation (rolling 24h window)
const gasHistory = [];
const HISTORY_MAX_AGE = 24 * 60 * 60 * 1000; // 24 hours
const HISTORY_SAMPLE_INTERVAL = 60 * 1000; // Sample every minute

let lastHistorySample = 0;

// Chain configurations
const CHAIN_CONFIG = {
  base: {
    chain: base,
    rpc: 'https://mainnet.base.org',
  },
  ethereum: {
    chain: mainnet,
    rpc: 'https://eth.llamarpc.com',
  },
};

/**
 * Get viem client for chain
 */
function getClient(chain = 'base') {
  const config = CHAIN_CONFIG[chain] || CHAIN_CONFIG.base;
  return createPublicClient({
    chain: config.chain,
    transport: http(config.rpc),
  });
}

/**
 * Prune old history entries
 */
function pruneHistory() {
  const cutoff = Date.now() - HISTORY_MAX_AGE;
  while (gasHistory.length > 0 && gasHistory[0].timestamp < cutoff) {
    gasHistory.shift();
  }
}

/**
 * Add gas price to history
 */
function recordHistory(gasPrice) {
  const now = Date.now();
  
  // Only sample at intervals
  if (now - lastHistorySample < HISTORY_SAMPLE_INTERVAL) {
    return;
  }
  
  lastHistorySample = now;
  gasHistory.push({
    timestamp: now,
    gasPrice: gasPrice,
  });
  
  pruneHistory();
}

/**
 * Calculate percentile of current gas vs history
 */
function calculatePercentile(currentGas) {
  if (gasHistory.length < 5) {
    // Not enough data, return neutral
    return 50;
  }

  const prices = gasHistory.map(h => h.gasPrice).sort((a, b) => a - b);
  let below = 0;
  
  for (const price of prices) {
    if (currentGas > price) {
      below++;
    }
  }
  
  return Math.round((below / prices.length) * 100);
}

/**
 * Fetch current gas price from RPC
 */
async function fetchGasPrice(chain = 'base') {
  const client = getClient(chain);
  
  try {
    const gasPrice = await client.getGasPrice();
    return Number(gasPrice);
  } catch (error) {
    console.error('Gas price fetch error:', error.message);
    throw error;
  }
}

/**
 * Fetch EIP-1559 fee data
 */
async function fetchFeeData(chain = 'base') {
  const client = getClient(chain);
  
  try {
    // Get latest block for base fee
    const block = await client.getBlock({ blockTag: 'latest' });
    const baseFee = block.baseFeePerGas || 0n;
    
    // Estimate max priority fee
    const maxPriorityFee = await client.estimateMaxPriorityFeePerGas().catch(() => parseGwei('0.001'));
    
    return {
      baseFee: Number(baseFee),
      maxPriorityFee: Number(maxPriorityFee),
      maxFee: Number(baseFee) * 2 + Number(maxPriorityFee),
    };
  } catch (error) {
    console.error('Fee data fetch error:', error.message);
    // Fallback to legacy gas price
    const gasPrice = await fetchGasPrice(chain);
    return {
      baseFee: gasPrice,
      maxPriorityFee: 0,
      maxFee: gasPrice,
    };
  }
}

/**
 * Get gas recommendation based on percentile
 */
function getGasRecommendation(percentile, feeData) {
  // Base has very low gas, so thresholds are different
  const gasPriceGwei = Number(formatGwei(BigInt(feeData.maxFee)));
  
  // Base typically has <0.01 gwei gas
  if (percentile <= 20) {
    return {
      recommendation: 'act_now',
      reason: 'Gas is in the lowest 20th percentile - excellent time to transact',
      estimatedSavings: 0,
    };
  } else if (percentile <= 50) {
    return {
      recommendation: 'act_now',
      reason: 'Gas is below average - good time to transact',
      estimatedSavings: 0,
    };
  } else if (percentile <= 80) {
    return {
      recommendation: 'wait',
      reason: 'Gas is above average - consider waiting for lower prices',
      estimatedSavings: gasPriceGwei * 0.2, // Estimate 20% savings
    };
  } else {
    return {
      recommendation: 'wait',
      reason: 'Gas is in the highest 20th percentile - wait if possible',
      estimatedSavings: gasPriceGwei * 0.4, // Estimate 40% savings
    };
  }
}

/**
 * Get current gas prices with recommendation
 * @param {string} chain - Chain identifier
 * @returns {Promise<Object>} Gas data
 */
export async function getGasPrice(chain = 'base') {
  // Check cache
  if (gasCache && Date.now() - gasCache.timestamp < CACHE_TTL) {
    return gasCache.data;
  }

  try {
    const feeData = await fetchFeeData(chain);
    
    // Record for history
    recordHistory(feeData.maxFee);
    
    // Calculate percentile
    const percentile = calculatePercentile(feeData.maxFee);
    
    // Get recommendation
    const { recommendation, reason, estimatedSavings } = getGasRecommendation(percentile, feeData);
    
    const result = {
      chain,
      timestamp: Date.now(),
      current: {
        baseFee: feeData.baseFee,
        maxPriorityFee: feeData.maxPriorityFee,
        maxFee: feeData.maxFee,
        baseFeeGwei: formatGwei(BigInt(feeData.baseFee)),
        maxFeeGwei: formatGwei(BigInt(feeData.maxFee)),
      },
      percentile,
      recommendation,
      reason,
      estimatedSavings,
      historySize: gasHistory.length,
    };

    // Cache the result
    gasCache = {
      timestamp: Date.now(),
      data: result,
    };

    return result;
  } catch (error) {
    console.error('Gas oracle error:', error.message);
    
    // Return fallback
    return {
      chain,
      timestamp: Date.now(),
      current: {
        baseFee: 0,
        maxPriorityFee: 0,
        maxFee: 0,
        baseFeeGwei: '0',
        maxFeeGwei: '0',
      },
      percentile: 50,
      recommendation: 'act_now',
      reason: 'Unable to fetch gas prices - proceed with caution',
      estimatedSavings: 0,
      error: error.message,
    };
  }
}

/**
 * Estimate transaction cost in USD
 * @param {number} gasUnits - Estimated gas units for tx
 * @param {number} ethPriceUsd - Current ETH price in USD
 * @param {string} chain - Chain identifier
 * @returns {Promise<Object>} Cost estimate
 */
export async function estimateTransactionCost(gasUnits, ethPriceUsd, chain = 'base') {
  const gasData = await getGasPrice(chain);
  
  const gasCostWei = BigInt(gasData.current.maxFee) * BigInt(gasUnits);
  const gasCostEth = Number(gasCostWei) / 1e18;
  const gasCostUsd = gasCostEth * ethPriceUsd;
  
  return {
    gasUnits,
    gasPriceWei: gasData.current.maxFee,
    gasPriceGwei: gasData.current.maxFeeGwei,
    costEth: gasCostEth,
    costUsd: gasCostUsd,
    recommendation: gasData.recommendation,
  };
}

/**
 * Get gas price history
 */
export function getGasHistory() {
  return [...gasHistory];
}

/**
 * Clear caches (for testing)
 */
export function clearGasCache() {
  gasCache = null;
  gasHistory.length = 0;
  lastHistorySample = 0;
}

export default {
  getGasPrice,
  estimateTransactionCost,
  getGasHistory,
  clearGasCache,
};
