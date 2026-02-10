#!/usr/bin/env node
/**
 * Uniswap V4 LP Position Calculator & Simulator
 * Calculates tick ranges, token amounts, and simulates APR for AXIOM/WETH pool
 * 
 * Usage:
 *   node lp-calculator.mjs range --pct 15
 *   node lp-calculator.mjs amounts --pct 15 --usd 500
 *   node lp-calculator.mjs simulate --pct 15 --days 30
 */

import { createPublicClient, http, formatEther, parseEther } from 'viem';
import { base } from 'viem/chains';
import * as dotenv from 'dotenv';
import { resolve } from 'path';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

dotenv.config({ path: resolve(process.env.HOME, '.axiom/wallet.env') });

// Constants
const CONTRACTS = {
  STATE_VIEW: '0xa3c0c9b65bad0b08107aa264b0f3db444b867a71',
  WETH: '0x4200000000000000000000000000000000000006',
  AXIOM: '0xf3Ce5dDAAb6C133F9875a4a46C55cf0b58111B07',
};

const AXIOM_POOL = {
  poolId: '0x10a0b8eba9d4e0f772c8c47968ee819bb4609ef4454409157961570cdce9a735',
  fee: 0x800000, // DYNAMIC_FEE_FLAG
  tickSpacing: 200,
  hooks: '0xb429d62f8f3bffb98cdb9569533ea23bf0ba28cc',
};

// Math constants
const Q96 = BigInt(2) ** BigInt(96);
const MIN_TICK = -887272;
const MAX_TICK = 887272;
const ETH_PRICE_USD = 2750; // Rough estimate for USD calculations

// ABIs
const STATE_VIEW_ABI = [
  {
    name: 'getSlot0',
    type: 'function',
    inputs: [{ name: 'poolId', type: 'bytes32' }],
    outputs: [
      { name: 'sqrtPriceX96', type: 'uint160' },
      { name: 'tick', type: 'int24' },
      { name: 'protocolFee', type: 'uint24' },
      { name: 'lpFee', type: 'uint24' }
    ]
  }
];

const ERC20_ABI = [
  {
    name: 'balanceOf',
    type: 'function',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ type: 'uint256' }]
  }
];

// Math functions
function tickToSqrtPriceX96(tick) {
  const sqrtRatio = Math.sqrt(Math.pow(1.0001, tick));
  return BigInt(Math.floor(sqrtRatio * Number(Q96)));
}

function sqrtPriceX96ToPrice(sqrtPriceX96) {
  return (Number(sqrtPriceX96) / 2 ** 96) ** 2;
}

function priceToTick(price) {
  return Math.floor(Math.log(price) / Math.log(1.0001));
}

function getLiquidityForAmount0(sqrtPriceA, sqrtPriceB, amount0) {
  if (sqrtPriceA > sqrtPriceB) [sqrtPriceA, sqrtPriceB] = [sqrtPriceB, sqrtPriceA];
  const intermediate = (sqrtPriceA * sqrtPriceB) / Q96;
  return (amount0 * intermediate) / (sqrtPriceB - sqrtPriceA);
}

function getLiquidityForAmount1(sqrtPriceA, sqrtPriceB, amount1) {
  if (sqrtPriceA > sqrtPriceB) [sqrtPriceA, sqrtPriceB] = [sqrtPriceB, sqrtPriceA];
  return (amount1 * Q96) / (sqrtPriceB - sqrtPriceA);
}

function getLiquidityForAmounts(sqrtPriceX96, sqrtPriceA, sqrtPriceB, amount0, amount1) {
  if (sqrtPriceA > sqrtPriceB) [sqrtPriceA, sqrtPriceB] = [sqrtPriceB, sqrtPriceA];
  
  if (sqrtPriceX96 <= sqrtPriceA) {
    return getLiquidityForAmount0(sqrtPriceA, sqrtPriceB, amount0);
  } else if (sqrtPriceX96 < sqrtPriceB) {
    const liquidity0 = getLiquidityForAmount0(sqrtPriceX96, sqrtPriceB, amount0);
    const liquidity1 = getLiquidityForAmount1(sqrtPriceA, sqrtPriceX96, amount1);
    return liquidity0 < liquidity1 ? liquidity0 : liquidity1;
  } else {
    return getLiquidityForAmount1(sqrtPriceA, sqrtPriceB, amount1);
  }
}

// Validation functions
function validateTickRange(tickLower, tickUpper, tickSpacing) {
  const errors = [];
  
  // Basic ordering
  if (tickLower >= tickUpper) {
    errors.push(`tickLower (${tickLower}) must be less than tickUpper (${tickUpper})`);
  }
  
  // Tick spacing alignment
  if (tickLower % tickSpacing !== 0) {
    errors.push(`tickLower (${tickLower}) must be divisible by tickSpacing (${tickSpacing})`);
  }
  
  if (tickUpper % tickSpacing !== 0) {
    errors.push(`tickUpper (${tickUpper}) must be divisible by tickSpacing (${tickSpacing})`);
  }
  
  // Bounds checking
  if (tickLower < MIN_TICK) {
    errors.push(`tickLower (${tickLower}) below minimum tick (${MIN_TICK})`);
  }
  
  if (tickUpper > MAX_TICK) {
    errors.push(`tickUpper (${tickUpper}) above maximum tick (${MAX_TICK})`);
  }
  
  return errors;
}

function validateRangePercentage(pct) {
  if (pct < 2) {
    return ['Range too narrow (minimum 2%)'];
  }
  if (pct > 90) {
    return ['Range too wide (maximum 90%)'];
  }
  return [];
}

// Create RPC client
function createClient() {
  const rpcUrl = process.env.BASE_RPC_URL || 
                 (process.env.INFURA_API_KEY ? `https://base-mainnet.infura.io/v3/${process.env.INFURA_API_KEY}` : 
                  'https://mainnet.base.org');
  
  return createPublicClient({
    chain: base,
    transport: http(rpcUrl),
  });
}

// Get current pool state
async function getPoolState() {
  const client = createClient();
  
  try {
    const [sqrtPriceX96, currentTick, protocolFee, lpFee] = await client.readContract({
      address: CONTRACTS.STATE_VIEW,
      abi: STATE_VIEW_ABI,
      functionName: 'getSlot0',
      args: [AXIOM_POOL.poolId],
    });

    const price = sqrtPriceX96ToPrice(sqrtPriceX96);
    
    return {
      sqrtPriceX96,
      currentTick: Number(currentTick),
      protocolFee: Number(protocolFee),
      lpFee: Number(lpFee),
      price,
      priceFormatted: price.toFixed(8)
    };
  } catch (error) {
    throw new Error(`Failed to fetch pool state: ${error.message}`);
  }
}

// Calculate tick range for given percentage
function calculateTickRange(currentTick, rangePct, tickSpacing) {
  // CORRECT tick math from working scripts
  const tick = Math.floor(Math.log(1 + rangePct / 100) / Math.log(1.0001));
  const alignedTick = Math.round(currentTick / tickSpacing) * tickSpacing;
  const rangeWidth = Math.round(tick / tickSpacing) * tickSpacing;
  
  const tickLower = alignedTick - rangeWidth;
  const tickUpper = alignedTick + rangeWidth;
  
  // Ensure proper alignment and ordering
  const finalLower = Math.floor(tickLower / tickSpacing) * tickSpacing;
  const finalUpper = Math.ceil(tickUpper / tickSpacing) * tickSpacing;
  
  return { tickLower: finalLower, tickUpper: finalUpper };
}

// Command handlers
async function handleRangeCommand(args) {
  console.log('🎯 LP Range Calculator');
  console.log('================================');
  
  // Validation
  const rangeErrors = validateRangePercentage(args.pct);
  if (rangeErrors.length > 0) {
    console.error('❌ Range validation failed:');
    rangeErrors.forEach(err => console.error(`   ${err}`));
    process.exit(1);
  }
  
  // Get current state
  const poolState = await getPoolState();
  console.log(`Current price: ${poolState.priceFormatted} AXIOM/WETH`);
  console.log(`Current tick: ${poolState.currentTick}`);
  console.log(`LP Fee: ${poolState.lpFee / 10000}%`);
  
  // Calculate range
  const { tickLower, tickUpper } = calculateTickRange(
    poolState.currentTick, 
    args.pct, 
    AXIOM_POOL.tickSpacing
  );
  
  // Validate calculated ticks
  const tickErrors = validateTickRange(tickLower, tickUpper, AXIOM_POOL.tickSpacing);
  if (tickErrors.length > 0) {
    console.error('\n❌ Tick validation failed:');
    tickErrors.forEach(err => console.error(`   ${err}`));
    process.exit(1);
  }
  
  // Calculate price range
  const lowerPrice = sqrtPriceX96ToPrice(tickToSqrtPriceX96(tickLower));
  const upperPrice = sqrtPriceX96ToPrice(tickToSqrtPriceX96(tickUpper));
  
  console.log('\n📊 Calculated Range:');
  console.log(`   Range: ±${args.pct}%`);
  console.log(`   Tick Lower: ${tickLower}`);
  console.log(`   Tick Upper: ${tickUpper}`);
  console.log(`   Price Lower: ${lowerPrice.toFixed(8)} AXIOM/WETH`);
  console.log(`   Price Upper: ${upperPrice.toFixed(8)} AXIOM/WETH`);
  
  // Safety checks that would have caught Feb 10 bugs
  console.log('\n✅ Safety Checks:');
  console.log(`   ✓ tickLower < tickUpper: ${tickLower} < ${tickUpper}`);
  console.log(`   ✓ Both ticks aligned to spacing (${AXIOM_POOL.tickSpacing})`);
  console.log(`   ✓ Range within bounds (2% - 90%)`);
  console.log(`   ✓ Ticks within protocol limits`);
}

async function handleAmountsCommand(args) {
  console.log('💰 LP Amount Calculator');
  console.log('================================');
  
  // Validation
  const rangeErrors = validateRangePercentage(args.pct);
  if (rangeErrors.length > 0) {
    console.error('❌ Range validation failed:');
    rangeErrors.forEach(err => console.error(`   ${err}`));
    process.exit(1);
  }
  
  if (args.usd <= 0) {
    console.error('❌ USD amount must be positive');
    process.exit(1);
  }
  
  // Get current state
  const poolState = await getPoolState();
  const { tickLower, tickUpper } = calculateTickRange(
    poolState.currentTick,
    args.pct,
    AXIOM_POOL.tickSpacing
  );
  
  // Validate ticks
  const tickErrors = validateTickRange(tickLower, tickUpper, AXIOM_POOL.tickSpacing);
  if (tickErrors.length > 0) {
    console.error('\n❌ Tick validation failed:');
    tickErrors.forEach(err => console.error(`   ${err}`));
    process.exit(1);
  }
  
  console.log(`USD Amount: $${args.usd}`);
  console.log(`Range: ±${args.pct}%`);
  console.log(`Current price: ${poolState.priceFormatted} AXIOM/WETH`);
  
  // Calculate optimal amounts (50/50 split by USD value)
  const wethUsd = args.usd / 2;
  const axiomUsd = args.usd / 2;
  
  const wethAmount = parseEther(String(wethUsd / ETH_PRICE_USD));
  const axiomAmountEth = wethUsd / ETH_PRICE_USD * poolState.price; // Convert via price ratio
  const axiomAmount = parseEther(String(axiomAmountEth));
  
  // Calculate liquidity for position
  const sqrtPriceLower = tickToSqrtPriceX96(tickLower);
  const sqrtPriceUpper = tickToSqrtPriceX96(tickUpper);
  const liquidity = getLiquidityForAmounts(
    poolState.sqrtPriceX96,
    sqrtPriceLower,
    sqrtPriceUpper,
    wethAmount,
    axiomAmount
  );
  
  console.log('\n💎 Optimal Token Amounts:');
  console.log(`   WETH: ${formatEther(wethAmount)} (~$${wethUsd.toFixed(2)})`);
  console.log(`   AXIOM: ${formatEther(axiomAmount)} (~$${axiomUsd.toFixed(2)})`);
  console.log(`   Calculated Liquidity: ${liquidity.toString()}`);
  
  console.log('\n📏 Position Details:');
  console.log(`   Tick Range: ${tickLower} to ${tickUpper}`);
  console.log(`   Price Range: ${sqrtPriceX96ToPrice(sqrtPriceLower).toFixed(8)} to ${sqrtPriceX96ToPrice(sqrtPriceUpper).toFixed(8)}`);
  
  // Sanity checks
  if (liquidity === 0n) {
    console.warn('\n⚠️  WARNING: Calculated liquidity is 0! Check your inputs.');
  }
  
  const maxUint128 = 2n ** 128n - 1n;
  if (liquidity > maxUint128) {
    console.error('\n❌ Liquidity exceeds uint128 maximum!');
    process.exit(1);
  }
  
  console.log('\n✅ Amount validation passed');
}

async function handleSimulateCommand(args) {
  console.log('📈 LP APR Simulator');
  console.log('================================');
  
  // Validation
  const rangeErrors = validateRangePercentage(args.pct);
  if (rangeErrors.length > 0) {
    console.error('❌ Range validation failed:');
    rangeErrors.forEach(err => console.error(`   ${err}`));
    process.exit(1);
  }
  
  if (args.days <= 0) {
    console.error('❌ Days must be positive');
    process.exit(1);
  }
  
  const poolState = await getPoolState();
  const { tickLower, tickUpper } = calculateTickRange(
    poolState.currentTick,
    args.pct,
    AXIOM_POOL.tickSpacing
  );
  
  console.log(`Simulating ±${args.pct}% range for ${args.days} days`);
  console.log(`Current LP Fee: ${poolState.lpFee / 10000}%`);
  
  // Simple APR estimation based on:
  // - Fee tier (dynamic, assume average 0.30%)
  // - Range width (wider = less concentrated = lower fees)
  // - Volume assumptions for AXIOM/WETH pair
  
  const rangeFactor = Math.max(0.1, 1 / (args.pct / 10)); // Tighter ranges get more fees
  const baseFeeAPR = (poolState.lpFee / 10000) * 365 * 100; // Base fee APR %
  const volumeMultiplier = 0.5; // Conservative volume assumption
  
  const estimatedAPR = baseFeeAPR * rangeFactor * volumeMultiplier;
  const dailyReturn = estimatedAPR / 365;
  const periodReturn = dailyReturn * args.days;
  
  console.log('\n🎯 APR Simulation (Rough Estimates):');
  console.log(`   Base Fee APR: ${baseFeeAPR.toFixed(2)}%`);
  console.log(`   Range Factor: ${rangeFactor.toFixed(2)}x`);
  console.log(`   Estimated APR: ${estimatedAPR.toFixed(2)}%`);
  console.log(`   Daily Return: ${dailyReturn.toFixed(4)}%`);
  console.log(`   ${args.days}-day Return: ${periodReturn.toFixed(2)}%`);
  
  console.log('\n📝 Assumptions:');
  console.log(`   - Dynamic fee averaging ${(poolState.lpFee / 10000).toFixed(2)}%`);
  console.log(`   - Conservative volume multiplier (0.5x)`);
  console.log(`   - No impermanent loss calculations`);
  console.log(`   - Price stays within range 100% of time`);
  
  console.log('\n⚠️  Note: This is a rough estimate. Actual returns depend on:');
  console.log('   - Actual trading volume');
  console.log('   - Price volatility and range efficiency');
  console.log('   - Dynamic fee adjustments');
  console.log('   - Impermanent loss vs fee accumulation');
}

// CLI setup
const argv = yargs(hideBin(process.argv))
  .command('range', 'Calculate tick range for given percentage', {
    pct: {
      type: 'number',
      default: 15,
      description: 'Range percentage (±%)'
    }
  })
  .command('amounts', 'Calculate token amounts for USD value', {
    pct: {
      type: 'number',
      default: 15,
      description: 'Range percentage (±%)'
    },
    usd: {
      type: 'number',
      required: true,
      description: 'Total USD value to deploy'
    }
  })
  .command('simulate', 'Simulate APR for given range and timeframe', {
    pct: {
      type: 'number',
      default: 15,
      description: 'Range percentage (±%)'
    },
    days: {
      type: 'number',
      default: 30,
      description: 'Simulation period in days'
    }
  })
  .demandCommand(1, 'You must specify a command')
  .help()
  .parse();

// Route to appropriate handler
async function main() {
  try {
    const command = argv._[0];
    
    switch (command) {
      case 'range':
        await handleRangeCommand(argv);
        break;
      case 'amounts':
        await handleAmountsCommand(argv);
        break;
      case 'simulate':
        await handleSimulateCommand(argv);
        break;
      default:
        console.error(`Unknown command: ${command}`);
        process.exit(1);
    }
  } catch (error) {
    console.error(`❌ Error: ${error.message}`);
    process.exit(1);
  }
}

main();