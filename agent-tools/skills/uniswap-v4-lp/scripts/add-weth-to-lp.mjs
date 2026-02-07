#!/usr/bin/env node
/**
 * Add excess WETH to LP position #1396852
 * 
 * 1. Reads current position state & wallet balances
 * 2. Calculates optimal ratio for the tick range
 * 3. Swaps portion of WETH → AXIOM via V4 Universal Router
 * 4. Adds both tokens to position via INCREASE_LIQUIDITY + SETTLE_PAIR
 */

import { createPublicClient, createWalletClient, http, formatEther, maxUint256, keccak256, encodeAbiParameters, parseAbiParameters } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base } from 'viem/chains';
import { defaultAbiCoder } from '@ethersproject/abi';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(process.env.HOME, '.axiom/wallet.env') });

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

const TOKEN_ID = 1396852n;
const POOL_KEY_STRUCT = '(address,address,uint24,int24,address)';
const Q96 = 2n ** 96n;

const DRY_RUN = process.argv.includes('--dry-run');

// ─── ABIs ────────────────────────────────────────────────────────────────────

const POSITION_MANAGER_ABI = [
  { name: 'modifyLiquidities', type: 'function', inputs: [{ name: 'unlockData', type: 'bytes' }, { name: 'deadline', type: 'uint256' }], outputs: [] },
  { name: 'getPoolAndPositionInfo', type: 'function', inputs: [{ type: 'uint256' }], outputs: [{ type: 'tuple', components: [{ name: 'currency0', type: 'address' }, { name: 'currency1', type: 'address' }, { name: 'fee', type: 'uint24' }, { name: 'tickSpacing', type: 'int24' }, { name: 'hooks', type: 'address' }] }, { type: 'uint256' }] },
  { name: 'getPositionLiquidity', type: 'function', inputs: [{ type: 'uint256' }], outputs: [{ type: 'uint128' }] },
  { name: 'ownerOf', type: 'function', inputs: [{ type: 'uint256' }], outputs: [{ type: 'address' }] },
];

const STATE_VIEW_ABI = [
  { name: 'getSlot0', type: 'function', inputs: [{ name: 'poolId', type: 'bytes32' }], outputs: [{ name: 'sqrtPriceX96', type: 'uint160' }, { name: 'tick', type: 'int24' }, { name: 'protocolFee', type: 'uint24' }, { name: 'lpFee', type: 'uint24' }] },
];

const ERC20_ABI = [
  { name: 'balanceOf', type: 'function', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] },
  { name: 'approve', type: 'function', inputs: [{ type: 'address' }, { type: 'uint256' }], outputs: [{ type: 'bool' }] },
  { name: 'allowance', type: 'function', inputs: [{ type: 'address' }, { type: 'address' }], outputs: [{ type: 'uint256' }] },
];

const PERMIT2_ABI = [
  { name: 'approve', type: 'function', inputs: [{ name: 'token', type: 'address' }, { name: 'spender', type: 'address' }, { name: 'amount', type: 'uint160' }, { name: 'expiration', type: 'uint48' }], outputs: [] },
  { name: 'allowance', type: 'function', inputs: [{ name: 'owner', type: 'address' }, { name: 'token', type: 'address' }, { name: 'spender', type: 'address' }], outputs: [{ name: 'amount', type: 'uint160' }, { name: 'expiration', type: 'uint48' }, { name: 'nonce', type: 'uint48' }] },
];

const UNIVERSAL_ROUTER_ABI = [
  { name: 'execute', type: 'function', inputs: [{ name: 'commands', type: 'bytes' }, { name: 'inputs', type: 'bytes[]' }, { name: 'deadline', type: 'uint256' }], outputs: [] },
];

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function tickToSqrtPriceX96(tick) {
  return BigInt(Math.floor(Math.sqrt(Math.pow(1.0001, tick)) * Number(Q96)));
}

function getLiquidityForAmounts(sqrtPriceX96, sqrtPriceA, sqrtPriceB, amount0, amount1) {
  if (sqrtPriceA > sqrtPriceB) [sqrtPriceA, sqrtPriceB] = [sqrtPriceB, sqrtPriceA];
  const liq0 = (a0, sqrtA, sqrtB) => (a0 * ((sqrtA * sqrtB) / Q96)) / (sqrtB - sqrtA);
  const liq1 = (a1, sqrtA, sqrtB) => (a1 * Q96) / (sqrtB - sqrtA);

  if (sqrtPriceX96 <= sqrtPriceA) return liq0(amount0, sqrtPriceA, sqrtPriceB);
  if (sqrtPriceX96 < sqrtPriceB) {
    const l0 = liq0(amount0, sqrtPriceX96, sqrtPriceB);
    const l1 = liq1(amount1, sqrtPriceA, sqrtPriceX96);
    return l0 < l1 ? l0 : l1;
  }
  return liq1(amount1, sqrtPriceA, sqrtPriceB);
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const privateKey = process.env.NET_PRIVATE_KEY || process.env.PRIVATE_KEY;
  if (!privateKey) { console.error('❌ No private key'); process.exit(1); }

  const account = privateKeyToAccount(privateKey);
  const rpc = process.env.BASE_RPC_URL || 'https://mainnet.base.org';
  const publicClient = createPublicClient({ chain: base, transport: http(rpc) });
  const walletClient = createWalletClient({ account, chain: base, transport: http(rpc) });

  console.log(`\n🔧 Add WETH to LP Position #${TOKEN_ID}`);
  console.log(`   Wallet: ${account.address}`);
  console.log(`   ${DRY_RUN ? '🔮 DRY RUN MODE' : '⚡ LIVE MODE'}`);
  console.log('═'.repeat(60));

  // 1. Verify ownership
  const owner = await publicClient.readContract({ address: CONTRACTS.POSITION_MANAGER, abi: POSITION_MANAGER_ABI, functionName: 'ownerOf', args: [TOKEN_ID] });
  if (owner.toLowerCase() !== account.address.toLowerCase()) {
    console.error(`❌ Not our position (owner: ${owner})`);
    process.exit(1);
  }

  // 2. Get position info
  const [poolKey, posInfo] = await publicClient.readContract({ address: CONTRACTS.POSITION_MANAGER, abi: POSITION_MANAGER_ABI, functionName: 'getPoolAndPositionInfo', args: [TOKEN_ID] });
  const currentLiquidity = await publicClient.readContract({ address: CONTRACTS.POSITION_MANAGER, abi: POSITION_MANAGER_ABI, functionName: 'getPositionLiquidity', args: [TOKEN_ID] });

  const posInfoBN = BigInt(posInfo);
  const toInt24 = (v) => v >= 0x800000 ? v - 0x1000000 : v;
  const rawA = toInt24(Number((posInfoBN >> 32n) & 0xFFFFFFn));
  const rawB = toInt24(Number((posInfoBN >> 8n) & 0xFFFFFFn));
  const tickLower = Math.min(rawA, rawB);
  const tickUpper = Math.max(rawA, rawB);

  // 3. Pool state
  const poolId = defaultAbiCoder.encode([POOL_KEY_STRUCT], [[poolKey.currency0, poolKey.currency1, poolKey.fee, poolKey.tickSpacing, poolKey.hooks]]);
  const poolIdHash = keccak256(poolId);
  const [sqrtPriceX96, currentTick] = await publicClient.readContract({ address: CONTRACTS.STATE_VIEW, abi: STATE_VIEW_ABI, functionName: 'getSlot0', args: [poolIdHash] });

  console.log(`\n📊 Position State:`);
  console.log(`   Pool: WETH/AXIOM (tick spacing: ${poolKey.tickSpacing})`);
  console.log(`   Range: ${tickLower} → ${tickUpper}`);
  console.log(`   Current tick: ${currentTick}`);
  console.log(`   Liquidity: ${currentLiquidity.toString()}`);
  console.log(`   In range: ${currentTick >= tickLower && currentTick < tickUpper}`);

  // 4. Wallet balances
  const wethBal = await publicClient.readContract({ address: CONTRACTS.WETH, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address] });
  const axiomBal = await publicClient.readContract({ address: CONTRACTS.AXIOM, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address] });

  console.log(`\n💰 Wallet:`);
  console.log(`   WETH: ${formatEther(wethBal)}`);
  console.log(`   AXIOM: ${formatEther(axiomBal)}`);

  if (wethBal < 10n ** 15n) { // less than 0.001 WETH
    console.log('⚠️  Not enough WETH to add. Exiting.');
    process.exit(0);
  }

  // 5. Calculate optimal split
  const sp = sqrtPriceX96;
  const spL = tickToSqrtPriceX96(tickLower);
  const spU = tickToSqrtPriceX96(tickUpper);

  const priceFloat = Math.pow(Number(sp) / Number(Q96), 2); // token1 per token0
  const L = 10n ** 30n;
  const a0 = L * Q96 * (spU - sp) / (sp * spU);
  const a1 = L * (sp - spL) / Q96;

  const a0InToken1 = Number(a0) * priceFloat;
  const a1Num = Number(a1);
  const fractionForWeth = a0InToken1 / (a0InToken1 + a1Num);
  const fractionToSwap = 1 - fractionForWeth;

  const wethToKeep = BigInt(Math.floor(Number(wethBal) * fractionForWeth));
  const wethToSwap = wethBal - wethToKeep;

  console.log(`\n📐 Optimal Split:`);
  console.log(`   Keep as WETH: ${formatEther(wethToKeep)} (${(fractionForWeth * 100).toFixed(1)}%)`);
  console.log(`   Swap → AXIOM: ${formatEther(wethToSwap)} (${(fractionToSwap * 100).toFixed(1)}%)`);

  if (DRY_RUN) {
    console.log(`\n✅ Dry run complete. Would swap ${formatEther(wethToSwap)} WETH → AXIOM, then add to LP.`);
    process.exit(0);
  }

  // ─── Step 1: Swap WETH → AXIOM via V4 ─────────────────────────────────
  console.log(`\n⏳ Step 1/2: Swapping ${formatEther(wethToSwap)} WETH → AXIOM via V4...`);

  // Approve WETH to Permit2
  const wethAllowance = await publicClient.readContract({ address: CONTRACTS.WETH, abi: ERC20_ABI, functionName: 'allowance', args: [account.address, CONTRACTS.PERMIT2] });
  if (wethAllowance < wethToSwap) {
    console.log('   Approving WETH to Permit2...');
    const tx = await walletClient.writeContract({ address: CONTRACTS.WETH, abi: ERC20_ABI, functionName: 'approve', args: [CONTRACTS.PERMIT2, maxUint256] });
    await publicClient.waitForTransactionReceipt({ hash: tx });
    await sleep(1000);
  }

  // Approve Universal Router on Permit2
  const [permit2Amt] = await publicClient.readContract({ address: CONTRACTS.PERMIT2, abi: PERMIT2_ABI, functionName: 'allowance', args: [account.address, CONTRACTS.WETH, CONTRACTS.UNIVERSAL_ROUTER] });
  if (BigInt(permit2Amt) < wethToSwap) {
    console.log('   Approving Universal Router on Permit2...');
    const maxU160 = (1n << 160n) - 1n;
    const maxU48 = (1n << 48n) - 1n;
    const tx = await walletClient.writeContract({ address: CONTRACTS.PERMIT2, abi: PERMIT2_ABI, functionName: 'approve', args: [CONTRACTS.WETH, CONTRACTS.UNIVERSAL_ROUTER, maxU160, maxU48] });
    await publicClient.waitForTransactionReceipt({ hash: tx });
    await sleep(1000);
  }

  // V4 swap: WETH (currency0) → AXIOM (currency1), so zeroForOne = true
  const swapParams = defaultAbiCoder.encode(
    ['tuple(tuple(address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) poolKey, bool zeroForOne, uint128 amountIn, uint128 amountOutMinimum, bytes hookData)'],
    [{
      poolKey: { currency0: poolKey.currency0, currency1: poolKey.currency1, fee: poolKey.fee, tickSpacing: poolKey.tickSpacing, hooks: poolKey.hooks },
      zeroForOne: true,
      amountIn: wethToSwap.toString(),
      amountOutMinimum: '0',
      hookData: '0x',
    }]
  );
  const settleParams = defaultAbiCoder.encode(['address', 'uint256'], [CONTRACTS.WETH, wethToSwap.toString()]);
  const takeParams = defaultAbiCoder.encode(['address', 'uint256'], [CONTRACTS.AXIOM, '0']);

  const v4SwapInput = defaultAbiCoder.encode(['bytes', 'bytes[]'], ['0x060c0f', [swapParams, settleParams, takeParams]]);
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 1800);

  const swapHash = await walletClient.writeContract({
    address: CONTRACTS.UNIVERSAL_ROUTER,
    abi: UNIVERSAL_ROUTER_ABI,
    functionName: 'execute',
    args: ['0x10', [v4SwapInput], deadline],
  });
  const swapReceipt = await publicClient.waitForTransactionReceipt({ hash: swapHash });

  if (swapReceipt.status !== 'success') {
    console.error(`   ❌ Swap reverted! TX: ${swapHash}`);
    process.exit(1);
  }
  console.log(`   ✅ Swap TX: https://basescan.org/tx/${swapHash}`);

  await sleep(3000);

  // Check post-swap balances
  const wethAfterSwap = await publicClient.readContract({ address: CONTRACTS.WETH, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address] });
  const axiomAfterSwap = await publicClient.readContract({ address: CONTRACTS.AXIOM, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address] });
  console.log(`   Post-swap: ${formatEther(wethAfterSwap)} WETH, ${formatEther(axiomAfterSwap)} AXIOM`);

  // ─── Step 2: Add to LP via INCREASE_LIQUIDITY + SETTLE_PAIR ────────────
  console.log(`\n⏳ Step 2/2: Adding liquidity to position #${TOKEN_ID}...`);

  const amount0 = wethAfterSwap; // all remaining WETH
  const amount1 = axiomAfterSwap; // all AXIOM from swap

  // Re-read current pool price (may have shifted from our swap)
  const [sqrtPriceX96Now] = await publicClient.readContract({ address: CONTRACTS.STATE_VIEW, abi: STATE_VIEW_ABI, functionName: 'getSlot0', args: [poolIdHash] });

  const sqrtPriceLower = tickToSqrtPriceX96(tickLower);
  const sqrtPriceUpper = tickToSqrtPriceX96(tickUpper);
  const newLiquidity = getLiquidityForAmounts(sqrtPriceX96Now, sqrtPriceLower, sqrtPriceUpper, amount0, amount1);

  if (newLiquidity <= 0n) {
    console.error('❌ Zero liquidity — ratio mismatch. Tokens remain in wallet.');
    process.exit(1);
  }
  console.log(`   Liquidity to add: ${newLiquidity}`);

  // Ensure tokens approved to Permit2
  for (const [token, amount, label] of [
    [CONTRACTS.WETH, amount0, 'WETH'],
    [CONTRACTS.AXIOM, amount1, 'AXIOM'],
  ]) {
    if (amount <= 0n) continue;
    const allowance = await publicClient.readContract({ address: token, abi: ERC20_ABI, functionName: 'allowance', args: [account.address, CONTRACTS.PERMIT2] });
    if (allowance < amount) {
      console.log(`   Approving ${label} to Permit2...`);
      const tx = await walletClient.writeContract({ address: token, abi: ERC20_ABI, functionName: 'approve', args: [CONTRACTS.PERMIT2, maxUint256] });
      await publicClient.waitForTransactionReceipt({ hash: tx });
      await sleep(500);
    }
  }

  // Approve PositionManager on Permit2 for both tokens
  for (const [token, amount, label] of [
    [CONTRACTS.WETH, amount0, 'WETH'],
    [CONTRACTS.AXIOM, amount1, 'AXIOM'],
  ]) {
    if (amount <= 0n) continue;
    const [p2Amt] = await publicClient.readContract({ address: CONTRACTS.PERMIT2, abi: PERMIT2_ABI, functionName: 'allowance', args: [account.address, token, CONTRACTS.POSITION_MANAGER] });
    if (BigInt(p2Amt) < amount) {
      console.log(`   Approving PositionManager on Permit2 for ${label}...`);
      const maxU160 = (1n << 160n) - 1n;
      const maxU48 = (1n << 48n) - 1n;
      const tx = await walletClient.writeContract({ address: CONTRACTS.PERMIT2, abi: PERMIT2_ABI, functionName: 'approve', args: [token, CONTRACTS.POSITION_MANAGER, maxU160, maxU48] });
      await publicClient.waitForTransactionReceipt({ hash: tx });
      await sleep(500);
    }
  }

  await sleep(1000);

  // INCREASE_LIQUIDITY(0x00) + SETTLE_PAIR(0x0d) — proven pattern
  const addActionsHex = '0x000d';
  const amount0Max = amount0 * 110n / 100n; // 10% slippage buffer
  const amount1Max = amount1 * 110n / 100n;

  const increaseParams = defaultAbiCoder.encode(
    ['uint256', 'uint256', 'uint128', 'uint128', 'bytes'],
    [TOKEN_ID.toString(), newLiquidity.toString(), amount0Max.toString(), amount1Max.toString(), '0x']
  );

  const settlePairParams = defaultAbiCoder.encode(
    ['address', 'address'],
    [poolKey.currency0, poolKey.currency1]
  );

  const addData = encodeAbiParameters(
    parseAbiParameters('bytes, bytes[]'),
    [addActionsHex, [increaseParams, settlePairParams]]
  );

  const addDeadline = BigInt(Math.floor(Date.now() / 1000) + 1800);
  const addHash = await walletClient.writeContract({
    address: CONTRACTS.POSITION_MANAGER,
    abi: POSITION_MANAGER_ABI,
    functionName: 'modifyLiquidities',
    args: [addData, addDeadline],
  });

  const addReceipt = await publicClient.waitForTransactionReceipt({ hash: addHash });
  if (addReceipt.status !== 'success') {
    console.error(`   ❌ Add liquidity reverted! TX: ${addHash}`);
    process.exit(1);
  }
  console.log(`   ✅ Add TX: https://basescan.org/tx/${addHash}`);

  // Final state
  await sleep(2000);
  const finalLiq = await publicClient.readContract({ address: CONTRACTS.POSITION_MANAGER, abi: POSITION_MANAGER_ABI, functionName: 'getPositionLiquidity', args: [TOKEN_ID] });
  const finalWeth = await publicClient.readContract({ address: CONTRACTS.WETH, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address] });
  const finalAxiom = await publicClient.readContract({ address: CONTRACTS.AXIOM, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address] });

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`✅ Done! WETH added to LP position #${TOKEN_ID}`);
  console.log(`${'═'.repeat(60)}`);
  console.log(`   Liquidity: ${currentLiquidity.toString()} → ${finalLiq.toString()}`);
  console.log(`   Remaining WETH: ${formatEther(finalWeth)}`);
  console.log(`   Remaining AXIOM: ${formatEther(finalAxiom)}`);
  console.log(`\n🔗 Transactions:`);
  console.log(`   Swap:  https://basescan.org/tx/${swapHash}`);
  console.log(`   Add:   https://basescan.org/tx/${addHash}`);
}

main().catch(err => {
  console.error(`\n❌ Fatal: ${err.message}`);
  if (err.stack) console.error(err.stack);
  process.exit(1);
});
