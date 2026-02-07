#!/usr/bin/env node
/**
 * Recover LP Position — Mint a new position from tokens in wallet.
 * 
 * Use this when a rebalance fails mid-way (position closed, tokens in wallet,
 * new position NOT created). Swaps to optimal ratio then mints.
 * 
 * Usage:
 *   node recover-position.mjs --range-pct 20 --dry-run
 *   node recover-position.mjs --range-pct 20
 */

import {
  createPublicClient, createWalletClient, http,
  formatEther, maxUint256, keccak256,
  encodeAbiParameters, parseAbiParameters,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base } from 'viem/chains';
import { defaultAbiCoder } from '@ethersproject/abi';
import * as dotenv from 'dotenv';
import { resolve } from 'path';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

dotenv.config({ path: resolve(process.env.HOME, '.axiom/wallet.env') });

const argv = yargs(hideBin(process.argv))
  .option('range-pct', { type: 'number', default: 20, description: 'Range ±% around current price' })
  .option('slippage', { type: 'number', default: 5, description: 'Slippage tolerance %' })
  .option('dry-run', { type: 'boolean', default: false })
  .option('rpc', { type: 'string', default: process.env.BASE_RPC_URL || 'https://mainnet.base.org' })
  .parse();

const CONTRACTS = {
  POSITION_MANAGER: '0x7c5f5a4bbd8fd63184577525326123b519429bdc',
  STATE_VIEW: '0xa3c0c9b65bad0b08107aa264b0f3db444b867a71',
  PERMIT2: '0x000000000022D473030F116dDEE9F6B43aC78BA3',
  UNIVERSAL_ROUTER: '0x6ff5693b99212da76ad316178a184ab56d299b43',
  WETH: '0x4200000000000000000000000000000000000006',
  AXIOM: '0xf3Ce5dDAAb6C133F9875a4a46C55cf0b58111B07',
};

const POOL_KEY = {
  currency0: '0x4200000000000000000000000000000000000006',
  currency1: '0xf3ce5ddaab6c133f9875a4a46c55cf0b58111b07',
  fee: 0x800000,  // DYNAMIC_FEE_FLAG — hook controls fee
  tickSpacing: 200,
  hooks: '0xb429d62f8f3bffb98cdb9569533ea23bf0ba28cc',
};

const POOL_KEY_STRUCT = '(address,address,uint24,int24,address)';
const Q96 = 2n ** 96n;
const TICK_SPACING = 200;

const ERC20_ABI = [
  { name: 'balanceOf', type: 'function', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] },
  { name: 'approve', type: 'function', inputs: [{ type: 'address' }, { type: 'uint256' }], outputs: [{ type: 'bool' }] },
  { name: 'allowance', type: 'function', inputs: [{ type: 'address' }, { type: 'address' }], outputs: [{ type: 'uint256' }] },
];

const PERMIT2_ABI = [
  { name: 'approve', type: 'function', inputs: [{ name: 'token', type: 'address' }, { name: 'spender', type: 'address' }, { name: 'amount', type: 'uint160' }, { name: 'expiration', type: 'uint48' }], outputs: [] },
  { name: 'allowance', type: 'function', inputs: [{ name: 'owner', type: 'address' }, { name: 'token', type: 'address' }, { name: 'spender', type: 'address' }], outputs: [{ name: 'amount', type: 'uint160' }, { name: 'expiration', type: 'uint48' }, { name: 'nonce', type: 'uint48' }] },
];

const POSITION_MANAGER_ABI = [
  { name: 'modifyLiquidities', type: 'function', inputs: [{ name: 'unlockData', type: 'bytes' }, { name: 'deadline', type: 'uint256' }], outputs: [] },
];

const STATE_VIEW_ABI = [
  { name: 'getSlot0', type: 'function', inputs: [{ name: 'poolId', type: 'bytes32' }], outputs: [{ name: 'sqrtPriceX96', type: 'uint160' }, { name: 'tick', type: 'int24' }, { name: 'protocolFee', type: 'uint24' }, { name: 'lpFee', type: 'uint24' }] },
];

const UNIVERSAL_ROUTER_ABI = [
  { type: 'function', name: 'execute', inputs: [{ name: 'commands', type: 'bytes' }, { name: 'inputs', type: 'bytes[]' }, { name: 'deadline', type: 'uint256' }], outputs: [], stateMutability: 'payable' },
];

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function retry(fn, max = 4, delay = 2000) {
  for (let i = 0; i < max; i++) {
    try { return await fn(); } catch (e) {
      if (i === max - 1) throw e;
      if (!e.message?.includes('429') && !e.message?.includes('rate limit')) throw e;
      await sleep(delay * (i + 1));
    }
  }
}

function tickToSqrtPriceX96(tick) {
  return BigInt(Math.floor(Math.sqrt(Math.pow(1.0001, tick)) * Number(Q96)));
}

function getLiquidityForAmounts(sqrtPriceX96, sqrtPriceA, sqrtPriceB, amount0, amount1) {
  if (sqrtPriceA > sqrtPriceB) [sqrtPriceA, sqrtPriceB] = [sqrtPriceB, sqrtPriceA];
  const liq0 = (a0, sA, sB) => (a0 * ((sA * sB) / Q96)) / (sB - sA);
  const liq1 = (a1, sA, sB) => (a1 * Q96) / (sB - sA);
  if (sqrtPriceX96 <= sqrtPriceA) return liq0(amount0, sqrtPriceA, sqrtPriceB);
  if (sqrtPriceX96 < sqrtPriceB) {
    const l0 = liq0(amount0, sqrtPriceX96, sqrtPriceB);
    const l1 = liq1(amount1, sqrtPriceA, sqrtPriceX96);
    return l0 < l1 ? l0 : l1;
  }
  return liq1(amount1, sqrtPriceA, sqrtPriceB);
}

function calculateNewTickRange(currentTick, rangePct) {
  const lnBase = Math.log(1.0001);
  const upperDelta = Math.log(1 + rangePct / 100) / lnBase;
  const lowerDelta = Math.log(1 - rangePct / 100) / lnBase;
  const tickLower = Math.floor((currentTick + lowerDelta) / TICK_SPACING) * TICK_SPACING;
  const tickUpper = Math.ceil((currentTick + upperDelta) / TICK_SPACING) * TICK_SPACING;
  if (tickLower >= tickUpper) throw new Error(`Invalid range: ${tickLower} >= ${tickUpper}`);
  return { tickLower, tickUpper };
}

function extractNewTokenId(receipt, walletAddress) {
  const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
  const ZERO_TOPIC = '0x0000000000000000000000000000000000000000000000000000000000000000';
  const walletTopic = '0x' + walletAddress.toLowerCase().replace('0x', '').padStart(64, '0');
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== CONTRACTS.POSITION_MANAGER.toLowerCase()) continue;
    if (log.topics.length < 4) continue;
    if (log.topics[0] !== TRANSFER_TOPIC) continue;
    if (log.topics[1] !== ZERO_TOPIC) continue;
    if (log.topics[2].toLowerCase() !== walletTopic) continue;
    return BigInt(log.topics[3]);
  }
  return null;
}

async function ensureApprovals(publicClient, walletClient, account, token, amount, label, spender) {
  if (amount <= 0n) return;
  
  // Token → Permit2
  const erc20Allowance = await retry(() => publicClient.readContract({
    address: token, abi: ERC20_ABI, functionName: 'allowance',
    args: [account.address, CONTRACTS.PERMIT2],
  }));
  if (erc20Allowance < amount) {
    console.log(`   Approving ${label} → Permit2...`);
    const tx = await walletClient.writeContract({ address: token, abi: ERC20_ABI, functionName: 'approve', args: [CONTRACTS.PERMIT2, maxUint256] });
    await publicClient.waitForTransactionReceipt({ hash: tx });
    await sleep(500);
  }

  // Permit2 → spender
  const [p2Amount] = await retry(() => publicClient.readContract({
    address: CONTRACTS.PERMIT2, abi: PERMIT2_ABI, functionName: 'allowance',
    args: [account.address, token, spender],
  }));
  if (BigInt(p2Amount) < amount) {
    console.log(`   Approving Permit2 → ${spender === CONTRACTS.POSITION_MANAGER ? 'PositionManager' : 'UniversalRouter'} for ${label}...`);
    const maxU160 = (1n << 160n) - 1n;
    const maxU48 = (1n << 48n) - 1n;
    const tx = await walletClient.writeContract({
      address: CONTRACTS.PERMIT2, abi: PERMIT2_ABI, functionName: 'approve',
      args: [token, spender, maxU160, maxU48],
    });
    await publicClient.waitForTransactionReceipt({ hash: tx });
    await sleep(500);
  }
}

async function main() {
  const privateKey = process.env.NET_PRIVATE_KEY || process.env.PRIVATE_KEY;
  if (!privateKey) { console.error('❌ No private key'); process.exit(1); }

  const account = privateKeyToAccount(privateKey);
  const publicClient = createPublicClient({ chain: base, transport: http(argv.rpc) });
  const walletClient = createWalletClient({ account, chain: base, transport: http(argv.rpc) });

  console.log(`\n🔧 LP Recovery — Mint New Position`);
  console.log(`   Range: ±${argv.rangePct}% | Slippage: ${argv.slippage}%`);
  console.log(`   ${argv.dryRun ? '🔮 DRY RUN' : '⚡ LIVE'}`);
  console.log('═'.repeat(60));

  // 1. Get pool state
  const poolIdHash = keccak256(defaultAbiCoder.encode(
    [POOL_KEY_STRUCT],
    [[POOL_KEY.currency0, POOL_KEY.currency1, POOL_KEY.fee, POOL_KEY.tickSpacing, POOL_KEY.hooks]]
  ));
  
  const [sqrtPriceX96, currentTick] = await retry(() => publicClient.readContract({
    address: CONTRACTS.STATE_VIEW, abi: STATE_VIEW_ABI,
    functionName: 'getSlot0', args: [poolIdHash],
  }));
  
  const currentTickNum = Number(currentTick);
  console.log(`   Current tick: ${currentTickNum}`);

  // 2. Read wallet balances
  let [wethBal, axiomBal] = await Promise.all([
    retry(() => publicClient.readContract({ address: CONTRACTS.WETH, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address] })),
    retry(() => publicClient.readContract({ address: CONTRACTS.AXIOM, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address] })),
  ]);

  console.log(`   Wallet: ${formatEther(wethBal)} WETH + ${formatEther(axiomBal)} AXIOM`);

  if (wethBal <= 0n && axiomBal <= 0n) {
    console.error('❌ No tokens in wallet');
    process.exit(1);
  }

  // 3. Calculate new tick range
  const { tickLower, tickUpper } = calculateNewTickRange(currentTickNum, argv.rangePct);
  console.log(`   New range: ${tickLower} → ${tickUpper}`);

  // 4. Calculate optimal ratio and swap if needed
  const spL = tickToSqrtPriceX96(tickLower);
  const spU = tickToSqrtPriceX96(tickUpper);
  const priceFloat = Math.pow(Number(sqrtPriceX96) / Number(Q96), 2);

  const L_CALC = 10n ** 30n;
  const a0_units = L_CALC * Q96 * (spU - sqrtPriceX96) / (sqrtPriceX96 * spU);
  const a1_units = L_CALC * (sqrtPriceX96 - spL) / Q96;
  const a0InAxiom = Number(a0_units) * priceFloat;
  const a1Num = Number(a1_units);
  const optimalWethFraction = a0InAxiom / (a0InAxiom + a1Num);

  const totalValueInWeth = Number(wethBal) + Number(axiomBal) / priceFloat;
  const targetWeth = BigInt(Math.floor(totalValueInWeth * optimalWethFraction));

  console.log(`   Optimal ratio: ${(optimalWethFraction * 100).toFixed(1)}% WETH / ${((1 - optimalWethFraction) * 100).toFixed(1)}% AXIOM`);
  console.log(`   Target WETH: ~${formatEther(targetWeth)}`);

  if (argv.dryRun) {
    const newLiquidity = getLiquidityForAmounts(sqrtPriceX96, spL, spU, wethBal, axiomBal);
    console.log(`\n🔮 Dry run:`);
    console.log(`   Would mint position at ${tickLower}→${tickUpper}`);
    console.log(`   Estimated liquidity: ${newLiquidity}`);
    console.log(`   May need swap to rebalance ratio first`);
    process.exit(0);
  }

  // 5. Swap to optimal ratio if needed
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 1800);
  
  if (wethBal < targetWeth && axiomBal > 10n ** 18n) {
    // Need more WETH — swap AXIOM → WETH
    const wethDeficit = targetWeth - wethBal;
    const axiomToSwap = BigInt(Math.floor(Number(wethDeficit) * priceFloat * 1.05));
    const swapAmount = axiomToSwap > axiomBal ? axiomBal * 90n / 100n : axiomToSwap;

    console.log(`\n⏳ Swapping ${formatEther(swapAmount)} AXIOM → WETH...`);

    await ensureApprovals(publicClient, walletClient, account, CONTRACTS.AXIOM, swapAmount, 'AXIOM', CONTRACTS.UNIVERSAL_ROUTER);
    await sleep(1000);

    const swapParams = defaultAbiCoder.encode(
      ['tuple(tuple(address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) poolKey, bool zeroForOne, uint128 amountIn, uint128 amountOutMinimum, bytes hookData)'],
      [{
        poolKey: { currency0: POOL_KEY.currency0, currency1: POOL_KEY.currency1, fee: POOL_KEY.fee, tickSpacing: POOL_KEY.tickSpacing, hooks: POOL_KEY.hooks },
        zeroForOne: false, // AXIOM(c1) → WETH(c0)
        amountIn: swapAmount.toString(),
        amountOutMinimum: '0',
        hookData: '0x',
      }]
    );
    const settleSwapParams = defaultAbiCoder.encode(['address', 'uint256'], [CONTRACTS.AXIOM, swapAmount.toString()]);
    const takeSwapParams = defaultAbiCoder.encode(['address', 'uint256'], [CONTRACTS.WETH, '0']);
    const v4SwapInput = defaultAbiCoder.encode(['bytes', 'bytes[]'], ['0x060c0f', [swapParams, settleSwapParams, takeSwapParams]]);

    const swapHash = await walletClient.writeContract({
      address: CONTRACTS.UNIVERSAL_ROUTER, abi: UNIVERSAL_ROUTER_ABI,
      functionName: 'execute', args: ['0x10', [v4SwapInput], deadline],
    });
    const swapReceipt = await publicClient.waitForTransactionReceipt({ hash: swapHash });
    if (swapReceipt.status !== 'success') {
      console.log(`   ⚠️ Swap reverted: ${swapHash}. Proceeding with unbalanced amounts.`);
    } else {
      console.log(`   ✅ Swap TX: https://basescan.org/tx/${swapHash}`);
    }
    await sleep(2000);

  } else if (wethBal > targetWeth * 120n / 100n && wethBal > 10n ** 15n) {
    // Too much WETH — swap WETH → AXIOM
    const wethExcess = wethBal - targetWeth;
    const swapAmount = wethExcess * 90n / 100n;

    console.log(`\n⏳ Swapping ${formatEther(swapAmount)} WETH → AXIOM...`);

    await ensureApprovals(publicClient, walletClient, account, CONTRACTS.WETH, swapAmount, 'WETH', CONTRACTS.UNIVERSAL_ROUTER);
    await sleep(1000);

    const swapParams = defaultAbiCoder.encode(
      ['tuple(tuple(address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) poolKey, bool zeroForOne, uint128 amountIn, uint128 amountOutMinimum, bytes hookData)'],
      [{
        poolKey: { currency0: POOL_KEY.currency0, currency1: POOL_KEY.currency1, fee: POOL_KEY.fee, tickSpacing: POOL_KEY.tickSpacing, hooks: POOL_KEY.hooks },
        zeroForOne: true, // WETH(c0) → AXIOM(c1)
        amountIn: swapAmount.toString(),
        amountOutMinimum: '0',
        hookData: '0x',
      }]
    );
    const settleSwapParams = defaultAbiCoder.encode(['address', 'uint256'], [CONTRACTS.WETH, swapAmount.toString()]);
    const takeSwapParams = defaultAbiCoder.encode(['address', 'uint256'], [CONTRACTS.AXIOM, '0']);
    const v4SwapInput = defaultAbiCoder.encode(['bytes', 'bytes[]'], ['0x060c0f', [swapParams, settleSwapParams, takeSwapParams]]);

    const swapHash = await walletClient.writeContract({
      address: CONTRACTS.UNIVERSAL_ROUTER, abi: UNIVERSAL_ROUTER_ABI,
      functionName: 'execute', args: ['0x10', [v4SwapInput], deadline],
    });
    const swapReceipt = await publicClient.waitForTransactionReceipt({ hash: swapHash });
    if (swapReceipt.status !== 'success') {
      console.log(`   ⚠️ Swap reverted: ${swapHash}. Proceeding with unbalanced amounts.`);
    } else {
      console.log(`   ✅ Swap TX: https://basescan.org/tx/${swapHash}`);
    }
    await sleep(2000);
  } else {
    console.log(`   Ratio close enough, no swap needed.`);
  }

  // 6. Re-read balances after swap
  [wethBal, axiomBal] = await Promise.all([
    retry(() => publicClient.readContract({ address: CONTRACTS.WETH, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address] })),
    retry(() => publicClient.readContract({ address: CONTRACTS.AXIOM, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address] })),
  ]);
  console.log(`   Post-swap: ${formatEther(wethBal)} WETH + ${formatEther(axiomBal)} AXIOM`);

  // 7. Mint new position
  console.log(`\n⏳ Minting new position at ${tickLower}→${tickUpper}...`);

  // Re-read pool price (may have shifted from our swap)
  const [sqrtPriceNow] = await retry(() => publicClient.readContract({
    address: CONTRACTS.STATE_VIEW, abi: STATE_VIEW_ABI,
    functionName: 'getSlot0', args: [poolIdHash],
  }));

  const sqrtPriceLower = tickToSqrtPriceX96(tickLower);
  const sqrtPriceUpper = tickToSqrtPriceX96(tickUpper);
  const newLiquidity = getLiquidityForAmounts(sqrtPriceNow, sqrtPriceLower, sqrtPriceUpper, wethBal, axiomBal);

  if (newLiquidity <= 0n) {
    console.error(`❌ Zero liquidity. Tokens in wallet but can't form position.`);
    process.exit(1);
  }

  console.log(`   Liquidity: ${newLiquidity}`);

  await ensureApprovals(publicClient, walletClient, account, POOL_KEY.currency0, wethBal, 'WETH', CONTRACTS.POSITION_MANAGER);
  await ensureApprovals(publicClient, walletClient, account, POOL_KEY.currency1, axiomBal, 'AXIOM', CONTRACTS.POSITION_MANAGER);
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
      { currency0: POOL_KEY.currency0, currency1: POOL_KEY.currency1, fee: POOL_KEY.fee, tickSpacing: POOL_KEY.tickSpacing, hooks: POOL_KEY.hooks },
      tickLower, tickUpper,
      newLiquidity.toString(),
      ((wethBal * slipMul) / 100n).toString(),
      ((axiomBal * slipMul) / 100n).toString(),
      account.address,
      '0x',
    ]
  );

  const settleParams = defaultAbiCoder.encode(
    ['address', 'address'],
    [POOL_KEY.currency0, POOL_KEY.currency1]
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
    console.error(`❌ Mint reverted: ${mintHash}`);
    process.exit(1);
  }

  const newTokenId = extractNewTokenId(mintReceipt, account.address);
  if (!newTokenId) {
    console.error(`❌ Mint succeeded but couldn't extract token ID: ${mintHash}`);
    process.exit(1);
  }

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`✅ RECOVERED — New position #${newTokenId}`);
  console.log(`${'═'.repeat(60)}`);
  console.log(`   Range: ${tickLower} → ${tickUpper}`);
  console.log(`   Liquidity: ${newLiquidity}`);
  console.log(`   TX: https://basescan.org/tx/${mintHash}`);
  console.log(`\n⚠️  UPDATE your cron jobs to use token ID #${newTokenId}`);
}

main().catch(err => {
  console.error(`\n❌ Fatal: ${err.message}`);
  if (err.stack) console.error(err.stack);
  process.exit(1);
});
