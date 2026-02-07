#!/usr/bin/env node
/**
 * Auto-Rebalance V4 LP Position
 *
 * Designed to run on cron every 15-30 minutes. Idempotent and safe.
 *
 * Behavior:
 *   1. Reads current position state (token ID, tick range, liquidity)
 *   2. Gets current pool tick from slot0
 *   3. If IN RANGE  → compound accrued fees, print "IN_RANGE — compounded fees"
 *   4. If OUT OF RANGE →
 *      a. Close old position (DECREASE_LIQUIDITY to 0 + CLOSE_CURRENCY)
 *      b. Calculate new tick range: ±rangePct% around current price
 *      c. Open new position with ALL recovered tokens (MINT + SETTLE_PAIR)
 *      d. Print "REBALANCED — old #X → new #Y, range tickLower→tickUpper"
 *
 * Usage:
 *   # Dry-run check
 *   node auto-rebalance.mjs --token-id 1396852 --dry-run
 *
 *   # Execute rebalance (default ±20% range)
 *   node auto-rebalance.mjs --token-id 1396852
 *
 *   # Custom range ±30%
 *   node auto-rebalance.mjs --token-id 1396852 --range-pct 30
 *
 *   # With harvest address for leftover dust
 *   node auto-rebalance.mjs --token-id 1396852 --harvest-address 0x...
 *
 * Critical V4 patterns (proven working):
 *   - Mint:     MINT(0x02) + SETTLE_PAIR(0x0d) — 2 actions, tokens going IN
 *   - Increase: INCREASE(0x00) + SETTLE_PAIR(0x0d) — 2 actions, tokens going IN
 *   - Close:    DECREASE_LIQUIDITY(0x01) + CLOSE_CURRENCY(0x11) — 2 actions, tokens coming OUT
 *   - NEVER use 3-action patterns (causes SliceOutOfBounds)
 *   - Approve Permit2, NOT PositionManager directly
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
    description: 'Range percentage (±%) around current price',
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
  UNIVERSAL_ROUTER: '0x6ff5693b99212da76ad316178a184ab56d299b43',
  WETH: '0x4200000000000000000000000000000000000006',
  AXIOM: '0xf3Ce5dDAAb6C133F9875a4a46C55cf0b58111B07',
};

// V4 pool key (WETH/AXIOM on Base)
const POOL_KEY = {
  currency0: '0x4200000000000000000000000000000000000006',  // WETH
  currency1: '0xf3ce5ddaab6c133f9875a4a46c55cf0b58111b07',  // AXIOM
  fee: 0,
  tickSpacing: 200,
  hooks: '0xb429d62f8f3bffb98cdb9569533ea23bf0ba28cc',
};

const POOL_KEY_STRUCT = '(address,address,uint24,int24,address)';
const Q96 = 2n ** 96n;
const TICK_SPACING = 200;

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
  { name: 'decimals', type: 'function', inputs: [], outputs: [{ type: 'uint8' }] },
  { name: 'symbol', type: 'function', inputs: [], outputs: [{ type: 'string' }] },
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
const pad32 = (hex) => hex.replace('0x', '').padStart(64, '0');

function toInt24(v) {
  return v >= 0x800000 ? v - 0x1000000 : v;
}

function tickToSqrtPriceX96(tick) {
  return BigInt(Math.floor(Math.sqrt(Math.pow(1.0001, tick)) * Number(Q96)));
}

/**
 * Calculate liquidity from token amounts and price range.
 */
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
 * Retry with exponential backoff for rate-limited RPC calls.
 */
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

/**
 * Compute the pool ID hash from the pool key struct.
 */
function getPoolIdHash(poolKey) {
  const poolId = defaultAbiCoder.encode(
    [POOL_KEY_STRUCT],
    [[poolKey.currency0, poolKey.currency1, poolKey.fee, poolKey.tickSpacing, poolKey.hooks]]
  );
  return keccak256(poolId);
}

/**
 * Calculate a new tick range centered on the current tick.
 * ±rangePct% around current price, rounded to nearest valid tick (tickSpacing=200).
 */
function calculateNewTickRange(currentTick, rangePct) {
  // Price = 1.0001^tick, so ±X% means tick ± log(1 ± X/100) / log(1.0001)
  // For +20%: tickDelta = ln(1.20) / ln(1.0001) ≈ 1823
  // For -20%: tickDelta = ln(0.80) / ln(1.0001) ≈ -2231
  // We use symmetric tick delta for simplicity: average of the two absolute values
  const upperDelta = Math.log(1 + rangePct / 100) / Math.log(1.0001);
  const lowerDelta = -Math.log(1 - rangePct / 100) / Math.log(1.0001);

  // Round to nearest tick spacing
  const tickLower = Math.floor((currentTick - lowerDelta) / TICK_SPACING) * TICK_SPACING;
  const tickUpper = Math.ceil((currentTick + upperDelta) / TICK_SPACING) * TICK_SPACING;

  // Sanity: ensure they're not equal
  if (tickLower >= tickUpper) {
    throw new Error(`Invalid tick range: ${tickLower} >= ${tickUpper}. Current tick: ${currentTick}`);
  }

  return { tickLower, tickUpper };
}

/**
 * Ensure ERC20 token is approved to Permit2 and Permit2 approves PositionManager.
 */
async function ensureApprovals(publicClient, walletClient, account, token, amount, label) {
  if (amount <= 0n) return;

  // Step 1: Token → Permit2 approval
  const erc20Allowance = await retry(() =>
    publicClient.readContract({
      address: token,
      abi: ERC20_ABI,
      functionName: 'allowance',
      args: [account.address, CONTRACTS.PERMIT2],
    })
  );
  if (erc20Allowance < amount) {
    console.log(`   Approving ${label} → Permit2...`);
    const tx = await walletClient.writeContract({
      address: token,
      abi: ERC20_ABI,
      functionName: 'approve',
      args: [CONTRACTS.PERMIT2, maxUint256],
    });
    await publicClient.waitForTransactionReceipt({ hash: tx });
    await sleep(500);
  }

  // Step 2: Permit2 → PositionManager approval
  const [p2Amount] = await retry(() =>
    publicClient.readContract({
      address: CONTRACTS.PERMIT2,
      abi: PERMIT2_ABI,
      functionName: 'allowance',
      args: [account.address, token, CONTRACTS.POSITION_MANAGER],
    })
  );
  if (BigInt(p2Amount) < amount) {
    console.log(`   Approving Permit2 → PositionManager for ${label}...`);
    const maxU160 = (1n << 160n) - 1n;
    const maxU48 = (1n << 48n) - 1n;
    const tx = await walletClient.writeContract({
      address: CONTRACTS.PERMIT2,
      abi: PERMIT2_ABI,
      functionName: 'approve',
      args: [token, CONTRACTS.POSITION_MANAGER, maxU160, maxU48],
    });
    await publicClient.waitForTransactionReceipt({ hash: tx });
    await sleep(500);
  }
}

/**
 * Extract new token ID from a mint transaction receipt.
 * Looks for ERC-721 Transfer events from address(0) → our address on PositionManager.
 */
function extractNewTokenId(receipt, walletAddress) {
  // ERC-721 Transfer event: Transfer(address indexed from, address indexed to, uint256 indexed tokenId)
  const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
  const ZERO_ADDRESS_TOPIC = '0x0000000000000000000000000000000000000000000000000000000000000000';
  const walletTopic = '0x' + walletAddress.toLowerCase().replace('0x', '').padStart(64, '0');

  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== CONTRACTS.POSITION_MANAGER.toLowerCase()) continue;
    if (log.topics.length < 4) continue;
    if (log.topics[0] !== TRANSFER_TOPIC) continue;
    if (log.topics[1] !== ZERO_ADDRESS_TOPIC) continue; // from = 0x0 (mint)
    if (log.topics[2].toLowerCase() !== walletTopic) continue; // to = our wallet

    // topic[3] is the tokenId (indexed uint256)
    const newTokenId = BigInt(log.topics[3]);
    return newTokenId;
  }

  return null;
}

// ─── Core: Collect & Compound Fees (IN RANGE) ───────────────────────────────

/**
 * Collect accrued fees and re-add them to the existing position.
 * Uses DECREASE(0, fees only) + CLOSE_CURRENCY to collect,
 * then INCREASE + SETTLE_PAIR to re-add.
 */
async function compoundFees(publicClient, walletClient, account, tokenId, poolKey, sqrtPriceX96, tickLower, tickUpper) {
  // ─── Phase 1: Collect fees via DECREASE(0) + CLOSE_CURRENCY ─────────────
  console.log('   Phase 1: Collecting accrued fees...');

  const [token0Before, token1Before] = await Promise.all([
    retry(() => publicClient.readContract({ address: poolKey.currency0, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address] })),
    retry(() => publicClient.readContract({ address: poolKey.currency1, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address] })),
  ]);

  const collectActionsHex = '0x0111'; // DECREASE_LIQUIDITY(0x01) + CLOSE_CURRENCY(0x11)

  const decreaseParams = '0x' +
    pad32('0x' + tokenId.toString(16)) +
    '0'.padStart(64, '0') +    // liquidity = 0 (fees only)
    '0'.padStart(64, '0') +    // amount0Min = 0
    '0'.padStart(64, '0') +    // amount1Min = 0
    (5 * 32).toString(16).padStart(64, '0') +
    '0'.padStart(64, '0');     // hookData = empty

  const closeParams = '0x' +
    pad32(poolKey.currency0) +
    pad32(poolKey.currency1) +
    pad32(account.address);

  const collectData = encodeAbiParameters(
    parseAbiParameters('bytes, bytes[]'),
    [collectActionsHex, [decreaseParams, closeParams]]
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

  const fees0 = token0After - token0Before;
  const fees1 = token1After - token1Before;

  console.log(`   Fees: ${formatEther(fees0)} WETH + ${formatEther(fees1)} AXIOM`);

  if (fees0 <= 0n && fees1 <= 0n) {
    console.log('   No fees accrued — nothing to compound.');
    return { compounded: false, fees0: 0n, fees1: 0n };
  }

  // ─── Phase 2: Re-add fees via INCREASE + SETTLE_PAIR ────────────────────
  console.log('   Phase 2: Re-adding fees to position...');

  const sqrtPriceLower = tickToSqrtPriceX96(tickLower);
  const sqrtPriceUpper = tickToSqrtPriceX96(tickUpper);
  const addLiquidity = getLiquidityForAmounts(sqrtPriceX96, sqrtPriceLower, sqrtPriceUpper, fees0 > 0n ? fees0 : 0n, fees1 > 0n ? fees1 : 0n);

  if (addLiquidity <= 0n) {
    console.log('   Computed liquidity is zero — fees too small to compound.');
    return { compounded: false, fees0, fees1 };
  }

  // Ensure approvals for the fee amounts
  await ensureApprovals(publicClient, walletClient, account, poolKey.currency0, fees0 > 0n ? fees0 : 0n, 'WETH');
  await ensureApprovals(publicClient, walletClient, account, poolKey.currency1, fees1 > 0n ? fees1 : 0n, 'AXIOM');

  await sleep(1000);

  // INCREASE(0x00) + SETTLE_PAIR(0x0d) — 2 actions
  const addActionsHex = '0x000d';
  const slippageMul = BigInt(100 + argv.slippage);
  const amount0Max = fees0 > 0n ? (fees0 * slippageMul) / 100n : 0n;
  const amount1Max = fees1 > 0n ? (fees1 * slippageMul) / 100n : 0n;

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

// ─── Core: Close Position ────────────────────────────────────────────────────

/**
 * Close a position entirely: DECREASE_LIQUIDITY(full) + CLOSE_CURRENCY.
 * Returns all tokens to wallet.
 */
async function closePosition(publicClient, walletClient, account, tokenId, poolKey, liquidity) {
  console.log(`   Closing position #${tokenId} (liquidity: ${liquidity})...`);

  // DECREASE_LIQUIDITY(0x01) + CLOSE_CURRENCY(0x11) — 2 actions
  const closeActionsHex = '0x0111';

  const decreaseParams = '0x' +
    pad32('0x' + tokenId.toString(16)) +
    pad32('0x' + liquidity.toString(16)) + // full liquidity
    '0'.padStart(64, '0') +                // amount0Min = 0
    '0'.padStart(64, '0') +                // amount1Min = 0
    (5 * 32).toString(16).padStart(64, '0') +
    '0'.padStart(64, '0');                 // hookData = empty

  const closeParams = '0x' +
    pad32(poolKey.currency0) +
    pad32(poolKey.currency1) +
    pad32(account.address);

  const closeData = encodeAbiParameters(
    parseAbiParameters('bytes, bytes[]'),
    [closeActionsHex, [decreaseParams, closeParams]]
  );

  const deadline = BigInt(Math.floor(Date.now() / 1000) + 1800);
  const hash = await walletClient.writeContract({
    address: CONTRACTS.POSITION_MANAGER,
    abi: POSITION_MANAGER_ABI,
    functionName: 'modifyLiquidities',
    args: [closeData, deadline],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });

  if (receipt.status !== 'success') {
    throw new Error(`Close position reverted: ${hash}`);
  }

  console.log(`   ✅ Position closed — TX: ${hash}`);
  return { hash, receipt };
}

// ─── Core: Open New Position ─────────────────────────────────────────────────

/**
 * Open a new position: MINT(0x02) + SETTLE_PAIR(0x0d) — 2 actions.
 * Returns the new token ID extracted from the receipt.
 */
async function openNewPosition(publicClient, walletClient, account, poolKey, tickLower, tickUpper, amount0, amount1, sqrtPriceX96) {
  console.log(`   Opening new position at range ${tickLower} → ${tickUpper}...`);
  console.log(`   Tokens: ${formatEther(amount0)} WETH + ${formatEther(amount1)} AXIOM`);

  // Calculate liquidity
  const sqrtPriceLower = tickToSqrtPriceX96(tickLower);
  const sqrtPriceUpper = tickToSqrtPriceX96(tickUpper);
  const newLiquidity = getLiquidityForAmounts(sqrtPriceX96, sqrtPriceLower, sqrtPriceUpper, amount0, amount1);

  if (newLiquidity <= 0n) {
    throw new Error(`Zero liquidity computed. amount0=${amount0}, amount1=${amount1}, tickL=${tickLower}, tickU=${tickUpper}`);
  }
  console.log(`   Liquidity: ${newLiquidity}`);

  // Ensure approvals
  await ensureApprovals(publicClient, walletClient, account, poolKey.currency0, amount0, 'WETH');
  await ensureApprovals(publicClient, walletClient, account, poolKey.currency1, amount1, 'AXIOM');

  await sleep(1000);

  // MINT(0x02) + SETTLE_PAIR(0x0d) — 2 actions
  const mintActionsHex = '0x020d';
  const slippageMul = BigInt(100 + argv.slippage);
  const amount0Max = (amount0 * slippageMul) / 100n;
  const amount1Max = (amount1 * slippageMul) / 100n;

  // MINT params: (PoolKey, tickLower, tickUpper, liquidity, amount0Max, amount1Max, owner, hookData)
  // Encoded as: poolKey struct fields + tickLower + tickUpper + liquidity + amount0Max + amount1Max + owner + hookData
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
      tickLower,
      tickUpper,
      newLiquidity.toString(),
      amount0Max.toString(),
      amount1Max.toString(),
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

  const deadline = BigInt(Math.floor(Date.now() / 1000) + 1800);
  const hash = await walletClient.writeContract({
    address: CONTRACTS.POSITION_MANAGER,
    abi: POSITION_MANAGER_ABI,
    functionName: 'modifyLiquidities',
    args: [mintData, deadline],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });

  if (receipt.status !== 'success') {
    throw new Error(`Mint new position reverted: ${hash}`);
  }

  // CRITICAL: Extract new token ID from Transfer event in receipt
  const newTokenId = extractNewTokenId(receipt, account.address);
  if (!newTokenId) {
    throw new Error(`Could not find new token ID in TX receipt: ${hash}. Check logs manually.`);
  }

  console.log(`   ✅ New position #${newTokenId} — TX: ${hash}`);
  return { hash, receipt, newTokenId, newLiquidity };
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

  console.log(`\n🔄 Auto-Rebalance — Position #${argv.tokenId}`);
  console.log(`   Range: ±${rangePct}%`);
  console.log(`   ${argv.dryRun ? '🔮 DRY RUN' : '⚡ LIVE'}`);
  console.log('═'.repeat(60));
  console.log(`   Time: ${new Date().toISOString()}`);
  console.log(`   Wallet: ${account.address}`);

  // ─── 1. Verify ownership ──────────────────────────────────────────────────
  let owner;
  try {
    owner = await retry(() =>
      publicClient.readContract({
        address: CONTRACTS.POSITION_MANAGER,
        abi: POSITION_MANAGER_ABI,
        functionName: 'ownerOf',
        args: [tokenId],
      })
    );
  } catch (err) {
    console.error(`❌ Position #${argv.tokenId} does not exist or cannot be read: ${err.message}`);
    process.exit(1);
  }

  if (owner.toLowerCase() !== account.address.toLowerCase()) {
    console.error(`❌ Not your position (owner: ${owner})`);
    process.exit(1);
  }

  // ─── 2. Position info ─────────────────────────────────────────────────────
  const [poolKey, posInfo] = await retry(() =>
    publicClient.readContract({
      address: CONTRACTS.POSITION_MANAGER,
      abi: POSITION_MANAGER_ABI,
      functionName: 'getPoolAndPositionInfo',
      args: [tokenId],
    })
  );
  await sleep(500);

  const liquidity = await retry(() =>
    publicClient.readContract({
      address: CONTRACTS.POSITION_MANAGER,
      abi: POSITION_MANAGER_ABI,
      functionName: 'getPositionLiquidity',
      args: [tokenId],
    })
  );

  if (liquidity === 0n) {
    console.error('❌ Position has zero liquidity — nothing to rebalance');
    process.exit(1);
  }

  // Extract tick range from posInfo
  const posInfoBN = BigInt(posInfo);
  const rawA = toInt24(Number((posInfoBN >> 32n) & 0xFFFFFFn));
  const rawB = toInt24(Number((posInfoBN >> 8n) & 0xFFFFFFn));
  const tickLower = Math.min(rawA, rawB);
  const tickUpper = Math.max(rawA, rawB);

  // ─── 3. Pool state (current tick) ─────────────────────────────────────────
  const poolIdHash = getPoolIdHash(poolKey);
  await sleep(500);
  const [sqrtPriceX96, currentTick] = await retry(() =>
    publicClient.readContract({
      address: CONTRACTS.STATE_VIEW,
      abi: STATE_VIEW_ABI,
      functionName: 'getSlot0',
      args: [poolIdHash],
    })
  );

  const inRange = currentTick >= tickLower && currentTick < tickUpper;

  // Calculate how far price has drifted toward either edge (0% = center, 100% = edge)
  const tl = Number(tickLower);
  const tu = Number(tickUpper);
  const ct = Number(currentTick);
  const totalRange = tu - tl;
  const centerTick = tl + Math.floor(totalRange / 2);
  const distFromCenter = Math.abs(ct - centerTick);
  const halfRange = Math.floor(totalRange / 2);
  const driftPct = halfRange > 0 ? Math.round((distFromCenter / halfRange) * 100) : 0;
  const REBALANCE_THRESHOLD = 75; // Rebalance when 75%+ of range consumed

  const needsPreemptiveRebalance = inRange && driftPct >= REBALANCE_THRESHOLD;
  const needsRebalance = !inRange || needsPreemptiveRebalance;

  console.log(`\n📊 Position State:`);
  console.log(`   Range: ${tickLower} → ${tickUpper}`);
  console.log(`   Current tick: ${currentTick}`);
  console.log(`   Center tick: ${centerTick}`);
  console.log(`   Drift: ${driftPct}% toward edge (threshold: ${REBALANCE_THRESHOLD}%)`);
  console.log(`   Liquidity: ${liquidity}`);
  console.log(`   Status: ${!inRange ? '🔴 OUT OF RANGE' : needsPreemptiveRebalance ? '🟡 DRIFTING — preemptive rebalance' : '✅ IN RANGE'}`);

  // ─── 4. IN RANGE & CENTERED: Compound fees ───────────────────────────────
  if (!needsRebalance) {
    if (argv.dryRun) {
      console.log('\n🔮 Dry run: Would compound accrued fees (position is in range).');
      console.log('IN_RANGE — centered, dry run, no action');
      process.exit(0);
    }

    console.log('\n⏳ Position is centered — compounding fees...');
    try {
      const result = await compoundFees(
        publicClient, walletClient, account, tokenId, poolKey,
        sqrtPriceX96, tickLower, tickUpper
      );
      if (result.compounded) {
        console.log(`\nIN_RANGE — compounded fees (${formatEther(result.fees0)} WETH + ${formatEther(result.fees1)} AXIOM)`);
      } else {
        console.log('\nIN_RANGE — no fees to compound');
      }
    } catch (err) {
      console.error(`\n❌ Compound failed: ${err.message}`);
      process.exit(1);
    }
    process.exit(0);
  }

  // ─── 5. REBALANCE (out of range OR preemptive drift) ────────────────────
  const { tickLower: newTickLower, tickUpper: newTickUpper } = calculateNewTickRange(currentTick, rangePct);

  console.log(`\n📐 New Range:`);
  console.log(`   ${newTickLower} → ${newTickUpper} (±${rangePct}% around tick ${currentTick})`);

  // Sanity checks
  if (newTickLower % TICK_SPACING !== 0 || newTickUpper % TICK_SPACING !== 0) {
    console.error(`❌ Tick alignment error: ${newTickLower} or ${newTickUpper} not divisible by ${TICK_SPACING}`);
    process.exit(1);
  }

  if (argv.dryRun) {
    console.log('\n🔮 Dry run: Would close position and reopen at new range.');
    const reason = !inRange ? 'OUT_OF_RANGE' : `DRIFT_${driftPct}%`;
    console.log(`${reason} — would rebalance #${argv.tokenId} to range ${newTickLower}→${newTickUpper}`);
    process.exit(0);
  }

  // ─── 5a. Record balances before ────────────────────────────────────────────
  const [wethBefore, axiomBefore] = await Promise.all([
    retry(() => publicClient.readContract({ address: CONTRACTS.WETH, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address] })),
    retry(() => publicClient.readContract({ address: CONTRACTS.AXIOM, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address] })),
  ]);

  // ─── 5b. Close old position ────────────────────────────────────────────────
  console.log('\n⏳ Step 1/2: Closing old position...');
  let closeResult;
  try {
    closeResult = await closePosition(publicClient, walletClient, account, tokenId, poolKey, liquidity);
  } catch (err) {
    console.error(`❌ Close position failed: ${err.message}`);
    process.exit(1);
  }

  await sleep(3000);

  // ─── 5c. Measure recovered tokens ──────────────────────────────────────────
  const [wethAfter, axiomAfter] = await Promise.all([
    retry(() => publicClient.readContract({ address: CONTRACTS.WETH, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address] })),
    retry(() => publicClient.readContract({ address: CONTRACTS.AXIOM, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address] })),
  ]);

  const recoveredWeth = wethAfter - wethBefore;
  const recoveredAxiom = axiomAfter - axiomBefore;
  const totalWeth = wethAfter;   // Use ALL available tokens (recovered + any dust already in wallet)
  const totalAxiom = axiomAfter;

  console.log(`   Recovered: ${formatEther(recoveredWeth)} WETH + ${formatEther(recoveredAxiom)} AXIOM`);
  console.log(`   Total available: ${formatEther(totalWeth)} WETH + ${formatEther(totalAxiom)} AXIOM`);

  if (totalWeth <= 0n && totalAxiom <= 0n) {
    console.error('❌ No tokens recovered — something went wrong');
    process.exit(1);
  }

  // ─── 5d. Re-read pool price (may have shifted) ────────────────────────────
  await sleep(1000);
  const [sqrtPriceX96Now, currentTickNow] = await retry(() =>
    publicClient.readContract({
      address: CONTRACTS.STATE_VIEW,
      abi: STATE_VIEW_ABI,
      functionName: 'getSlot0',
      args: [poolIdHash],
    })
  );
  console.log(`   Current tick (post-close): ${currentTickNow}`);

  // Verify new range still makes sense after any price shift
  if (currentTickNow < newTickLower || currentTickNow >= newTickUpper) {
    // Re-calculate range based on latest tick
    console.log('   ⚠️  Price shifted — recalculating range...');
    const recalc = calculateNewTickRange(Number(currentTickNow), rangePct);
    console.log(`   Adjusted range: ${recalc.tickLower} → ${recalc.tickUpper}`);
    // Use recalculated range (fall through to open)
    var finalTickLower = recalc.tickLower;
    var finalTickUpper = recalc.tickUpper;
  } else {
    var finalTickLower = newTickLower;
    var finalTickUpper = newTickUpper;
  }

  // ─── 5e. Open new position ─────────────────────────────────────────────────
  console.log('\n⏳ Step 2/2: Opening new position...');
  let mintResult;
  try {
    mintResult = await openNewPosition(
      publicClient, walletClient, account, poolKey,
      finalTickLower, finalTickUpper,
      totalWeth, totalAxiom,
      sqrtPriceX96Now
    );
  } catch (err) {
    console.error(`❌ Open new position failed: ${err.message}`);
    console.error('⚠️  Old position was closed. Tokens are in your wallet. Manual intervention needed.');
    process.exit(1);
  }

  // ─── 5f. Send leftover dust to harvest address ─────────────────────────────
  if (argv.harvestAddress) {
    await sleep(2000);
    const [dustWeth, dustAxiom] = await Promise.all([
      retry(() => publicClient.readContract({ address: CONTRACTS.WETH, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address] })),
      retry(() => publicClient.readContract({ address: CONTRACTS.AXIOM, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address] })),
    ]);

    if (dustWeth > 10n ** 14n) { // > 0.0001 WETH
      console.log(`   Sending ${formatEther(dustWeth)} WETH dust → ${argv.harvestAddress}`);
      try {
        const tx = await walletClient.writeContract({
          address: CONTRACTS.WETH, abi: ERC20_ABI, functionName: 'transfer',
          args: [argv.harvestAddress, dustWeth],
        });
        await publicClient.waitForTransactionReceipt({ hash: tx });
      } catch (err) {
        console.log(`   ⚠️  Dust transfer failed: ${err.message}`);
      }
    }

    if (dustAxiom > 10n ** 16n) { // > 0.01 AXIOM
      console.log(`   Sending ${formatEther(dustAxiom)} AXIOM dust → ${argv.harvestAddress}`);
      try {
        const tx = await walletClient.writeContract({
          address: CONTRACTS.AXIOM, abi: ERC20_ABI, functionName: 'transfer',
          args: [argv.harvestAddress, dustAxiom],
        });
        await publicClient.waitForTransactionReceipt({ hash: tx });
      } catch (err) {
        console.log(`   ⚠️  Dust transfer failed: ${err.message}`);
      }
    }
  }

  // ─── Summary ───────────────────────────────────────────────────────────────
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`✅ REBALANCED — old #${argv.tokenId} → new #${mintResult.newTokenId}, range ${finalTickLower}→${finalTickUpper}`);
  console.log(`${'═'.repeat(60)}`);
  console.log(`   New token ID: ${mintResult.newTokenId}`);
  console.log(`   New liquidity: ${mintResult.newLiquidity}`);
  console.log(`   New range: ${finalTickLower} → ${finalTickUpper}`);
  console.log(`\n🔗 Transactions:`);
  console.log(`   Close: https://basescan.org/tx/${closeResult.hash}`);
  console.log(`   Mint:  https://basescan.org/tx/${mintResult.hash}`);
}

main().catch((err) => {
  console.error(`\n❌ Fatal: ${err.message}`);
  if (err.stack) console.error(err.stack);
  process.exit(1);
});
