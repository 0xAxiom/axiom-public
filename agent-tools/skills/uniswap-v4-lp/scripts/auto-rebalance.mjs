#!/usr/bin/env node
/**
 * Preemptive Auto-Rebalance V4 LP Position
 *
 * Designed to run on cron every 15-30 min. Idempotent and safe.
 *
 * PREEMPTIVE LOGIC — never waits until out of range:
 *   1. Read position state (tick range, liquidity)
 *   2. Get current pool tick from slot0
 *   3. Calculate drift: how far price has moved toward either edge
 *      as a percentage of the total range width
 *   4. If drift ≤ threshold (default 75%) → compound accrued fees in-place
 *   5. If drift > threshold → REBALANCE NOW (before going OOR)
 *      Uses V4 flash accounting to do it atomically in ONE transaction:
 *        DECREASE_LIQUIDITY(full) + MINT_POSITION(new range) + CLOSE_CURRENCY × 2
 *      Tokens from the decrease net against tokens needed for the mint.
 *
 * Usage:
 *   # Dry-run (check status)
 *   node auto-rebalance.mjs --token-id 1396852 --dry-run
 *
 *   # Execute with defaults (±20% range, 75% threshold)
 *   node auto-rebalance.mjs --token-id 1396852
 *
 *   # Custom range and threshold
 *   node auto-rebalance.mjs --token-id 1396852 --range-pct 25 --threshold-pct 80
 *
 *   # With harvest address for leftover dust
 *   node auto-rebalance.mjs --token-id 1396852 --harvest-address 0x...
 *
 * V4 Action Codes (from official docs):
 *   0x00 INCREASE_LIQUIDITY     0x01 DECREASE_LIQUIDITY
 *   0x02 MINT_POSITION          0x03 BURN_POSITION
 *   0x04 INCREASE_FROM_DELTAS   0x05 MINT_FROM_DELTAS
 *   0x0b SETTLE                 0x0c SETTLE_ALL
 *   0x0d SETTLE_PAIR            0x0e TAKE
 *   0x0f TAKE_ALL               0x10 TAKE_PORTION
 *   0x11 TAKE_PAIR              0x12 CLOSE_CURRENCY
 *   0x13 CLEAR_OR_TAKE
 *
 * Proven patterns:
 *   Mint/Increase:  action + SETTLE_PAIR(0x0d) — tokens going IN
 *   Decrease/Burn:  action + TAKE_PAIR(0x11)   — tokens coming OUT
 *   Atomic rebalance: DECREASE + MINT + CLOSE_CURRENCY × 2
 *     (CLOSE_CURRENCY handles either direction per token via flash accounting)
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  formatEther,
  formatUnits,
  maxUint256,
  keccak256,
  encodeAbiParameters,
  parseAbiParameters,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base } from 'viem/chains';
import { defaultAbiCoder } from '@ethersproject/abi';
import * as dotenv from 'dotenv';
import { resolve } from 'path';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

dotenv.config({ path: resolve(process.env.HOME, '.axiom/wallet.env') });

// ─── CLI Args ────────────────────────────────────────────────────────────────

const argv = yargs(hideBin(process.argv))
  .option('token-id', {
    type: 'number',
    required: true,
    description: 'LP NFT token ID',
  })
  .option('harvest-address', {
    type: 'string',
    default: '',
    description: 'Address to send leftover dust (optional)',
  })
  .option('dry-run', {
    type: 'boolean',
    default: false,
    description: 'Check status only, don\'t execute',
  })
  .option('range-pct', {
    type: 'number',
    default: 20,
    description: 'Range percentage (±%) around current price for new position',
  })
  .option('threshold-pct', {
    type: 'number',
    default: 75,
    description: 'Drift threshold (%) — rebalance when price uses this much of the range',
  })
  .option('slippage', {
    type: 'number',
    default: 5,
    description: 'Slippage tolerance percent for max amounts',
  })
  .option('rpc', {
    type: 'string',
    default: process.env.BASE_RPC_URL || 'https://mainnet.base.org',
    description: 'Base RPC URL',
  })
  .parse();

// ─── Constants ───────────────────────────────────────────────────────────────

const CONTRACTS = {
  POOL_MANAGER: '0x498581ff718922c3f8e6a244956af099b2652b2b',
  POSITION_MANAGER: '0x7c5f5a4bbd8fd63184577525326123b519429bdc',
  STATE_VIEW: '0xa3c0c9b65bad0b08107aa264b0f3db444b867a71',
  PERMIT2: '0x000000000022D473030F116dDEE9F6B43aC78BA3',
  WETH: '0x4200000000000000000000000000000000000006',
  AXIOM: '0xf3Ce5dDAAb6C133F9875a4a46C55cf0b58111B07',
};

// V4 pool key (WETH/AXIOM on Base)
const POOL_KEY = {
  currency0: '0x4200000000000000000000000000000000000006',  // WETH (lower address)
  currency1: '0xf3ce5ddaab6c133f9875a4a46c55cf0b58111b07',  // AXIOM
  fee: 0,
  tickSpacing: 200,
  hooks: '0xb429d62f8f3bffb98cdb9569533ea23bf0ba28cc',
};

const POOL_KEY_STRUCT = '(address,address,uint24,int24,address)';
const Q96 = 2n ** 96n;
const TICK_SPACING = 200;

// V4 Action Codes (official reference)
const Actions = {
  INCREASE_LIQUIDITY: 0x00,
  DECREASE_LIQUIDITY: 0x01,
  MINT_POSITION: 0x02,
  BURN_POSITION: 0x03,
  SETTLE_PAIR: 0x0d,
  TAKE_PAIR: 0x11,
  CLOSE_CURRENCY: 0x12,
};

// ─── ABIs ────────────────────────────────────────────────────────────────────

const POSITION_MANAGER_ABI = [
  {
    name: 'modifyLiquidities',
    type: 'function',
    inputs: [
      { name: 'unlockData', type: 'bytes' },
      { name: 'deadline', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    name: 'getPoolAndPositionInfo',
    type: 'function',
    inputs: [{ type: 'uint256' }],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'currency0', type: 'address' },
          { name: 'currency1', type: 'address' },
          { name: 'fee', type: 'uint24' },
          { name: 'tickSpacing', type: 'int24' },
          { name: 'hooks', type: 'address' },
        ],
      },
      { type: 'uint256' },
    ],
  },
  {
    name: 'ownerOf',
    type: 'function',
    inputs: [{ type: 'uint256' }],
    outputs: [{ type: 'address' }],
  },
  {
    name: 'getPositionLiquidity',
    type: 'function',
    inputs: [{ type: 'uint256' }],
    outputs: [{ type: 'uint128' }],
  },
];

const STATE_VIEW_ABI = [
  {
    name: 'getSlot0',
    type: 'function',
    inputs: [{ name: 'poolId', type: 'bytes32' }],
    outputs: [
      { name: 'sqrtPriceX96', type: 'uint160' },
      { name: 'tick', type: 'int24' },
      { name: 'protocolFee', type: 'uint24' },
      { name: 'lpFee', type: 'uint24' },
    ],
  },
];

const ERC20_ABI = [
  { name: 'balanceOf', type: 'function', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] },
  { name: 'approve', type: 'function', inputs: [{ type: 'address' }, { type: 'uint256' }], outputs: [{ type: 'bool' }] },
  { name: 'allowance', type: 'function', inputs: [{ type: 'address' }, { type: 'address' }], outputs: [{ type: 'uint256' }] },
  { name: 'transfer', type: 'function', inputs: [{ name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }] },
];

const PERMIT2_ABI = [
  {
    name: 'approve',
    type: 'function',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint160' },
      { name: 'expiration', type: 'uint48' },
    ],
    outputs: [],
  },
  {
    name: 'allowance',
    type: 'function',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'token', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [
      { name: 'amount', type: 'uint160' },
      { name: 'expiration', type: 'uint48' },
      { name: 'nonce', type: 'uint48' },
    ],
  },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function toInt24(v) {
  return v >= 0x800000 ? v - 0x1000000 : v;
}

function tickToSqrtPriceX96(tick) {
  // Use higher precision for large tick values
  // Math.sqrt(1.0001^tick) * 2^96
  return BigInt(Math.floor(Math.sqrt(Math.pow(1.0001, tick)) * Number(Q96)));
}

function getLiquidityForAmounts(sqrtPriceX96, sqrtPriceA, sqrtPriceB, amount0, amount1) {
  if (sqrtPriceA > sqrtPriceB) [sqrtPriceA, sqrtPriceB] = [sqrtPriceB, sqrtPriceA];

  const liq0 = (a0, sqrtA, sqrtB) =>
    (a0 * ((sqrtA * sqrtB) / Q96)) / (sqrtB - sqrtA);
  const liq1 = (a1, sqrtA, sqrtB) =>
    (a1 * Q96) / (sqrtB - sqrtA);

  if (sqrtPriceX96 <= sqrtPriceA) return liq0(amount0, sqrtPriceA, sqrtPriceB);
  if (sqrtPriceX96 < sqrtPriceB) {
    const l0 = liq0(amount0, sqrtPriceX96, sqrtPriceB);
    const l1 = liq1(amount1, sqrtPriceA, sqrtPriceX96);
    return l0 < l1 ? l0 : l1;
  }
  return liq1(amount1, sqrtPriceA, sqrtPriceB);
}

/**
 * Estimate amounts we'd get back from removing liquidity.
 */
function getAmountsFromLiquidity(liquidity, sqrtPriceX96, sqrtPriceLower, sqrtPriceUpper) {
  let amount0 = 0n, amount1 = 0n;
  if (sqrtPriceX96 <= sqrtPriceLower) {
    amount0 = (liquidity * Q96 * (sqrtPriceUpper - sqrtPriceLower)) / (sqrtPriceLower * sqrtPriceUpper);
  } else if (sqrtPriceX96 < sqrtPriceUpper) {
    amount0 = (liquidity * Q96 * (sqrtPriceUpper - sqrtPriceX96)) / (sqrtPriceX96 * sqrtPriceUpper);
    amount1 = (liquidity * (sqrtPriceX96 - sqrtPriceLower)) / Q96;
  } else {
    amount1 = (liquidity * (sqrtPriceUpper - sqrtPriceLower)) / Q96;
  }
  return { amount0, amount1 };
}

async function retry(fn, maxRetries = 4, baseDelayMs = 2000) {
  let delay = baseDelayMs;
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i === maxRetries - 1) throw err;
      if (!err.message?.includes('429') && !err.message?.includes('rate limit')) throw err;
      console.log(`   ⏳ Rate limited, retry ${i + 1}/${maxRetries} in ${delay / 1000}s...`);
      await sleep(delay);
      delay *= 2;
    }
  }
}

function getPoolIdHash(poolKey) {
  const poolId = defaultAbiCoder.encode(
    [POOL_KEY_STRUCT],
    [[poolKey.currency0, poolKey.currency1, poolKey.fee, poolKey.tickSpacing, poolKey.hooks]]
  );
  return keccak256(poolId);
}

// ─── Drift Calculation ──────────────────────────────────────────────────────

/**
 * Calculate how far the current tick has drifted from center toward either edge.
 *
 * Returns a value 0-100:
 *   0%   = perfectly centered
 *   50%  = halfway to an edge
 *   100% = at the edge (out of range)
 *   >100% = already out of range
 *
 * The drift is measured as the distance from center to current tick,
 * divided by half the range width (center to edge).
 */
function calculateDrift(currentTick, tickLower, tickUpper) {
  const rangeWidth = tickUpper - tickLower;
  const center = tickLower + rangeWidth / 2;
  const halfRange = rangeWidth / 2;

  if (halfRange === 0) return 100; // degenerate range

  const distFromCenter = Math.abs(currentTick - center);
  const driftPct = (distFromCenter / halfRange) * 100;

  // Which direction?
  const direction = currentTick >= center ? 'upper' : 'lower';

  return { driftPct, direction, center, distFromCenter, halfRange, rangeWidth };
}

// ─── Tick Range Calculation ─────────────────────────────────────────────────

/**
 * Calculate a new tick range centered on the current tick.
 * ±rangePct% around current price, rounded to nearest valid tick.
 *
 * price = 1.0001^tick
 * For +X%: newTick = tick + ln(1 + X/100) / ln(1.0001)
 * For -X%: newTick = tick + ln(1 - X/100) / ln(1.0001)
 */
function calculateNewTickRange(currentTick, rangePct) {
  const lnBase = Math.log(1.0001);
  const upperDelta = Math.log(1 + rangePct / 100) / lnBase;
  const lowerDelta = Math.log(1 - rangePct / 100) / lnBase; // negative

  // Round outward: floor for lower, ceil for upper
  const tickLower = Math.floor((currentTick + lowerDelta) / TICK_SPACING) * TICK_SPACING;
  const tickUpper = Math.ceil((currentTick + upperDelta) / TICK_SPACING) * TICK_SPACING;

  if (tickLower >= tickUpper) {
    throw new Error(`Invalid tick range: ${tickLower} >= ${tickUpper}. currentTick=${currentTick}, rangePct=${rangePct}`);
  }

  return { tickLower, tickUpper };
}

// ─── Approval Helpers ───────────────────────────────────────────────────────

/**
 * Ensure ERC20 approved to Permit2, and Permit2 approves PositionManager.
 */
async function ensureApprovals(publicClient, walletClient, account, token, amount, label) {
  if (amount <= 0n) return;

  // Token → Permit2
  const erc20Allowance = await retry(() =>
    publicClient.readContract({
      address: token, abi: ERC20_ABI, functionName: 'allowance',
      args: [account.address, CONTRACTS.PERMIT2],
    })
  );
  if (erc20Allowance < amount) {
    console.log(`   Approving ${label} → Permit2...`);
    const tx = await walletClient.writeContract({
      address: token, abi: ERC20_ABI, functionName: 'approve',
      args: [CONTRACTS.PERMIT2, maxUint256],
    });
    await publicClient.waitForTransactionReceipt({ hash: tx });
    await sleep(500);
  }

  // Permit2 → PositionManager
  const [p2Amount] = await retry(() =>
    publicClient.readContract({
      address: CONTRACTS.PERMIT2, abi: PERMIT2_ABI, functionName: 'allowance',
      args: [account.address, token, CONTRACTS.POSITION_MANAGER],
    })
  );
  if (BigInt(p2Amount) < amount) {
    console.log(`   Approving Permit2 → PositionManager for ${label}...`);
    const maxU160 = (1n << 160n) - 1n;
    const maxU48 = (1n << 48n) - 1n;
    const tx = await walletClient.writeContract({
      address: CONTRACTS.PERMIT2, abi: PERMIT2_ABI, functionName: 'approve',
      args: [token, CONTRACTS.POSITION_MANAGER, maxU160, maxU48],
    });
    await publicClient.waitForTransactionReceipt({ hash: tx });
    await sleep(500);
  }
}

// ─── Receipt Parsing ────────────────────────────────────────────────────────

/**
 * Extract new token ID from a mint TX receipt.
 * Looks for ERC-721 Transfer(from=0x0, to=wallet, tokenId) on PositionManager.
 */
function extractNewTokenId(receipt, walletAddress) {
  const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
  const ZERO_TOPIC = '0x0000000000000000000000000000000000000000000000000000000000000000';
  const walletTopic = '0x' + walletAddress.toLowerCase().replace('0x', '').padStart(64, '0');

  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== CONTRACTS.POSITION_MANAGER.toLowerCase()) continue;
    if (log.topics.length < 4) continue;
    if (log.topics[0] !== TRANSFER_TOPIC) continue;
    if (log.topics[1] !== ZERO_TOPIC) continue;           // from = 0x0 (mint)
    if (log.topics[2].toLowerCase() !== walletTopic) continue; // to = our wallet

    return BigInt(log.topics[3]);
  }
  return null;
}

// ─── Core: Compound Fees (IN RANGE, low drift) ─────────────────────────────

/**
 * Collect accrued fees and re-add them to the existing position.
 * Phase 1: DECREASE(0) + TAKE_PAIR(0x11)  → collect fees to wallet
 * Phase 2: INCREASE + SETTLE_PAIR(0x0d)   → re-add fees to position
 */
async function compoundFees(publicClient, walletClient, account, tokenId, poolKey, sqrtPriceX96, tickLower, tickUpper) {
  // ─── Phase 1: Collect fees ──────────────────────────────────────────────
  console.log('   Phase 1: Collecting accrued fees...');

  const [token0Before, token1Before] = await Promise.all([
    retry(() => publicClient.readContract({ address: poolKey.currency0, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address] })),
    retry(() => publicClient.readContract({ address: poolKey.currency1, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address] })),
  ]);

  // DECREASE_LIQUIDITY(0x01) + TAKE_PAIR(0x11)
  const collectActionsHex = '0x0111';

  const decreaseParams = defaultAbiCoder.encode(
    ['uint256', 'uint256', 'uint128', 'uint128', 'bytes'],
    [tokenId.toString(), '0', '0', '0', '0x']
  );

  const takePairParams = defaultAbiCoder.encode(
    ['address', 'address', 'address'],
    [poolKey.currency0, poolKey.currency1, account.address]
  );

  const collectData = encodeAbiParameters(
    parseAbiParameters('bytes, bytes[]'),
    [collectActionsHex, [decreaseParams, takePairParams]]
  );

  const deadline = BigInt(Math.floor(Date.now() / 1000) + 1800);
  const collectHash = await walletClient.writeContract({
    address: CONTRACTS.POSITION_MANAGER,
    abi: POSITION_MANAGER_ABI,
    functionName: 'modifyLiquidities',
    args: [collectData, deadline],
  });
  const collectReceipt = await publicClient.waitForTransactionReceipt({ hash: collectHash });

  if (collectReceipt.status !== 'success') {
    throw new Error(`Fee collection reverted: ${collectHash}`);
  }
  console.log(`   ✅ Collected — TX: ${collectHash}`);

  await sleep(2000);

  // ─── Measure fees ─────────────────────────────────────────────────────────
  const [token0After, token1After] = await Promise.all([
    retry(() => publicClient.readContract({ address: poolKey.currency0, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address] })),
    retry(() => publicClient.readContract({ address: poolKey.currency1, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address] })),
  ]);

  const fees0 = token0After > token0Before ? token0After - token0Before : 0n;
  const fees1 = token1After > token1Before ? token1After - token1Before : 0n;

  console.log(`   Fees: ${formatEther(fees0)} WETH + ${formatEther(fees1)} AXIOM`);

  if (fees0 <= 0n && fees1 <= 0n) {
    return { compounded: false, fees0: 0n, fees1: 0n };
  }

  // ─── Phase 2: Re-add fees via INCREASE + SETTLE_PAIR ────────────────────
  console.log('   Phase 2: Re-adding fees to position...');

  const sqrtPriceLower = tickToSqrtPriceX96(tickLower);
  const sqrtPriceUpper = tickToSqrtPriceX96(tickUpper);
  const addLiquidity = getLiquidityForAmounts(sqrtPriceX96, sqrtPriceLower, sqrtPriceUpper, fees0, fees1);

  if (addLiquidity <= 0n) {
    console.log('   Fees too small to compound (zero liquidity). Skipping.');
    return { compounded: false, fees0, fees1 };
  }

  await ensureApprovals(publicClient, walletClient, account, poolKey.currency0, fees0, 'WETH');
  await ensureApprovals(publicClient, walletClient, account, poolKey.currency1, fees1, 'AXIOM');
  await sleep(1000);

  // INCREASE_LIQUIDITY(0x00) + SETTLE_PAIR(0x0d)
  const addActionsHex = '0x000d';
  const slipMul = BigInt(100 + argv.slippage);
  const amount0Max = fees0 > 0n ? (fees0 * slipMul) / 100n : 0n;
  const amount1Max = fees1 > 0n ? (fees1 * slipMul) / 100n : 0n;

  const increaseParams = defaultAbiCoder.encode(
    ['uint256', 'uint256', 'uint128', 'uint128', 'bytes'],
    [tokenId.toString(), addLiquidity.toString(), amount0Max.toString(), amount1Max.toString(), '0x']
  );

  const settleParams = defaultAbiCoder.encode(
    ['address', 'address'],
    [poolKey.currency0, poolKey.currency1]
  );

  const addData = encodeAbiParameters(
    parseAbiParameters('bytes, bytes[]'),
    [addActionsHex, [increaseParams, settleParams]]
  );

  const addHash = await walletClient.writeContract({
    address: CONTRACTS.POSITION_MANAGER,
    abi: POSITION_MANAGER_ABI,
    functionName: 'modifyLiquidities',
    args: [addData, deadline],
  });
  const addReceipt = await publicClient.waitForTransactionReceipt({ hash: addHash });

  if (addReceipt.status !== 'success') {
    throw new Error(`Compound (increase) reverted: ${addHash}`);
  }
  console.log(`   ✅ Compounded — TX: ${addHash}`);

  return { compounded: true, fees0, fees1, addHash, collectHash };
}

// ─── Core: Atomic Rebalance (single TX) ─────────────────────────────────────

/**
 * Atomic rebalance via V4 flash accounting — ONE transaction.
 *
 * Pattern: DECREASE_LIQUIDITY + MINT_POSITION + CLOSE_CURRENCY + CLOSE_CURRENCY
 *
 * The DECREASE creates positive deltas (tokens owed to us).
 * The MINT creates negative deltas (tokens we owe to the pool).
 * Flash accounting nets them. CLOSE_CURRENCY per token handles whatever
 * direction the net delta ends up (settle if we owe, take if pool owes).
 *
 * This is the pattern recommended by the official Uniswap V4 docs for
 * rebalancing: https://docs.uniswap.org/contracts/v4/guides/position-manager
 *
 * Why not BURN + MINT? BURN destroys the NFT and the old position must
 * have zero liquidity. DECREASE is more flexible — it removes liquidity
 * while keeping the NFT alive (we don't care about the empty NFT).
 */
async function atomicRebalance(publicClient, walletClient, account, tokenId, poolKey, liquidity, sqrtPriceX96, newTickLower, newTickUpper) {
  console.log(`   Atomic rebalance: close #${tokenId} → new position at ${newTickLower}→${newTickUpper}`);

  // ─── Estimate amounts for approval sizing ─────────────────────────────────
  // We need to approve enough for the SETTLE side of the mint.
  // In the worst case, the net delta is fully negative (mint needs more than
  // decrease provides). Estimate the mint's token needs from current balances
  // plus the tokens that will come out of the decrease.

  const sqrtPriceLower = tickToSqrtPriceX96(newTickLower);
  const sqrtPriceUpper = tickToSqrtPriceX96(newTickUpper);

  // Estimate what we'll get back from the decrease
  const oldSqrtLower = tickToSqrtPriceX96(toInt24(Number((BigInt(0) >> 32n) & 0xFFFFFFn)) || newTickLower); // not needed, we use actual
  const { amount0: estOut0, amount1: estOut1 } = getAmountsFromLiquidity(
    liquidity, sqrtPriceX96,
    tickToSqrtPriceX96(newTickLower - 5000), // use wide range for conservative estimate
    tickToSqrtPriceX96(newTickUpper + 5000)
  );

  // For approvals: approve generous amounts (actual wallet balance + expected returns)
  const [walletWeth, walletAxiom] = await Promise.all([
    retry(() => publicClient.readContract({ address: poolKey.currency0, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address] })),
    retry(() => publicClient.readContract({ address: poolKey.currency1, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address] })),
  ]);

  // Approve max — these are Permit2 allowances, cheap to set once
  await ensureApprovals(publicClient, walletClient, account, poolKey.currency0, walletWeth + estOut0 + 10n ** 18n, 'WETH');
  await ensureApprovals(publicClient, walletClient, account, poolKey.currency1, walletAxiom + estOut1 + 10n ** 18n, 'AXIOM');
  await sleep(1000);

  // ─── Calculate new position liquidity ──────────────────────────────────────
  // Estimate: tokens from old position → new position
  // Read actual old tick range for amount estimation
  const [, posInfo] = await retry(() =>
    publicClient.readContract({
      address: CONTRACTS.POSITION_MANAGER, abi: POSITION_MANAGER_ABI,
      functionName: 'getPoolAndPositionInfo', args: [BigInt(tokenId)],
    })
  );
  const posInfoBN = BigInt(posInfo);
  const rawA = toInt24(Number((posInfoBN >> 32n) & 0xFFFFFFn));
  const rawB = toInt24(Number((posInfoBN >> 8n) & 0xFFFFFFn));
  const oldTickLower = Math.min(rawA, rawB);
  const oldTickUpper = Math.max(rawA, rawB);

  const { amount0: expectedOut0, amount1: expectedOut1 } = getAmountsFromLiquidity(
    liquidity, sqrtPriceX96,
    tickToSqrtPriceX96(oldTickLower),
    tickToSqrtPriceX96(oldTickUpper)
  );

  // Add any wallet dust to what we'll use for the new position
  const totalAmount0 = expectedOut0 + walletWeth;
  const totalAmount1 = expectedOut1 + walletAxiom;

  const newLiquidity = getLiquidityForAmounts(sqrtPriceX96, sqrtPriceLower, sqrtPriceUpper, totalAmount0, totalAmount1);
  if (newLiquidity <= 0n) {
    throw new Error(`Zero liquidity for new position. amounts: ${totalAmount0}/${totalAmount1}, range: ${newTickLower}-${newTickUpper}`);
  }

  console.log(`   Expected from decrease: ~${formatEther(expectedOut0)} WETH + ~${formatEther(expectedOut1)} AXIOM`);
  console.log(`   Wallet dust: ${formatEther(walletWeth)} WETH + ${formatEther(walletAxiom)} AXIOM`);
  console.log(`   New liquidity: ${newLiquidity}`);

  // ─── Build the atomic 4-action call ────────────────────────────────────────
  // DECREASE_LIQUIDITY(0x01) + MINT_POSITION(0x02) + CLOSE_CURRENCY(0x12) + CLOSE_CURRENCY(0x12)
  //
  // Flash accounting flow:
  //   1. DECREASE removes all liquidity → positive deltas (pool owes us token0 + token1)
  //   2. MINT creates new position → negative deltas (we owe pool token0 + token1)
  //   3. Net deltas are computed. CLOSE_CURRENCY for each token handles:
  //      - If net positive: takes tokens out to our wallet
  //      - If net negative: settles tokens from our wallet into pool
  //   This is ONE transaction with ONE approval check.

  const actionsHex = '0x' +
    Actions.DECREASE_LIQUIDITY.toString(16).padStart(2, '0') +
    Actions.MINT_POSITION.toString(16).padStart(2, '0') +
    Actions.CLOSE_CURRENCY.toString(16).padStart(2, '0') +
    Actions.CLOSE_CURRENCY.toString(16).padStart(2, '0');
  // = '0x01021212'

  // Param 0: DECREASE_LIQUIDITY — remove ALL liquidity from old position
  const decreaseParams = defaultAbiCoder.encode(
    ['uint256', 'uint256', 'uint128', 'uint128', 'bytes'],
    [tokenId.toString(), liquidity.toString(), '0', '0', '0x']
  );

  // Param 1: MINT_POSITION — new position at new range
  const slipMul = BigInt(100 + argv.slippage);
  const amount0Max = (totalAmount0 * slipMul) / 100n;
  const amount1Max = (totalAmount1 * slipMul) / 100n;

  const mintParams = defaultAbiCoder.encode(
    [
      'tuple(address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks)',
      'int24',    // tickLower
      'int24',    // tickUpper
      'uint256',  // liquidity
      'uint128',  // amount0Max
      'uint128',  // amount1Max
      'address',  // owner
      'bytes',    // hookData
    ],
    [
      {
        currency0: poolKey.currency0,
        currency1: poolKey.currency1,
        fee: poolKey.fee,
        tickSpacing: poolKey.tickSpacing,
        hooks: poolKey.hooks,
      },
      newTickLower,
      newTickUpper,
      newLiquidity.toString(),
      amount0Max.toString(),
      amount1Max.toString(),
      account.address,
      '0x',
    ]
  );

  // Param 2: CLOSE_CURRENCY for currency0 (WETH)
  const closeCurrency0Params = defaultAbiCoder.encode(
    ['address'],
    [poolKey.currency0]
  );

  // Param 3: CLOSE_CURRENCY for currency1 (AXIOM)
  const closeCurrency1Params = defaultAbiCoder.encode(
    ['address'],
    [poolKey.currency1]
  );

  const callData = encodeAbiParameters(
    parseAbiParameters('bytes, bytes[]'),
    [actionsHex, [decreaseParams, mintParams, closeCurrency0Params, closeCurrency1Params]]
  );

  const deadline = BigInt(Math.floor(Date.now() / 1000) + 1800);

  console.log(`   Sending atomic rebalance TX...`);
  const hash = await walletClient.writeContract({
    address: CONTRACTS.POSITION_MANAGER,
    abi: POSITION_MANAGER_ABI,
    functionName: 'modifyLiquidities',
    args: [callData, deadline],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });

  if (receipt.status !== 'success') {
    throw new Error(`Atomic rebalance reverted: ${hash}`);
  }

  // Extract new token ID from receipt
  const newTokenId = extractNewTokenId(receipt, account.address);
  if (!newTokenId) {
    throw new Error(`Rebalance TX succeeded but couldn't find new token ID in receipt: ${hash}`);
  }

  console.log(`   ✅ Atomic rebalance TX: ${hash}`);
  return { hash, receipt, newTokenId, newLiquidity };
}

// ─── Fallback: Two-TX Rebalance ─────────────────────────────────────────────

/**
 * Fallback rebalance if atomic fails. Two separate TXs:
 *   TX1: DECREASE_LIQUIDITY(full) + TAKE_PAIR(0x11) → tokens to wallet
 *   TX2: MINT_POSITION + SETTLE_PAIR(0x0d) → tokens into new position
 */
async function twoTxRebalance(publicClient, walletClient, account, tokenId, poolKey, liquidity, sqrtPriceX96, poolIdHash, newTickLower, newTickUpper) {
  console.log('   [Fallback] Two-TX rebalance...');

  // ─── TX 1: Close old position ──────────────────────────────────────────
  console.log('   TX 1/2: Removing all liquidity...');

  const [wethBefore, axiomBefore] = await Promise.all([
    retry(() => publicClient.readContract({ address: CONTRACTS.WETH, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address] })),
    retry(() => publicClient.readContract({ address: CONTRACTS.AXIOM, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address] })),
  ]);

  // DECREASE_LIQUIDITY(0x01) + TAKE_PAIR(0x11)
  const closeActionsHex = '0x0111';

  const decreaseParams = defaultAbiCoder.encode(
    ['uint256', 'uint256', 'uint128', 'uint128', 'bytes'],
    [tokenId.toString(), liquidity.toString(), '0', '0', '0x']
  );

  const takePairParams = defaultAbiCoder.encode(
    ['address', 'address', 'address'],
    [poolKey.currency0, poolKey.currency1, account.address]
  );

  const closeData = encodeAbiParameters(
    parseAbiParameters('bytes, bytes[]'),
    [closeActionsHex, [decreaseParams, takePairParams]]
  );

  const deadline = BigInt(Math.floor(Date.now() / 1000) + 1800);
  const closeHash = await walletClient.writeContract({
    address: CONTRACTS.POSITION_MANAGER,
    abi: POSITION_MANAGER_ABI,
    functionName: 'modifyLiquidities',
    args: [closeData, deadline],
  });
  const closeReceipt = await publicClient.waitForTransactionReceipt({ hash: closeHash });

  if (closeReceipt.status !== 'success') {
    throw new Error(`Close position reverted: ${closeHash}`);
  }
  console.log(`   ✅ Closed — TX: ${closeHash}`);

  await sleep(3000);

  // ─── Measure recovered tokens ──────────────────────────────────────────
  const [wethAfter, axiomAfter] = await Promise.all([
    retry(() => publicClient.readContract({ address: CONTRACTS.WETH, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address] })),
    retry(() => publicClient.readContract({ address: CONTRACTS.AXIOM, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address] })),
  ]);

  console.log(`   Recovered: ${formatEther(wethAfter - wethBefore)} WETH + ${formatEther(axiomAfter - axiomBefore)} AXIOM`);
  console.log(`   Total available: ${formatEther(wethAfter)} WETH + ${formatEther(axiomAfter)} AXIOM`);

  if (wethAfter <= 0n && axiomAfter <= 0n) {
    throw new Error('No tokens recovered from close');
  }

  // Re-read pool price (may have shifted)
  const [sqrtPriceX96Now, currentTickNow] = await retry(() =>
    publicClient.readContract({
      address: CONTRACTS.STATE_VIEW, abi: STATE_VIEW_ABI,
      functionName: 'getSlot0', args: [poolIdHash],
    })
  );

  // Verify range still contains current tick; recalc if needed
  let finalTickLower = newTickLower;
  let finalTickUpper = newTickUpper;
  if (Number(currentTickNow) < newTickLower || Number(currentTickNow) >= newTickUpper) {
    console.log(`   ⚠️  Price shifted (tick ${currentTickNow}), recalculating range...`);
    const recalc = calculateNewTickRange(Number(currentTickNow), argv.rangePct);
    finalTickLower = recalc.tickLower;
    finalTickUpper = recalc.tickUpper;
    console.log(`   Adjusted: ${finalTickLower} → ${finalTickUpper}`);
  }

  // ─── TX 2: Swap to optimal ratio for new range ────────────────────────
  console.log(`\n   TX 2/3: Swapping to optimal ratio for range ${finalTickLower}→${finalTickUpper}...`);

  const spNow = sqrtPriceX96Now;
  const spL = tickToSqrtPriceX96(finalTickLower);
  const spU = tickToSqrtPriceX96(finalTickUpper);

  // Calculate optimal ratio: how much of total value should be WETH vs AXIOM
  const priceFloat = Math.pow(Number(spNow) / Number(Q96), 2); // AXIOM per WETH
  const L_CALC = 10n ** 30n;
  const a0_units = L_CALC * Q96 * (spU - spNow) / (spNow * spU); // WETH units per liquidity
  const a1_units = L_CALC * (spNow - spL) / Q96; // AXIOM units per liquidity

  const a0InAxiom = Number(a0_units) * priceFloat; // WETH portion valued in AXIOM
  const a1Num = Number(a1_units);
  const optimalWethFraction = a0InAxiom / (a0InAxiom + a1Num);

  // Current value: convert everything to WETH equivalent for comparison
  const totalValueInWeth = Number(wethAfter) + Number(axiomAfter) / priceFloat;
  const targetWeth = BigInt(Math.floor(totalValueInWeth * optimalWethFraction));
  
  console.log(`   Optimal ratio: ${(optimalWethFraction * 100).toFixed(1)}% WETH / ${((1 - optimalWethFraction) * 100).toFixed(1)}% AXIOM`);
  console.log(`   Current: ${formatEther(wethAfter)} WETH + ${formatEther(axiomAfter)} AXIOM`);
  console.log(`   Target WETH: ~${formatEther(targetWeth)}`);

  let totalWeth = wethAfter;
  let totalAxiom = axiomAfter;

  if (wethAfter < targetWeth && axiomAfter > 10n ** 18n) {
    // Need more WETH — swap AXIOM → WETH (zeroForOne = false, since WETH is currency0)
    const wethDeficit = targetWeth - wethAfter;
    // Estimate AXIOM needed (with 5% buffer for price impact)
    const axiomToSwap = BigInt(Math.floor(Number(wethDeficit) * priceFloat * 1.05));
    const swapAmount = axiomToSwap > axiomAfter ? axiomAfter * 90n / 100n : axiomToSwap; // cap at 90% of AXIOM

    console.log(`   Swapping ${formatEther(swapAmount)} AXIOM → WETH...`);

    // Approve AXIOM to Permit2
    const axiomAllowance = await retry(() => publicClient.readContract({ address: CONTRACTS.AXIOM, abi: ERC20_ABI, functionName: 'allowance', args: [account.address, CONTRACTS.PERMIT2] }));
    if (axiomAllowance < swapAmount) {
      const tx = await walletClient.writeContract({ address: CONTRACTS.AXIOM, abi: ERC20_ABI, functionName: 'approve', args: [CONTRACTS.PERMIT2, maxUint256] });
      await publicClient.waitForTransactionReceipt({ hash: tx });
      await sleep(1000);
    }

    // Approve Universal Router on Permit2 for AXIOM
    const [permit2Amt] = await retry(() => publicClient.readContract({ address: CONTRACTS.PERMIT2, abi: PERMIT2_ABI, functionName: 'allowance', args: [account.address, CONTRACTS.AXIOM, CONTRACTS.UNIVERSAL_ROUTER] }));
    if (BigInt(permit2Amt) < swapAmount) {
      const maxU160 = (1n << 160n) - 1n;
      const maxU48 = (1n << 48n) - 1n;
      const tx = await walletClient.writeContract({ address: CONTRACTS.PERMIT2, abi: PERMIT2_ABI, functionName: 'approve', args: [CONTRACTS.AXIOM, CONTRACTS.UNIVERSAL_ROUTER, maxU160, maxU48] });
      await publicClient.waitForTransactionReceipt({ hash: tx });
      await sleep(1000);
    }

    // V4 swap: AXIOM (currency1) → WETH (currency0), zeroForOne = false
    const swapParams = defaultAbiCoder.encode(
      ['tuple(tuple(address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) poolKey, bool zeroForOne, uint128 amountIn, uint128 amountOutMinimum, bytes hookData)'],
      [{
        poolKey: { currency0: poolKey.currency0, currency1: poolKey.currency1, fee: poolKey.fee, tickSpacing: Number(poolKey.tickSpacing), hooks: poolKey.hooks },
        zeroForOne: false,
        amountIn: swapAmount.toString(),
        amountOutMinimum: '0',
        hookData: '0x',
      }]
    );
    const settleSwapParams = defaultAbiCoder.encode(['address', 'uint256'], [CONTRACTS.AXIOM, swapAmount.toString()]);
    const takeSwapParams = defaultAbiCoder.encode(['address', 'uint256'], [CONTRACTS.WETH, '0']);
    const v4SwapInput = defaultAbiCoder.encode(['bytes', 'bytes[]'], ['0x060c0f', [swapParams, settleSwapParams, takeSwapParams]]);
    const swapDeadline = BigInt(Math.floor(Date.now() / 1000) + 1800);

    const swapHash = await walletClient.writeContract({
      address: CONTRACTS.UNIVERSAL_ROUTER,
      abi: [{ type: 'function', name: 'execute', inputs: [{ name: 'commands', type: 'bytes' }, { name: 'inputs', type: 'bytes[]' }, { name: 'deadline', type: 'uint256' }], outputs: [], stateMutability: 'payable' }],
      functionName: 'execute',
      args: ['0x10', [v4SwapInput], swapDeadline],
    });
    const swapReceipt = await publicClient.waitForTransactionReceipt({ hash: swapHash });
    if (swapReceipt.status !== 'success') {
      console.log(`   ⚠️  Swap reverted (${swapHash}), proceeding with unbalanced amounts...`);
    } else {
      console.log(`   ✅ Swap TX: https://basescan.org/tx/${swapHash}`);
    }
    await sleep(2000);

  } else if (wethAfter > targetWeth * 120n / 100n && wethAfter > 10n ** 15n) {
    // Too much WETH — swap WETH → AXIOM (zeroForOne = true)
    const wethExcess = wethAfter - targetWeth;
    const swapAmount = wethExcess * 90n / 100n; // swap 90% of excess

    console.log(`   Swapping ${formatEther(swapAmount)} WETH → AXIOM...`);

    const wethAllowance = await retry(() => publicClient.readContract({ address: CONTRACTS.WETH, abi: ERC20_ABI, functionName: 'allowance', args: [account.address, CONTRACTS.PERMIT2] }));
    if (wethAllowance < swapAmount) {
      const tx = await walletClient.writeContract({ address: CONTRACTS.WETH, abi: ERC20_ABI, functionName: 'approve', args: [CONTRACTS.PERMIT2, maxUint256] });
      await publicClient.waitForTransactionReceipt({ hash: tx });
      await sleep(1000);
    }

    const [permit2Amt] = await retry(() => publicClient.readContract({ address: CONTRACTS.PERMIT2, abi: PERMIT2_ABI, functionName: 'allowance', args: [account.address, CONTRACTS.WETH, CONTRACTS.UNIVERSAL_ROUTER] }));
    if (BigInt(permit2Amt) < swapAmount) {
      const maxU160 = (1n << 160n) - 1n;
      const maxU48 = (1n << 48n) - 1n;
      const tx = await walletClient.writeContract({ address: CONTRACTS.PERMIT2, abi: PERMIT2_ABI, functionName: 'approve', args: [CONTRACTS.WETH, CONTRACTS.UNIVERSAL_ROUTER, maxU160, maxU48] });
      await publicClient.waitForTransactionReceipt({ hash: tx });
      await sleep(1000);
    }

    const swapParams = defaultAbiCoder.encode(
      ['tuple(tuple(address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) poolKey, bool zeroForOne, uint128 amountIn, uint128 amountOutMinimum, bytes hookData)'],
      [{
        poolKey: { currency0: poolKey.currency0, currency1: poolKey.currency1, fee: poolKey.fee, tickSpacing: Number(poolKey.tickSpacing), hooks: poolKey.hooks },
        zeroForOne: true,
        amountIn: swapAmount.toString(),
        amountOutMinimum: '0',
        hookData: '0x',
      }]
    );
    const settleSwapParams = defaultAbiCoder.encode(['address', 'uint256'], [CONTRACTS.WETH, swapAmount.toString()]);
    const takeSwapParams = defaultAbiCoder.encode(['address', 'uint256'], [CONTRACTS.AXIOM, '0']);
    const v4SwapInput = defaultAbiCoder.encode(['bytes', 'bytes[]'], ['0x060c0f', [swapParams, settleSwapParams, takeSwapParams]]);
    const swapDeadline = BigInt(Math.floor(Date.now() / 1000) + 1800);

    const swapHash = await walletClient.writeContract({
      address: CONTRACTS.UNIVERSAL_ROUTER,
      abi: [{ type: 'function', name: 'execute', inputs: [{ name: 'commands', type: 'bytes' }, { name: 'inputs', type: 'bytes[]' }, { name: 'deadline', type: 'uint256' }], outputs: [], stateMutability: 'payable' }],
      functionName: 'execute',
      args: ['0x10', [v4SwapInput], swapDeadline],
    });
    const swapReceipt = await publicClient.waitForTransactionReceipt({ hash: swapHash });
    if (swapReceipt.status !== 'success') {
      console.log(`   ⚠️  Swap reverted (${swapHash}), proceeding with unbalanced amounts...`);
    } else {
      console.log(`   ✅ Swap TX: https://basescan.org/tx/${swapHash}`);
    }
    await sleep(2000);

  } else {
    console.log(`   Ratio is close enough, no swap needed.`);
  }

  // Re-read balances after swap
  [totalWeth, totalAxiom] = await Promise.all([
    retry(() => publicClient.readContract({ address: CONTRACTS.WETH, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address] })),
    retry(() => publicClient.readContract({ address: CONTRACTS.AXIOM, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address] })),
  ]);
  console.log(`   Post-swap: ${formatEther(totalWeth)} WETH + ${formatEther(totalAxiom)} AXIOM`);

  // ─── TX 3: Open new position ───────────────────────────────────────────
  console.log(`\n   TX 3/3: Opening new position at ${finalTickLower}→${finalTickUpper}...`);

  const sqrtPriceLower = tickToSqrtPriceX96(finalTickLower);
  const sqrtPriceUpper = tickToSqrtPriceX96(finalTickUpper);
  const newLiquidity = getLiquidityForAmounts(sqrtPriceX96Now, sqrtPriceLower, sqrtPriceUpper, totalWeth, totalAxiom);

  if (newLiquidity <= 0n) {
    throw new Error(`Zero liquidity. Tokens in wallet. amounts: ${totalWeth}/${totalAxiom}`);
  }

  await ensureApprovals(publicClient, walletClient, account, poolKey.currency0, totalWeth, 'WETH');
  await ensureApprovals(publicClient, walletClient, account, poolKey.currency1, totalAxiom, 'AXIOM');
  await sleep(1000);

  // MINT_POSITION(0x02) + SETTLE_PAIR(0x0d)
  const mintActionsHex = '0x020d';
  const slipMul = BigInt(100 + argv.slippage);

  const mintParams = defaultAbiCoder.encode(
    [
      'tuple(address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks)',
      'int24', 'int24', 'uint256', 'uint128', 'uint128', 'address', 'bytes',
    ],
    [
      { currency0: poolKey.currency0, currency1: poolKey.currency1, fee: poolKey.fee, tickSpacing: poolKey.tickSpacing, hooks: poolKey.hooks },
      finalTickLower, finalTickUpper,
      newLiquidity.toString(),
      ((totalWeth * slipMul) / 100n).toString(),
      ((totalAxiom * slipMul) / 100n).toString(),
      account.address,
      '0x',
    ]
  );

  const settleParams = defaultAbiCoder.encode(
    ['address', 'address'],
    [poolKey.currency0, poolKey.currency1]
  );

  const mintData = encodeAbiParameters(
    parseAbiParameters('bytes, bytes[]'),
    [mintActionsHex, [mintParams, settleParams]]
  );

  const mintHash = await walletClient.writeContract({
    address: CONTRACTS.POSITION_MANAGER,
    abi: POSITION_MANAGER_ABI,
    functionName: 'modifyLiquidities',
    args: [mintData, deadline],
  });
  const mintReceipt = await publicClient.waitForTransactionReceipt({ hash: mintHash });

  if (mintReceipt.status !== 'success') {
    throw new Error(`Mint reverted: ${mintHash}. Tokens in wallet — manual intervention needed.`);
  }

  const newTokenId = extractNewTokenId(mintReceipt, account.address);
  if (!newTokenId) {
    throw new Error(`Mint succeeded but couldn't find token ID: ${mintHash}`);
  }

  console.log(`   ✅ New position #${newTokenId} — TX: ${mintHash}`);
  return { closeHash, mintHash, newTokenId, newLiquidity, finalTickLower, finalTickUpper };
}

// ─── Main Flow ───────────────────────────────────────────────────────────────

async function main() {
  const privateKey = process.env.NET_PRIVATE_KEY || process.env.PRIVATE_KEY;
  if (!privateKey) {
    console.error('❌ No private key in ~/.axiom/wallet.env');
    process.exit(1);
  }

  const account = privateKeyToAccount(privateKey);
  const publicClient = createPublicClient({ chain: base, transport: http(argv.rpc) });
  const walletClient = createWalletClient({ account, chain: base, transport: http(argv.rpc) });

  const tokenId = BigInt(argv.tokenId);
  const rangePct = argv.rangePct;
  const thresholdPct = argv.thresholdPct;

  console.log(`\n🔄 Auto-Rebalance (Preemptive) — Position #${argv.tokenId}`);
  console.log(`   Range: ±${rangePct}% | Threshold: ${thresholdPct}% drift`);
  console.log(`   ${argv.dryRun ? '🔮 DRY RUN' : '⚡ LIVE'}`);
  console.log('═'.repeat(60));
  console.log(`   Time: ${new Date().toISOString()}`);
  console.log(`   Wallet: ${account.address}`);

  // ─── 1. Verify ownership ──────────────────────────────────────────────────
  let owner;
  try {
    owner = await retry(() =>
      publicClient.readContract({
        address: CONTRACTS.POSITION_MANAGER, abi: POSITION_MANAGER_ABI,
        functionName: 'ownerOf', args: [tokenId],
      })
    );
  } catch (err) {
    console.error(`❌ Position #${argv.tokenId} doesn't exist or unreadable: ${err.message}`);
    process.exit(1);
  }

  if (owner.toLowerCase() !== account.address.toLowerCase()) {
    console.error(`❌ Not your position (owner: ${owner})`);
    process.exit(1);
  }

  // ─── 2. Position info ─────────────────────────────────────────────────────
  const [poolKey, posInfo] = await retry(() =>
    publicClient.readContract({
      address: CONTRACTS.POSITION_MANAGER, abi: POSITION_MANAGER_ABI,
      functionName: 'getPoolAndPositionInfo', args: [tokenId],
    })
  );
  await sleep(500);

  const liquidity = await retry(() =>
    publicClient.readContract({
      address: CONTRACTS.POSITION_MANAGER, abi: POSITION_MANAGER_ABI,
      functionName: 'getPositionLiquidity', args: [tokenId],
    })
  );

  if (liquidity === 0n) {
    console.error('❌ Position has zero liquidity — nothing to rebalance');
    process.exit(1);
  }

  // Extract tick range
  const posInfoBN = BigInt(posInfo);
  const rawA = toInt24(Number((posInfoBN >> 32n) & 0xFFFFFFn));
  const rawB = toInt24(Number((posInfoBN >> 8n) & 0xFFFFFFn));
  const tickLower = Math.min(rawA, rawB);
  const tickUpper = Math.max(rawA, rawB);

  // ─── 3. Pool state ────────────────────────────────────────────────────────
  const poolIdHash = getPoolIdHash(poolKey);
  await sleep(500);
  const [sqrtPriceX96, currentTick] = await retry(() =>
    publicClient.readContract({
      address: CONTRACTS.STATE_VIEW, abi: STATE_VIEW_ABI,
      functionName: 'getSlot0', args: [poolIdHash],
    })
  );

  // ─── 4. Drift calculation ─────────────────────────────────────────────────
  const currentTickNum = Number(currentTick);
  const drift = calculateDrift(currentTickNum, tickLower, tickUpper);
  const inRange = currentTickNum >= tickLower && currentTickNum < tickUpper;
  const needsRebalance = drift.driftPct > thresholdPct || !inRange;

  console.log(`\n📊 Position State:`);
  console.log(`   Range: ${tickLower} → ${tickUpper} (width: ${drift.rangeWidth} ticks)`);
  console.log(`   Current tick: ${currentTickNum} (center: ${drift.center.toFixed(0)})`);
  console.log(`   Liquidity: ${liquidity}`);
  console.log(`   Drift: ${drift.driftPct.toFixed(1)}% toward ${drift.direction} edge`);

  if (needsRebalance) {
    if (!inRange) {
      console.log(`   Status: 🔴 OUT OF RANGE — immediate rebalance needed`);
    } else {
      console.log(`   Status: 🟡 DRIFT ${drift.driftPct.toFixed(1)}% > ${thresholdPct}% threshold — preemptive rebalance`);
    }
  } else {
    console.log(`   Status: ✅ CENTERED (${drift.driftPct.toFixed(1)}% drift < ${thresholdPct}% threshold)`);
  }

  // ─── 5. IN RANGE — no action (fees harvested separately by hourly cron) ──
  if (!needsRebalance) {
    console.log(`\nIN_RANGE — drift ${drift.driftPct.toFixed(1)}%, threshold ${thresholdPct}%`);
    console.log(`   Fees are harvested hourly by separate cron. No action needed.`);
    process.exit(0);
  }

  // ─── 6. REBALANCE (preemptive or reactive) ────────────────────────────────
  const { tickLower: newTickLower, tickUpper: newTickUpper } = calculateNewTickRange(currentTickNum, rangePct);

  console.log(`\n📐 New Range (centered on current tick):`);
  console.log(`   ${newTickLower} → ${newTickUpper} (±${rangePct}% around tick ${currentTickNum})`);
  console.log(`   Old center: ${drift.center.toFixed(0)} → New center: ${((newTickLower + newTickUpper) / 2).toFixed(0)}`);

  // Sanity
  if (newTickLower % TICK_SPACING !== 0 || newTickUpper % TICK_SPACING !== 0) {
    console.error(`❌ Tick alignment error: ${newTickLower}/${newTickUpper} not divisible by ${TICK_SPACING}`);
    process.exit(1);
  }

  if (argv.dryRun) {
    console.log(`\n🔮 Dry run: Would rebalance.`);
    console.log(`   Drift: ${drift.driftPct.toFixed(1)}% (threshold: ${thresholdPct}%)`);
    console.log(`   Old range: ${tickLower} → ${tickUpper}`);
    console.log(`   New range: ${newTickLower} → ${newTickUpper}`);

    // Estimate tokens
    const { amount0, amount1 } = getAmountsFromLiquidity(
      liquidity, sqrtPriceX96,
      tickToSqrtPriceX96(tickLower), tickToSqrtPriceX96(tickUpper)
    );
    console.log(`   Est. tokens: ~${formatEther(amount0)} WETH + ~${formatEther(amount1)} AXIOM`);
    console.log(`NEEDS_REBALANCE — drift ${drift.driftPct.toFixed(1)}%, would move ${tickLower}→${tickUpper} to ${newTickLower}→${newTickUpper}`);
    process.exit(0);
  }

  // ─── Use close → swap-to-ratio → mint (maximizes liquidity) ─────────────
  console.log('\n⏳ Rebalancing position (close → swap → mint)...');
  let result;

  try {
    result = await twoTxRebalance(
      publicClient, walletClient, account,
      tokenId, poolKey, liquidity,
      sqrtPriceX96, poolIdHash, newTickLower, newTickUpper
    );

    console.log(`\n${'═'.repeat(60)}`);
    console.log(`✅ REBALANCED — old #${argv.tokenId} → new #${result.newTokenId}, range ${result.finalTickLower}→${result.finalTickUpper}`);
    console.log(`${'═'.repeat(60)}`);
    console.log(`   Method: Close → Swap-to-ratio → Mint (3 TX)`);
    console.log(`   Drift was: ${drift.driftPct.toFixed(1)}% toward ${drift.direction} (threshold: ${thresholdPct}%)`);
    console.log(`   New token ID: ${result.newTokenId}`);
    console.log(`   New liquidity: ${result.newLiquidity}`);
    console.log(`\n🔗 Transactions:`);
    console.log(`   Close: https://basescan.org/tx/${result.closeHash}`);
    if (result.swapHash) console.log(`   Swap:  https://basescan.org/tx/${result.swapHash}`);
    console.log(`   Mint:  https://basescan.org/tx/${result.mintHash}`);

  } catch (err) {
    console.error(`\n❌ Rebalance failed: ${err.message}`);
    console.error(`   ⚠️  Check wallet for tokens. May need manual intervention.`);
    process.exit(1);
  }

  // ─── Send leftover dust ────────────────────────────────────────────────────
  if (argv.harvestAddress) {
    await sleep(2000);
    const [dustWeth, dustAxiom] = await Promise.all([
      retry(() => publicClient.readContract({ address: CONTRACTS.WETH, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address] })),
      retry(() => publicClient.readContract({ address: CONTRACTS.AXIOM, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address] })),
    ]);

    for (const [token, amount, label, minDust] of [
      [CONTRACTS.WETH, dustWeth, 'WETH', 10n ** 14n],
      [CONTRACTS.AXIOM, dustAxiom, 'AXIOM', 10n ** 16n],
    ]) {
      if (amount > minDust) {
        console.log(`   Sending ${formatEther(amount)} ${label} dust → ${argv.harvestAddress}`);
        try {
          const tx = await walletClient.writeContract({
            address: token, abi: ERC20_ABI, functionName: 'transfer',
            args: [argv.harvestAddress, amount],
          });
          await publicClient.waitForTransactionReceipt({ hash: tx });
        } catch (err) {
          console.log(`   ⚠️  Dust transfer failed: ${err.message}`);
        }
      }
    }
  }
}

main().catch((err) => {
  console.error(`\n❌ Fatal: ${err.message}`);
  if (err.stack) console.error(err.stack);
  process.exit(1);
});
