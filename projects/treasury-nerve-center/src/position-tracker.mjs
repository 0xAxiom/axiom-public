/**
 * Position Tracker - The Graph for V3 LP, direct RPC for token balances
 * 30-second cache
 */

import { createPublicClient, http, formatUnits, parseAbi } from 'viem';
import { base } from 'viem/chains';

// Cache storage
const positionCache = new Map();
const CACHE_TTL = 30 * 1000; // 30 seconds

// ERC20 ABI for balance calls
const ERC20_ABI = parseAbi([
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function name() view returns (string)',
]);

// Uniswap V3 Position Manager ABI (simplified)
const POSITION_MANAGER_ABI = parseAbi([
  'function balanceOf(address owner) view returns (uint256)',
  'function tokenOfOwnerByIndex(address owner, uint256 index) view returns (uint256)',
  'function positions(uint256 tokenId) view returns (uint96 nonce, address operator, address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint128 liquidity, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128, uint128 tokensOwed0, uint128 tokensOwed1)',
]);

// Chain configurations
const CHAIN_CONFIG = {
  base: {
    rpc: 'https://mainnet.base.org',
    positionManager: '0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1', // Uniswap V3 on Base
    graphUrl: 'https://api.studio.thegraph.com/query/48211/uniswap-v3-base/version/latest',
    // Common tokens for balance checking
    tokens: [
      '0x4200000000000000000000000000000000000006', // WETH
      '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', // USDC
      '0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca', // USDbC
      '0x50c5725949a6f0c72e6c4a641f24049a917db0cb', // DAI
      '0x2ae3f1ec7f1f5012cfeab0185bfc7aa3cf0dec22', // cbETH
      '0x940181a94a35a4569e4529a3cdfb74e38fd98631', // AERO
    ],
  },
};

/**
 * Get viem client
 */
function getClient(chain = 'base') {
  const config = CHAIN_CONFIG[chain] || CHAIN_CONFIG.base;
  return createPublicClient({
    chain: base,
    transport: http(config.rpc),
  });
}

/**
 * Check cache
 */
function getCached(key) {
  const cached = positionCache.get(key);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }
  return null;
}

/**
 * Set cache
 */
function setCache(key, data) {
  positionCache.set(key, {
    timestamp: Date.now(),
    data,
  });
}

/**
 * Fetch token balances via RPC
 */
export async function getTokenBalances(address, chain = 'base') {
  const cacheKey = `balances:${chain}:${address.toLowerCase()}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const config = CHAIN_CONFIG[chain] || CHAIN_CONFIG.base;
  const client = getClient(chain);
  const balances = [];

  // Get native ETH balance
  try {
    const ethBalance = await client.getBalance({ address });
    if (ethBalance > 0n) {
      balances.push({
        type: 'native',
        token: 'ETH',
        address: '0x0000000000000000000000000000000000000000',
        balance: ethBalance.toString(),
        balanceFormatted: formatUnits(ethBalance, 18),
        decimals: 18,
        symbol: 'ETH',
      });
    }
  } catch (error) {
    console.error('ETH balance error:', error.message);
  }

  // Get ERC20 balances
  for (const tokenAddress of config.tokens) {
    try {
      const [balance, decimals, symbol] = await Promise.all([
        client.readContract({
          address: tokenAddress,
          abi: ERC20_ABI,
          functionName: 'balanceOf',
          args: [address],
        }),
        client.readContract({
          address: tokenAddress,
          abi: ERC20_ABI,
          functionName: 'decimals',
        }),
        client.readContract({
          address: tokenAddress,
          abi: ERC20_ABI,
          functionName: 'symbol',
        }),
      ]);

      if (balance > 0n) {
        balances.push({
          type: 'token',
          token: symbol,
          address: tokenAddress.toLowerCase(),
          balance: balance.toString(),
          balanceFormatted: formatUnits(balance, decimals),
          decimals,
          symbol,
        });
      }
    } catch (error) {
      // Token might not exist or have standard interface
      console.error(`Token ${tokenAddress} error:`, error.message);
    }
  }

  setCache(cacheKey, balances);
  return balances;
}

/**
 * Fetch Uniswap V3 positions via The Graph
 */
export async function getV3Positions(address, chain = 'base') {
  const cacheKey = `v3positions:${chain}:${address.toLowerCase()}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const config = CHAIN_CONFIG[chain] || CHAIN_CONFIG.base;
  
  // GraphQL query for positions
  const query = `
    query GetPositions($owner: String!) {
      positions(where: { owner: $owner, liquidity_gt: "0" }) {
        id
        tokenId
        owner
        liquidity
        depositedToken0
        depositedToken1
        withdrawnToken0
        withdrawnToken1
        collectedFeesToken0
        collectedFeesToken1
        token0 {
          id
          symbol
          decimals
        }
        token1 {
          id
          symbol
          decimals
        }
        pool {
          id
          feeTier
          token0Price
          token1Price
          sqrtPrice
          tick
          liquidity
        }
        tickLower {
          tickIdx
          price0
          price1
        }
        tickUpper {
          tickIdx
          price0
          price1
        }
      }
    }
  `;

  try {
    const response = await fetch(config.graphUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query,
        variables: { owner: address.toLowerCase() },
      }),
    });

    if (!response.ok) {
      throw new Error(`Graph API error: ${response.status}`);
    }

    const data = await response.json();
    
    if (data.errors) {
      console.error('GraphQL errors:', data.errors);
      throw new Error(data.errors[0]?.message || 'GraphQL error');
    }

    const positions = (data.data?.positions || []).map(pos => ({
      type: 'lp_v3',
      protocol: 'uniswap_v3',
      tokenId: pos.tokenId,
      token0: {
        address: pos.token0.id,
        symbol: pos.token0.symbol,
        decimals: parseInt(pos.token0.decimals),
      },
      token1: {
        address: pos.token1.id,
        symbol: pos.token1.symbol,
        decimals: parseInt(pos.token1.decimals),
      },
      feeTier: parseInt(pos.pool.feeTier),
      liquidity: pos.liquidity,
      tickLower: parseInt(pos.tickLower.tickIdx),
      tickUpper: parseInt(pos.tickUpper.tickIdx),
      currentTick: parseInt(pos.pool.tick),
      sqrtPriceX96: pos.pool.sqrtPrice,
      deposited: {
        token0: pos.depositedToken0,
        token1: pos.depositedToken1,
      },
      withdrawn: {
        token0: pos.withdrawnToken0,
        token1: pos.withdrawnToken1,
      },
      collectedFees: {
        token0: pos.collectedFeesToken0,
        token1: pos.collectedFeesToken1,
      },
      poolPrices: {
        token0Price: pos.pool.token0Price,
        token1Price: pos.pool.token1Price,
      },
    }));

    setCache(cacheKey, positions);
    return positions;
  } catch (error) {
    console.error('Graph query error:', error.message);
    // Fallback to RPC if Graph fails
    return getV3PositionsViaRPC(address, chain);
  }
}

/**
 * Fallback: Get V3 positions via direct RPC calls
 */
async function getV3PositionsViaRPC(address, chain = 'base') {
  const config = CHAIN_CONFIG[chain] || CHAIN_CONFIG.base;
  const client = getClient(chain);
  const positions = [];

  try {
    // Get number of positions
    const positionCount = await client.readContract({
      address: config.positionManager,
      abi: POSITION_MANAGER_ABI,
      functionName: 'balanceOf',
      args: [address],
    });

    // Get each position
    for (let i = 0n; i < positionCount; i++) {
      try {
        const tokenId = await client.readContract({
          address: config.positionManager,
          abi: POSITION_MANAGER_ABI,
          functionName: 'tokenOfOwnerByIndex',
          args: [address, i],
        });

        const position = await client.readContract({
          address: config.positionManager,
          abi: POSITION_MANAGER_ABI,
          functionName: 'positions',
          args: [tokenId],
        });

        // Only include positions with liquidity
        if (position[7] > 0n) {
          positions.push({
            type: 'lp_v3',
            protocol: 'uniswap_v3',
            tokenId: tokenId.toString(),
            token0: { address: position[2].toLowerCase() },
            token1: { address: position[3].toLowerCase() },
            feeTier: Number(position[4]),
            liquidity: position[7].toString(),
            tickLower: Number(position[5]),
            tickUpper: Number(position[6]),
            tokensOwed: {
              token0: position[10].toString(),
              token1: position[11].toString(),
            },
          });
        }
      } catch (error) {
        console.error(`Position ${i} error:`, error.message);
      }
    }
  } catch (error) {
    console.error('RPC positions error:', error.message);
  }

  return positions;
}

/**
 * Calculate V3 position amounts from liquidity and ticks
 */
export function calculateV3Amounts(position) {
  const { liquidity, tickLower, tickUpper, currentTick } = position;
  
  if (!liquidity || liquidity === '0') {
    return { amount0: '0', amount1: '0' };
  }

  const sqrtPriceLower = Math.sqrt(1.0001 ** tickLower);
  const sqrtPriceUpper = Math.sqrt(1.0001 ** tickUpper);
  const sqrtPriceCurrent = Math.sqrt(1.0001 ** currentTick);
  
  const liq = BigInt(liquidity);
  
  let amount0 = 0n;
  let amount1 = 0n;
  
  if (currentTick < tickLower) {
    // All in token0
    amount0 = liq * BigInt(Math.floor((1 / sqrtPriceLower - 1 / sqrtPriceUpper) * 1e18)) / BigInt(1e18);
  } else if (currentTick >= tickUpper) {
    // All in token1
    amount1 = liq * BigInt(Math.floor((sqrtPriceUpper - sqrtPriceLower) * 1e18)) / BigInt(1e18);
  } else {
    // In range
    amount0 = liq * BigInt(Math.floor((1 / sqrtPriceCurrent - 1 / sqrtPriceUpper) * 1e18)) / BigInt(1e18);
    amount1 = liq * BigInt(Math.floor((sqrtPriceCurrent - sqrtPriceLower) * 1e18)) / BigInt(1e18);
  }
  
  return {
    amount0: amount0.toString(),
    amount1: amount1.toString(),
  };
}

/**
 * Check if position is in range
 */
export function isInRange(position) {
  const { tickLower, tickUpper, currentTick } = position;
  return currentTick >= tickLower && currentTick < tickUpper;
}

/**
 * Calculate range utilization (how close to edges)
 */
export function calculateRangeUtilization(position) {
  const { tickLower, tickUpper, currentTick } = position;
  
  if (currentTick < tickLower) return 0;
  if (currentTick >= tickUpper) return 0;
  
  const range = tickUpper - tickLower;
  const fromLower = currentTick - tickLower;
  const fromUpper = tickUpper - currentTick;
  
  // Distance from nearest edge as percentage
  const distanceFromEdge = Math.min(fromLower, fromUpper);
  const utilization = (distanceFromEdge / (range / 2)) * 100;
  
  return Math.round(utilization);
}

/**
 * Get all positions for an address
 */
export async function getAllPositions(address, chain = 'base') {
  const [tokenBalances, v3Positions] = await Promise.all([
    getTokenBalances(address, chain),
    getV3Positions(address, chain),
  ]);

  return {
    tokens: tokenBalances,
    lpPositions: v3Positions,
  };
}

/**
 * Clear caches (for testing)
 */
export function clearPositionCache() {
  positionCache.clear();
}

export default {
  getTokenBalances,
  getV3Positions,
  getAllPositions,
  calculateV3Amounts,
  isInRange,
  calculateRangeUtilization,
  clearPositionCache,
};
