/**
 * Aggregator - Combine all data sources, calculate totals, health checks
 */

import priceOracle from './price-oracle.mjs';
import positionTracker from './position-tracker.mjs';
import gasOracle from './gas-oracle.mjs';

/**
 * Calculate impermanent loss for a V3 position
 * Simplified IL calculation based on price change
 */
function calculateImpermanentLoss(position, prices) {
  // Get current and initial token values
  const token0Price = prices[position.token0.address?.toLowerCase()]?.usd || 0;
  const token1Price = prices[position.token1.address?.toLowerCase()]?.usd || 0;
  
  if (!token0Price || !token1Price) {
    return null; // Can't calculate without prices
  }
  
  // If we have deposit info, calculate real IL
  if (position.deposited) {
    const deposited0 = parseFloat(position.deposited.token0) || 0;
    const deposited1 = parseFloat(position.deposited.token1) || 0;
    const withdrawn0 = parseFloat(position.withdrawn?.token0) || 0;
    const withdrawn1 = parseFloat(position.withdrawn?.token1) || 0;
    
    // Current position value from liquidity
    const amounts = positionTracker.calculateV3Amounts(position);
    const current0 = parseFloat(amounts.amount0) / (10 ** (position.token0.decimals || 18));
    const current1 = parseFloat(amounts.amount1) / (10 ** (position.token1.decimals || 18));
    
    // Value if held
    const holdValue = (deposited0 - withdrawn0) * token0Price + (deposited1 - withdrawn1) * token1Price;
    
    // Current LP value
    const lpValue = current0 * token0Price + current1 * token1Price;
    
    if (holdValue > 0) {
      const il = ((lpValue - holdValue) / holdValue) * 100;
      return Math.round(il * 100) / 100; // 2 decimal places
    }
  }
  
  return null; // Not enough data
}

/**
 * Calculate position health status
 */
function calculatePositionHealth(position, prices) {
  const inRange = positionTracker.isInRange(position);
  const rangeUtilization = positionTracker.calculateRangeUtilization(position);
  const impermanentLoss = calculateImpermanentLoss(position, prices);
  
  let status = 'healthy';
  let issues = [];
  
  // Out of range check
  if (!inRange) {
    status = 'warning';
    issues.push('Position is out of range');
  }
  
  // IL check
  if (impermanentLoss !== null) {
    if (impermanentLoss < -15) {
      status = 'critical';
      issues.push(`High impermanent loss: ${impermanentLoss.toFixed(2)}%`);
    } else if (impermanentLoss < -5) {
      if (status !== 'critical') status = 'warning';
      issues.push(`Significant impermanent loss: ${impermanentLoss.toFixed(2)}%`);
    }
  }
  
  // Range utilization (how close to edges)
  if (inRange && rangeUtilization < 20) {
    if (status === 'healthy') status = 'warning';
    issues.push('Position near range boundary');
  }
  
  return {
    status,
    inRange,
    rangeUtilization,
    impermanentLoss,
    issues,
  };
}

/**
 * Calculate position value in USD
 */
function calculatePositionValue(position, prices) {
  const token0Price = prices[position.token0.address?.toLowerCase()]?.usd || 0;
  const token1Price = prices[position.token1.address?.toLowerCase()]?.usd || 0;
  
  // Calculate amounts from liquidity
  const amounts = positionTracker.calculateV3Amounts(position);
  const amount0 = parseFloat(amounts.amount0) / (10 ** (position.token0.decimals || 18));
  const amount1 = parseFloat(amounts.amount1) / (10 ** (position.token1.decimals || 18));
  
  const value0 = amount0 * token0Price;
  const value1 = amount1 * token1Price;
  
  return {
    token0: {
      ...position.token0,
      amount: amount0,
      valueUsd: value0,
      price: token0Price,
    },
    token1: {
      ...position.token1,
      amount: amount1,
      valueUsd: value1,
      price: token1Price,
    },
    totalValueUsd: value0 + value1,
  };
}

/**
 * Calculate pending fees value
 */
function calculatePendingFees(position, prices) {
  if (!position.tokensOwed && !position.collectedFees) {
    return { token0: 0, token1: 0, totalUsd: 0 };
  }
  
  const token0Price = prices[position.token0.address?.toLowerCase()]?.usd || 0;
  const token1Price = prices[position.token1.address?.toLowerCase()]?.usd || 0;
  
  // Use tokensOwed from RPC or estimate from collectedFees
  let fees0 = 0;
  let fees1 = 0;
  
  if (position.tokensOwed) {
    fees0 = parseFloat(position.tokensOwed.token0) / (10 ** (position.token0.decimals || 18));
    fees1 = parseFloat(position.tokensOwed.token1) / (10 ** (position.token1.decimals || 18));
  }
  
  return {
    token0: fees0,
    token1: fees1,
    totalUsd: fees0 * token0Price + fees1 * token1Price,
  };
}

/**
 * Generate alerts from positions and gas
 */
function generateAlerts(positions, gasData, totalFees) {
  const alerts = [];
  
  // Check each LP position
  for (const pos of positions.lpPositions || []) {
    if (!pos.health) continue;
    
    if (!pos.health.inRange) {
      alerts.push({
        severity: pos.health.status === 'critical' ? 'critical' : 'warning',
        type: 'out_of_range',
        message: `Position #${pos.tokenId} (${pos.token0?.symbol}/${pos.token1?.symbol}) is out of range`,
        position: pos.tokenId,
      });
    }
    
    if (pos.health.impermanentLoss !== null && pos.health.impermanentLoss < -5) {
      alerts.push({
        severity: pos.health.impermanentLoss < -15 ? 'critical' : 'warning',
        type: 'impermanent_loss',
        message: `Position #${pos.tokenId} has ${pos.health.impermanentLoss.toFixed(1)}% IL`,
        position: pos.tokenId,
      });
    }
    
    if (pos.pendingFees?.totalUsd > 50) {
      alerts.push({
        severity: 'info',
        type: 'pending_fees',
        message: `Position #${pos.tokenId} has $${pos.pendingFees.totalUsd.toFixed(2)} in uncollected fees`,
        position: pos.tokenId,
      });
    }
  }
  
  // Gas alerts
  if (gasData.percentile <= 20) {
    alerts.push({
      severity: 'info',
      type: 'low_gas',
      message: 'Gas prices are in the lowest 20th percentile - good time to transact',
    });
  } else if (gasData.percentile >= 80) {
    alerts.push({
      severity: 'warning',
      type: 'high_gas',
      message: 'Gas prices are high - consider waiting for lower prices',
    });
  }
  
  return alerts;
}

/**
 * Main aggregation function
 */
export async function aggregateTreasury(address, chain = 'base') {
  const timestamp = Date.now();
  
  // Fetch all data in parallel
  const [positions, gasData] = await Promise.all([
    positionTracker.getAllPositions(address, chain),
    gasOracle.getGasPrice(chain),
  ]);
  
  // Collect all token addresses for price fetching
  const tokenAddresses = new Set();
  
  // From token balances
  for (const token of positions.tokens || []) {
    if (token.address && token.address !== '0x0000000000000000000000000000000000000000') {
      tokenAddresses.add(token.address.toLowerCase());
    }
  }
  
  // From LP positions
  for (const pos of positions.lpPositions || []) {
    if (pos.token0?.address) tokenAddresses.add(pos.token0.address.toLowerCase());
    if (pos.token1?.address) tokenAddresses.add(pos.token1.address.toLowerCase());
  }
  
  // Always include WETH for native ETH pricing
  tokenAddresses.add('0x4200000000000000000000000000000000000006');
  
  // Fetch prices
  const prices = await priceOracle.getTokenPrices([...tokenAddresses], chain);
  
  // Get ETH price for native balance
  const ethPrice = prices['0x4200000000000000000000000000000000000006']?.usd || 0;
  
  // Process token balances
  let tokenTotalUsd = 0;
  const processedTokens = [];
  
  for (const token of positions.tokens || []) {
    let price = 0;
    
    if (token.address === '0x0000000000000000000000000000000000000000') {
      // Native ETH
      price = ethPrice;
    } else {
      price = prices[token.address.toLowerCase()]?.usd || 0;
    }
    
    const valueUsd = parseFloat(token.balanceFormatted) * price;
    tokenTotalUsd += valueUsd;
    
    processedTokens.push({
      type: 'token',
      protocol: 'wallet',
      token: token.symbol,
      address: token.address,
      balance: token.balanceFormatted,
      price,
      valueUsd,
      health: { status: 'healthy' },
    });
  }
  
  // Process LP positions
  let lpTotalUsd = 0;
  let pendingFeesTotal = 0;
  const processedLPs = [];
  
  for (const pos of positions.lpPositions || []) {
    const value = calculatePositionValue(pos, prices);
    const health = calculatePositionHealth(pos, prices);
    const pendingFees = calculatePendingFees(pos, prices);
    
    lpTotalUsd += value.totalValueUsd;
    pendingFeesTotal += pendingFees.totalUsd;
    
    processedLPs.push({
      type: 'lp_v3',
      protocol: pos.protocol || 'uniswap_v3',
      tokenId: pos.tokenId,
      tokens: [value.token0, value.token1],
      feeTier: pos.feeTier,
      valueUsd: value.totalValueUsd,
      health,
      pendingFees,
      ticks: {
        lower: pos.tickLower,
        upper: pos.tickUpper,
        current: pos.currentTick,
      },
    });
  }
  
  // Calculate 24h change (weighted average)
  let totalChange24h = 0;
  let totalValue = tokenTotalUsd + lpTotalUsd;
  
  for (const token of processedTokens) {
    const priceData = prices[token.address?.toLowerCase()];
    if (priceData?.change24h && token.valueUsd > 0) {
      totalChange24h += (priceData.change24h * token.valueUsd) / totalValue;
    }
  }
  
  // Generate alerts
  const alerts = generateAlerts({ lpPositions: processedLPs }, gasData, pendingFeesTotal);
  
  return {
    timestamp,
    address,
    chain,
    portfolio: {
      totalValueUsd: totalValue,
      change24h: totalChange24h,
      breakdown: {
        tokens: tokenTotalUsd,
        lpPositions: lpTotalUsd,
        pendingFees: pendingFeesTotal,
      },
    },
    positions: [...processedTokens, ...processedLPs],
    alerts,
    gas: {
      current: gasData.current.maxFeeGwei,
      percentile: gasData.percentile,
      recommendation: gasData.recommendation,
      reason: gasData.reason,
      estimatedSavings: gasData.estimatedSavings,
    },
  };
}

export default {
  aggregateTreasury,
};
