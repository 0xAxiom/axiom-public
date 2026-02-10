#!/usr/bin/env node

import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { createPublicClient, http, keccak256, encodeAbiParameters, parseAbiParameters } from 'viem';
import { base } from 'viem/chains';

// Constants
const STATE_VIEW = '0xa3c0c9b65bad0b08107aa264b0f3db444b867a71';
const POOL_MANAGER = '0x498581ff718922c3f8e6a244956af099b2652b2b';
const WETH = '0x4200000000000000000000000000000000000006';
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const AXIOM = '0xf3ce5ddaab6c133f9875a4a46c55cf0b58111b07';

const STATE_VIEW_ABI = [
  {
    name: 'getSlot0',
    type: 'function',
    inputs: [
      { name: 'poolManager', type: 'address' },
      { name: 'poolId', type: 'bytes32' }
    ],
    outputs: [
      { name: 'sqrtPriceX96', type: 'uint160' },
      { name: 'tick', type: 'int24' },
      { name: 'protocolFee', type: 'uint24' },
      { name: 'lpFee', type: 'uint24' }
    ],
    stateMutability: 'view'
  }
];

// Fee tier to tick spacing mapping
const FEE_TO_TICK_SPACING = {
  500: 10,
  3000: 60,
  10000: 200,
  0x800000: 200 // Dynamic fee
};

function tickToPrice(tick) {
  return Math.pow(1.0001, tick);
}

function priceToTick(price) {
  return Math.log(price) / Math.log(1.0001);
}

function parsePoolKey(poolKeyStr) {
  const parts = poolKeyStr.split(',');
  if (parts.length !== 5) {
    throw new Error('Pool key must have 5 parts: currency0,currency1,fee,tickSpacing,hooks');
  }
  
  return {
    currency0: parts[0].trim(),
    currency1: parts[1].trim(),
    fee: parseInt(parts[2].trim()),
    tickSpacing: parseInt(parts[3].trim()),
    hooks: parts[4].trim()
  };
}

function computePoolId(poolKey) {
  // Encode pool key struct and hash it
  const encoded = encodeAbiParameters(
    parseAbiParameters('address, address, uint24, int24, address'),
    [poolKey.currency0, poolKey.currency1, poolKey.fee, poolKey.tickSpacing, poolKey.hooks]
  );
  
  return keccak256(encoded);
}

function validateTicks(tickLower, tickUpper, tickSpacing, currentTick) {
  const warnings = [];
  
  // Basic validations
  if (tickLower >= tickUpper) {
    warnings.push('ERROR: tickLower must be less than tickUpper');
  }
  
  if (tickLower % tickSpacing !== 0) {
    warnings.push(`ERROR: tickLower (${tickLower}) must be multiple of tickSpacing (${tickSpacing})`);
  }
  
  if (tickUpper % tickSpacing !== 0) {
    warnings.push(`ERROR: tickUpper (${tickUpper}) must be multiple of tickSpacing (${tickSpacing})`);
  }
  
  // Check if current tick is in range
  if (currentTick < tickLower || currentTick > tickUpper) {
    warnings.push('WARNING: Current tick is outside the specified range');
  }
  
  return warnings;
}

function addRangeWarnings(rangePercent, warnings) {
  if (rangePercent > 95) {
    warnings.push('WARNING: Extremely wide range (>95%) - very low fee APR');
  } else if (rangePercent > 50) {
    warnings.push('WARNING: Wide range: lower fee APR but safer');
  } else if (rangePercent < 0.5) {
    warnings.push('WARNING: Extremely tight range (<0.5%) - very high IL risk');
  } else if (rangePercent < 5) {
    warnings.push('WARNING: Tight range: high IL risk, frequent rebalancing needed');
  }
  
  return warnings;
}

async function fetchCurrentTick(poolKey, rpcUrl) {
  const client = createPublicClient({
    chain: base,
    transport: http(rpcUrl)
  });
  
  const poolId = computePoolId(poolKey);
  
  try {
    const result = await client.readContract({
      address: STATE_VIEW,
      abi: STATE_VIEW_ABI,
      functionName: 'getSlot0',
      args: [POOL_MANAGER, poolId]
    });
    
    return Number(result[1]); // tick is second return value
  } catch (error) {
    throw new Error(`Failed to fetch pool state: ${error.message}`);
  }
}

function calculateTicks(currentTick, rangePercent, tickSpacing, verbose = false) {
  // CORRECT formula from Feb 10 fix
  const tickRange = Math.round(Math.log(1 + rangePercent / 100) / Math.log(1.0001));
  
  if (verbose) {
    console.error(`Range ${rangePercent}% = ${tickRange} ticks`);
  }
  
  // Snap to tick spacing
  const tickLower = Math.floor((currentTick - tickRange) / tickSpacing) * tickSpacing;
  const tickUpper = Math.ceil((currentTick + tickRange) / tickSpacing) * tickSpacing;
  
  if (verbose) {
    console.error(`Raw range: ${currentTick - tickRange} to ${currentTick + tickRange}`);
    console.error(`Snapped to spacing: ${tickLower} to ${tickUpper}`);
  }
  
  // Calculate prices
  const currentPrice = tickToPrice(currentTick);
  const priceLower = tickToPrice(tickLower);
  const priceUpper = tickToPrice(tickUpper);
  
  // Calculate actual range percentages
  const actualRangeLower = ((currentPrice - priceLower) / currentPrice) * 100;
  const actualRangeUpper = ((priceUpper - currentPrice) / currentPrice) * 100;
  
  return {
    currentTick,
    currentPrice: currentPrice.toFixed(6),
    tickLower,
    tickUpper,
    priceLower: priceLower.toFixed(6),
    priceUpper: priceUpper.toFixed(6),
    actualRangePercent: {
      lower: Math.round(actualRangeLower * 10) / 10,
      upper: Math.round(actualRangeUpper * 10) / 10
    },
    tickSpacing,
    ticksInRange: (tickUpper - tickLower) / tickSpacing + 1
  };
}

async function main() {
  const argv = yargs(hideBin(process.argv))
    .option('pool-key', {
      type: 'string',
      describe: 'Comma-separated pool key: currency0,currency1,fee,tickSpacing,hooks'
    })
    .option('token0', {
      type: 'string',
      describe: 'Token0 address (alternative to pool-key)'
    })
    .option('token1', {
      type: 'string',
      describe: 'Token1 address (alternative to pool-key)'
    })
    .option('range', {
      type: 'number',
      describe: 'Desired range in percent (e.g., 15 for ±15%)',
      demandOption: true
    })
    .option('tick-spacing', {
      type: 'number',
      describe: 'Override tick spacing (default: auto-detect from fee)'
    })
    .option('current-tick', {
      type: 'number',
      describe: 'Override current tick (default: fetch from chain)'
    })
    .option('rpc', {
      type: 'string',
      describe: 'RPC URL',
      default: process.env.BASE_RPC_URL || 'https://mainnet.base.org'
    })
    .option('test', {
      type: 'boolean',
      describe: 'Run with hardcoded test values (no RPC needed)',
      default: false
    })
    .option('verbose', {
      type: 'boolean',
      describe: 'Show intermediate math',
      default: false
    })
    .help()
    .parse();

  try {
    let currentTick = argv['current-tick'];
    let tickSpacing = argv['tick-spacing'];
    
    // Test mode with hardcoded values
    if (argv.test) {
      currentTick = 196423;
      tickSpacing = 200;
      if (argv.verbose) {
        console.error('Running in test mode with hardcoded values');
      }
    } else {
      // Parse pool configuration
      let poolKey;
      
      if (argv['pool-key']) {
        poolKey = parsePoolKey(argv['pool-key']);
      } else if (argv.token0 && argv.token1) {
        // Default configuration for token pair
        const fee = 3000; // Default to 0.3%
        poolKey = {
          currency0: argv.token0,
          currency1: argv.token1,
          fee,
          tickSpacing: tickSpacing || FEE_TO_TICK_SPACING[fee] || 60,
          hooks: '0x0000000000000000000000000000000000000000'
        };
      } else {
        throw new Error('Must provide either --pool-key or both --token0 and --token1');
      }
      
      // Auto-detect tick spacing from fee if not provided
      if (!tickSpacing) {
        tickSpacing = FEE_TO_TICK_SPACING[poolKey.fee] || 60;
      }
      
      // Fetch current tick from chain if not provided
      if (currentTick === undefined) {
        if (argv.verbose) {
          console.error('Fetching current tick from chain...');
        }
        currentTick = await fetchCurrentTick(poolKey, argv.rpc);
      }
    }
    
    // Calculate tick bounds
    const result = calculateTicks(currentTick, argv.range, tickSpacing, argv.verbose);
    
    // Add validations
    let warnings = validateTicks(result.tickLower, result.tickUpper, tickSpacing, currentTick);
    warnings = addRangeWarnings(argv.range, warnings);
    
    // Output result
    const output = {
      ...result,
      warnings
    };
    
    console.log(JSON.stringify(output, null, 2));
    
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

main();