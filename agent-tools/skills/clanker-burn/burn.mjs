#!/usr/bin/env node
/**
 * Clanker Fee Burn Pipeline
 * 
 * Complete end-to-end fee claim → rebalance → burn → treasury flow.
 * One command, no human intervention.
 * 
 * Pipeline:
 *   1. Claim WETH + token fees from Clanker
 *   2. Get prices (WETH from CoinGecko, token from DexScreener)
 *   3. Rebalance to 50/50 by value (swap only the gap)
 *   4. Burn ALL token balance to 0xdead
 *   5. Split WETH → USDC + BNKR → Treasury
 *   6. Report results
 * 
 * Usage:
 *   node burn.mjs --token 0xf3ce5ddaab6c133f9875a4a46c55cf0b58111b07 \
 *     --treasury 0x19fe674a83e98c44ad4c2172e006c542b8e8fe08 \
 *     [--dry-run] [--hooks 0xb429...] [--fee 0x800000] [--tick-spacing 200]
 */

import { createPublicClient, createWalletClient, http, formatEther, formatUnits, parseEther, maxUint256, parseAbi } from 'viem';
import { base } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { defaultAbiCoder } from '@ethersproject/abi';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

// ─── CLI Args ────────────────────────────────────────────────────────────────

const argv = yargs(hideBin(process.argv))
  .option('token', { type: 'string', required: true, description: 'Token address (Clanker token)' })
  .option('treasury', { type: 'string', required: true, description: 'Treasury address for USDC+BNKR' })
  .option('currency0', { type: 'string', default: '0x4200000000000000000000000000000000000006', description: 'V4 pool currency0 (default: WETH)' })
  .option('fee', { type: 'string', default: '0x800000', description: 'V4 pool fee (default: 0x800000)' })
  .option('tick-spacing', { type: 'number', default: 200, description: 'V4 pool tick spacing (default: 200)' })
  .option('hooks', { type: 'string', default: '0xb429d62f8f3bffb98cdb9569533ea23bf0ba28cc', description: 'V4 pool hooks address' })
  .option('dry-run', { type: 'boolean', default: false, description: 'Simulate without sending transactions' })
  .parse();

// ─── Constants ───────────────────────────────────────────────────────────────

const CONTRACTS = {
  CLANKER_FEE: '0xf3622742b1e446d92e45e22923ef11c2fcd55d68',
  WETH: '0x4200000000000000000000000000000000000006',
  USDC: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  BNKR: '0xf3ce5ddaab6c133f9875a4a46c55cf0b58111b07',
  SWAP_ROUTER_02: '0x2626664c2603336E57B271c5C0b26F421741e481',
  UNIVERSAL_ROUTER: '0x6ff5693b99212da76ad316178a184ab56d299b43',
  PERMIT2: '0x000000000022D473030F116dDEE9F6B43aC78BA3',
  DEAD: '0x000000000000000000000000000000000000dEaD',
};

const TOKEN_SUPPLY = 100_000_000_000n; // 100B

// Universal Router / V4 constants
const Commands = { V4_SWAP: 0x10 };
const Actions = { SWAP_EXACT_IN_SINGLE: 0x06, SETTLE_ALL: 0x0c, TAKE_ALL: 0x0f };

// ─── ABIs ────────────────────────────────────────────────────────────────────

const CLANKER_FEE_ABI = parseAbi([
  'function claim(address feeOwner, address token) external',
  'function availableFees(address feeOwner, address token) external view returns (uint256)',
  'function feesToClaim(address feeOwner, address token) external view returns (uint256)',
]);

const ERC20_ABI = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function transfer(address to, uint256 amount) external returns (bool)',
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
]);

const PERMIT2_ABI = parseAbi([
  'function allowance(address owner, address token, address spender) view returns (uint160 amount, uint48 expiration, uint48 nonce)',
  'function approve(address token, address spender, uint160 amount, uint48 expiration) external',
]);

const UNIVERSAL_ROUTER_ABI = parseAbi([
  'function execute(bytes commands, bytes[] inputs, uint256 deadline) external',
]);

const SWAP_ROUTER_ABI = parseAbi([
  'function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) external returns (uint256 amountOut)',
]);

// ─── Helpers ─────────────────────────────────────────────────────────────────

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function retry(fn, n = 3) {
  for (let i = 0; i < n; i++) {
    try { return await fn(); }
    catch (e) { if (i === n - 1) throw e; await sleep(2000); }
  }
}

// ─── Pipeline Steps ──────────────────────────────────────────────────────────

/**
 * Step 1: Claim fees from Clanker contract
 */
async function claimFees({ token, publicClient, walletClient, account, dryRun }) {
  console.log(`\n📋 Step 1: Claim Fees`);
  console.log(`═`.repeat(50));

  // Get token info
  const [tokenSymbol, tokenDecimals] = await Promise.all([
    retry(() => publicClient.readContract({ address: token, abi: ERC20_ABI, functionName: 'symbol' })),
    retry(() => publicClient.readContract({ address: token, abi: ERC20_ABI, functionName: 'decimals' })),
  ]);

  // Check available fees
  let wethFees, tokenFees;
  try {
    wethFees = await publicClient.readContract({
      address: CONTRACTS.CLANKER_FEE, abi: CLANKER_FEE_ABI, functionName: 'availableFees',
      args: [account.address, CONTRACTS.WETH],
    });
  } catch (e) {
    wethFees = await publicClient.readContract({
      address: CONTRACTS.CLANKER_FEE, abi: CLANKER_FEE_ABI, functionName: 'feesToClaim',
      args: [account.address, CONTRACTS.WETH],
    });
  }

  try {
    tokenFees = await publicClient.readContract({
      address: CONTRACTS.CLANKER_FEE, abi: CLANKER_FEE_ABI, functionName: 'availableFees',
      args: [account.address, token],
    });
  } catch (e) {
    tokenFees = await publicClient.readContract({
      address: CONTRACTS.CLANKER_FEE, abi: CLANKER_FEE_ABI, functionName: 'feesToClaim',
      args: [account.address, token],
    });
  }

  console.log(`💰 Available fees:`);
  console.log(`   WETH: ${formatEther(wethFees)}`);
  console.log(`   ${tokenSymbol}: ${formatUnits(tokenFees, tokenDecimals)}`);

  if (wethFees === 0n && tokenFees === 0n) {
    throw new Error('No fees to claim');
  }

  if (dryRun) {
    console.log(`\n[DRY] Would claim fees`);
    return { wethFees, tokenFees, tokenSymbol, tokenDecimals };
  }

  // Claim WETH fees
  let wethTx = null;
  if (wethFees > 0n) {
    console.log(`\n⏳ Claiming WETH fees...`);
    wethTx = await walletClient.writeContract({
      address: CONTRACTS.CLANKER_FEE, abi: CLANKER_FEE_ABI, functionName: 'claim',
      args: [account.address, CONTRACTS.WETH],
    });
    await publicClient.waitForTransactionReceipt({ hash: wethTx });
    console.log(`   ✅ https://basescan.org/tx/${wethTx}`);
    await sleep(1000);
  }

  // Claim token fees
  let tokenTx = null;
  if (tokenFees > 0n) {
    console.log(`\n⏳ Claiming ${tokenSymbol} fees...`);
    tokenTx = await walletClient.writeContract({
      address: CONTRACTS.CLANKER_FEE, abi: CLANKER_FEE_ABI, functionName: 'claim',
      args: [account.address, token],
    });
    await publicClient.waitForTransactionReceipt({ hash: tokenTx });
    console.log(`   ✅ https://basescan.org/tx/${tokenTx}`);
    await sleep(1000);
  }

  return { wethFees, tokenFees, tokenSymbol, tokenDecimals, wethTx, tokenTx };
}

/**
 * Step 2: Get prices from CoinGecko + DexScreener
 */
async function getPrices({ token }) {
  console.log(`\n📊 Step 2: Get Prices`);
  console.log(`═`.repeat(50));

  // WETH price from CoinGecko
  const cgRes = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd');
  const cgData = await cgRes.json();
  const wethPrice = cgData.ethereum.usd;

  // Token price from DexScreener
  const dsRes = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${token}`);
  const dsData = await dsRes.json();
  const tokenPrice = dsData.pairs?.[0]?.priceUsd ? parseFloat(dsData.pairs[0].priceUsd) : 0;

  console.log(`💵 Prices:`);
  console.log(`   WETH: $${wethPrice.toFixed(2)}`);
  console.log(`   Token: $${tokenPrice.toFixed(8)}`);

  return { wethPrice, tokenPrice };
}

/**
 * Step 3: Rebalance to 50/50 by value
 */
async function rebalance({ token, tokenSymbol, tokenDecimals, wethPrice, tokenPrice, poolKey, publicClient, walletClient, account, dryRun }) {
  console.log(`\n⚖️  Step 3: Rebalance to 50/50`);
  console.log(`═`.repeat(50));

  // Get current balances
  const wethBal = await retry(() => publicClient.readContract({
    address: CONTRACTS.WETH, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address],
  }));
  const tokenBal = await retry(() => publicClient.readContract({
    address: token, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address],
  }));

  const wethUsd = parseFloat(formatEther(wethBal)) * wethPrice;
  const tokenUsd = parseFloat(formatUnits(tokenBal, tokenDecimals)) * tokenPrice;

  console.log(`💰 Current holdings:`);
  console.log(`   WETH: ${formatEther(wethBal)} ($${wethUsd.toFixed(2)})`);
  console.log(`   ${tokenSymbol}: ${formatUnits(tokenBal, tokenDecimals)} ($${tokenUsd.toFixed(2)})`);

  const totalUsd = wethUsd + tokenUsd;
  const targetUsd = totalUsd / 2;
  const diff = Math.abs(wethUsd - tokenUsd);
  const swapUsd = diff / 2;

  console.log(`\n📐 Rebalance calculation:`);
  console.log(`   Total value: $${totalUsd.toFixed(2)}`);
  console.log(`   Target each: $${targetUsd.toFixed(2)}`);
  console.log(`   Gap: $${diff.toFixed(2)}`);
  console.log(`   Swap needed: $${swapUsd.toFixed(2)}`);

  if (swapUsd < 0.01) {
    console.log(`\n✅ Already balanced — skipping swap`);
    return { swapped: false, swappedAmount: 0n, direction: 'none' };
  }

  // Determine direction and amount
  let zeroForOne, swapAmount;
  if (wethUsd > tokenUsd) {
    // Swap WETH → token
    zeroForOne = poolKey.currency0.toLowerCase() === CONTRACTS.WETH.toLowerCase();
    swapAmount = parseEther((swapUsd / wethPrice).toString());
    console.log(`   Direction: WETH → ${tokenSymbol}`);
  } else {
    // Swap token → WETH
    zeroForOne = poolKey.currency0.toLowerCase() === token.toLowerCase();
    swapAmount = BigInt(Math.floor((swapUsd / tokenPrice) * 10 ** tokenDecimals));
    console.log(`   Direction: ${tokenSymbol} → WETH`);
  }

  console.log(`   Swap amount: ${wethUsd > tokenUsd ? formatEther(swapAmount) + ' WETH' : formatUnits(swapAmount, tokenDecimals) + ' ' + tokenSymbol}`);

  if (dryRun) {
    console.log(`\n[DRY] Would execute V4 swap`);
    return { swapped: true, swappedAmount: swapAmount, direction: wethUsd > tokenUsd ? 'WETH→TOKEN' : 'TOKEN→WETH' };
  }

  // Execute V4 swap
  const inputToken = wethUsd > tokenUsd ? CONTRACTS.WETH : token;
  await ensureApprovals(inputToken, swapAmount, publicClient, walletClient, account);

  console.log(`\n⏳ Executing V4 swap...`);
  const txHash = await executeV4Swap({
    poolKey, zeroForOne, amountIn: swapAmount, minAmountOut: 0n,
    publicClient, walletClient, account,
  });

  console.log(`   ✅ https://basescan.org/tx/${txHash}`);

  return {
    swapped: true,
    swappedAmount: swapAmount,
    direction: wethUsd > tokenUsd ? 'WETH→TOKEN' : 'TOKEN→WETH',
    txHash,
  };
}

/**
 * Step 4: Burn all token balance
 */
async function burnTokens({ token, tokenSymbol, tokenDecimals, publicClient, walletClient, account, dryRun }) {
  console.log(`\n🔥 Step 4: Burn Tokens`);
  console.log(`═`.repeat(50));

  const tokenBal = await retry(() => publicClient.readContract({
    address: token, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address],
  }));

  console.log(`🪙 Token balance: ${formatUnits(tokenBal, tokenDecimals)} ${tokenSymbol}`);

  if (tokenBal === 0n) {
    console.log(`⚠️  No tokens to burn`);
    return { amount: 0n, txHash: null };
  }

  if (dryRun) {
    console.log(`\n[DRY] Would burn ${formatUnits(tokenBal, tokenDecimals)} ${tokenSymbol} to 0xdead`);
    return { amount: tokenBal, txHash: null };
  }

  console.log(`\n⏳ Burning ${formatUnits(tokenBal, tokenDecimals)} ${tokenSymbol}...`);
  const txHash = await walletClient.writeContract({
    address: token, abi: ERC20_ABI, functionName: 'transfer',
    args: [CONTRACTS.DEAD, tokenBal],
  });
  await publicClient.waitForTransactionReceipt({ hash: txHash });
  console.log(`   ✅ https://basescan.org/tx/${txHash}`);

  return { amount: tokenBal, txHash };
}

/**
 * Step 5: Split WETH → USDC + BNKR, send to treasury
 */
async function treasurySplit({ token, treasury, publicClient, walletClient, account, dryRun }) {
  console.log(`\n🏦 Step 5: Treasury Split`);
  console.log(`═`.repeat(50));

  const wethBal = await retry(() => publicClient.readContract({
    address: CONTRACTS.WETH, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address],
  }));

  console.log(`💰 WETH balance: ${formatEther(wethBal)}`);

  if (wethBal === 0n) {
    console.log(`⚠️  No WETH to split`);
    return { usdcAmount: 0n, bnkrAmount: 0n };
  }

  const half = wethBal / 2n;
  console.log(`   Splitting into 2x ${formatEther(half)} WETH`);

  if (dryRun) {
    console.log(`\n[DRY] Would swap ${formatEther(half)} WETH → USDC`);
    console.log(`[DRY] Would swap ${formatEther(half)} WETH → BNKR`);
    console.log(`[DRY] Would send USDC + BNKR to ${treasury}`);
    return { usdcAmount: 0n, bnkrAmount: 0n };
  }

  // Approve SwapRouter02
  const allowance = await retry(() => publicClient.readContract({
    address: CONTRACTS.WETH, abi: ERC20_ABI, functionName: 'allowance',
    args: [account.address, CONTRACTS.SWAP_ROUTER_02],
  }));
  if (allowance < wethBal) {
    console.log(`\n⏳ Approving WETH → SwapRouter02...`);
    const approveTx = await walletClient.writeContract({
      address: CONTRACTS.WETH, abi: ERC20_ABI, functionName: 'approve',
      args: [CONTRACTS.SWAP_ROUTER_02, maxUint256],
    });
    await publicClient.waitForTransactionReceipt({ hash: approveTx });
    await sleep(1000);
  }

  // Swap 1: WETH → USDC (V3 pool, fee 500)
  console.log(`\n⏳ Swapping ${formatEther(half)} WETH → USDC...`);
  const usdcTx = await walletClient.writeContract({
    address: CONTRACTS.SWAP_ROUTER_02, abi: SWAP_ROUTER_ABI, functionName: 'exactInputSingle',
    args: [{
      tokenIn: CONTRACTS.WETH,
      tokenOut: CONTRACTS.USDC,
      fee: 500,
      recipient: account.address,
      amountIn: half,
      amountOutMinimum: 0n,
      sqrtPriceLimitX96: 0n,
    }],
  });
  await publicClient.waitForTransactionReceipt({ hash: usdcTx });
  console.log(`   ✅ https://basescan.org/tx/${usdcTx}`);
  await sleep(1000);

  // Swap 2: WETH → BNKR (V3 pool, fee 10000)
  console.log(`\n⏳ Swapping ${formatEther(half)} WETH → BNKR...`);
  const bnkrTx = await walletClient.writeContract({
    address: CONTRACTS.SWAP_ROUTER_02, abi: SWAP_ROUTER_ABI, functionName: 'exactInputSingle',
    args: [{
      tokenIn: CONTRACTS.WETH,
      tokenOut: CONTRACTS.BNKR,
      fee: 10000,
      recipient: account.address,
      amountIn: half,
      amountOutMinimum: 0n,
      sqrtPriceLimitX96: 0n,
    }],
  });
  await publicClient.waitForTransactionReceipt({ hash: bnkrTx });
  console.log(`   ✅ https://basescan.org/tx/${bnkrTx}`);
  await sleep(1000);

  // Get balances
  const usdcBal = await retry(() => publicClient.readContract({
    address: CONTRACTS.USDC, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address],
  }));
  const bnkrBal = await retry(() => publicClient.readContract({
    address: CONTRACTS.BNKR, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address],
  }));

  // Send to treasury
  console.log(`\n⏳ Sending ${formatUnits(usdcBal, 6)} USDC to treasury...`);
  const usdcSendTx = await walletClient.writeContract({
    address: CONTRACTS.USDC, abi: ERC20_ABI, functionName: 'transfer',
    args: [treasury, usdcBal],
  });
  await publicClient.waitForTransactionReceipt({ hash: usdcSendTx });
  console.log(`   ✅ https://basescan.org/tx/${usdcSendTx}`);

  console.log(`\n⏳ Sending ${formatUnits(bnkrBal, 18)} BNKR to treasury...`);
  const bnkrSendTx = await walletClient.writeContract({
    address: CONTRACTS.BNKR, abi: ERC20_ABI, functionName: 'transfer',
    args: [treasury, bnkrBal],
  });
  await publicClient.waitForTransactionReceipt({ hash: bnkrSendTx });
  console.log(`   ✅ https://basescan.org/tx/${bnkrSendTx}`);

  return {
    usdcAmount: usdcBal,
    usdcTx,
    usdcSendTx,
    bnkrAmount: bnkrBal,
    bnkrTx,
    bnkrSendTx,
  };
}

/**
 * Step 6: Final report
 */
async function generateReport({ token, tokenSymbol, tokenDecimals, wethFees, tokenFees, wethPrice, tokenPrice, rebalanceResult, burnResult, treasuryResult, publicClient }) {
  console.log(`\n📊 Step 6: Final Report`);
  console.log(`═`.repeat(50));

  // Get total burned to date
  const totalBurned = await retry(() => publicClient.readContract({
    address: token, abi: ERC20_ABI, functionName: 'balanceOf', args: [CONTRACTS.DEAD],
  }));

  const burnPercentage = (Number(totalBurned) / Number(TOKEN_SUPPLY * BigInt(10 ** tokenDecimals))) * 100;

  const report = {
    fees_claimed: {
      weth: formatEther(wethFees),
      token: formatUnits(tokenFees, tokenDecimals),
      weth_usd: (parseFloat(formatEther(wethFees)) * wethPrice).toFixed(2),
      token_usd: (parseFloat(formatUnits(tokenFees, tokenDecimals)) * tokenPrice).toFixed(2),
    },
    rebalance: {
      swapped_amount: rebalanceResult.swapped ? (rebalanceResult.direction.startsWith('WETH') ? formatEther(rebalanceResult.swappedAmount) : formatUnits(rebalanceResult.swappedAmount, tokenDecimals)) : '0',
      direction: rebalanceResult.direction,
      tx_hash: rebalanceResult.txHash || null,
    },
    burned: {
      amount: formatUnits(burnResult.amount, tokenDecimals),
      tx_hash: burnResult.txHash,
    },
    treasury: {
      usdc_amount: formatUnits(treasuryResult.usdcAmount, 6),
      usdc_tx: treasuryResult.usdcSendTx,
      bnkr_amount: formatUnits(treasuryResult.bnkrAmount, 18),
      bnkr_tx: treasuryResult.bnkrSendTx,
    },
    total_burned_to_date: formatUnits(totalBurned, tokenDecimals),
    burn_percentage: burnPercentage.toFixed(4) + '%',
  };

  console.log(JSON.stringify(report, null, 2));

  return report;
}

// ─── V4 Swap Helpers ─────────────────────────────────────────────────────────

async function ensureApprovals(token, amount, publicClient, walletClient, account) {
  // ERC20 → Permit2
  const erc20Allowance = await retry(() => publicClient.readContract({
    address: token, abi: ERC20_ABI, functionName: 'allowance',
    args: [account.address, CONTRACTS.PERMIT2],
  }));
  if (erc20Allowance < amount) {
    console.log(`   Approving ${token} → Permit2...`);
    const tx = await walletClient.writeContract({
      address: token, abi: ERC20_ABI, functionName: 'approve',
      args: [CONTRACTS.PERMIT2, maxUint256],
    });
    await publicClient.waitForTransactionReceipt({ hash: tx });
    await sleep(1000);
  }

  // Permit2 → Universal Router
  const [permit2Amount] = await retry(() => publicClient.readContract({
    address: CONTRACTS.PERMIT2, abi: PERMIT2_ABI, functionName: 'allowance',
    args: [account.address, token, CONTRACTS.UNIVERSAL_ROUTER],
  }));
  if (BigInt(permit2Amount) < amount) {
    console.log(`   Approving Universal Router on Permit2...`);
    const maxUint160 = (1n << 160n) - 1n;
    const maxUint48 = (1n << 48n) - 1n;
    const tx = await walletClient.writeContract({
      address: CONTRACTS.PERMIT2, abi: PERMIT2_ABI, functionName: 'approve',
      args: [token, CONTRACTS.UNIVERSAL_ROUTER, maxUint160, maxUint48],
    });
    await publicClient.waitForTransactionReceipt({ hash: tx });
    await sleep(1000);
  }
}

async function executeV4Swap({ poolKey, zeroForOne, amountIn, minAmountOut, publicClient, walletClient, account }) {
  const inputCurrency = zeroForOne ? poolKey.currency0 : poolKey.currency1;
  const outputCurrency = zeroForOne ? poolKey.currency1 : poolKey.currency0;

  // Encode V4 swap actions
  const actionsHex = '0x' +
    Actions.SWAP_EXACT_IN_SINGLE.toString(16).padStart(2, '0') +
    Actions.SETTLE_ALL.toString(16).padStart(2, '0') +
    Actions.TAKE_ALL.toString(16).padStart(2, '0');

  const swapParams = defaultAbiCoder.encode(
    ['tuple(tuple(address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) poolKey, bool zeroForOne, uint128 amountIn, uint128 amountOutMinimum, bytes hookData)'],
    [{
      poolKey: {
        currency0: poolKey.currency0,
        currency1: poolKey.currency1,
        fee: poolKey.fee,
        tickSpacing: poolKey.tickSpacing,
        hooks: poolKey.hooks,
      },
      zeroForOne,
      amountIn: amountIn.toString(),
      amountOutMinimum: minAmountOut.toString(),
      hookData: '0x',
    }]
  );

  const settleParams = defaultAbiCoder.encode(['address', 'uint256'], [inputCurrency, amountIn.toString()]);
  const takeParams = defaultAbiCoder.encode(['address', 'uint256'], [outputCurrency, minAmountOut.toString()]);

  const v4SwapInput = defaultAbiCoder.encode(
    ['bytes', 'bytes[]'],
    [actionsHex, [swapParams, settleParams, takeParams]]
  );

  const commands = '0x10';
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 1800);

  const hash = await walletClient.writeContract({
    address: CONTRACTS.UNIVERSAL_ROUTER,
    abi: UNIVERSAL_ROUTER_ABI,
    functionName: 'execute',
    args: [commands, [v4SwapInput], deadline],
  });

  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const privateKey = process.env.NET_PRIVATE_KEY;
  if (!privateKey) {
    console.error('❌ NET_PRIVATE_KEY not set');
    process.exit(1);
  }

  const account = privateKeyToAccount(privateKey);
  const rpcUrl = process.env.BASE_RPC_URL || 'https://mainnet.base.org';
  const publicClient = createPublicClient({ chain: base, transport: http(rpcUrl) });
  const walletClient = createWalletClient({ chain: base, transport: http(rpcUrl), account });

  const { token, treasury, currency0, fee, tickSpacing, hooks, dryRun } = argv;

  console.log(`🔥 Clanker Fee Burn Pipeline`);
  console.log(`═`.repeat(50));
  console.log(`Token: ${token}`);
  console.log(`Treasury: ${treasury}`);
  console.log(`Wallet: ${account.address}`);
  if (dryRun) console.log(`⚡ DRY RUN — no transactions`);
  console.log(`═`.repeat(50));

  // Build pool key
  const poolKey = {
    currency0,
    currency1: token,
    fee: parseInt(fee),
    tickSpacing,
    hooks,
  };

  try {
    // Pipeline execution
    const claimResult = await claimFees({ token, publicClient, walletClient, account, dryRun });
    const { wethPrice, tokenPrice } = await getPrices({ token });
    const rebalanceResult = await rebalance({
      token,
      tokenSymbol: claimResult.tokenSymbol,
      tokenDecimals: claimResult.tokenDecimals,
      wethPrice,
      tokenPrice,
      poolKey,
      publicClient,
      walletClient,
      account,
      dryRun,
    });

    const burnResult = await burnTokens({
      token,
      tokenSymbol: claimResult.tokenSymbol,
      tokenDecimals: claimResult.tokenDecimals,
      publicClient,
      walletClient,
      account,
      dryRun,
    });

    const treasuryResult = await treasurySplit({
      token,
      treasury,
      publicClient,
      walletClient,
      account,
      dryRun,
    });

    const report = await generateReport({
      token,
      tokenSymbol: claimResult.tokenSymbol,
      tokenDecimals: claimResult.tokenDecimals,
      wethFees: claimResult.wethFees,
      tokenFees: claimResult.tokenFees,
      wethPrice,
      tokenPrice,
      rebalanceResult,
      burnResult,
      treasuryResult,
      publicClient,
    });

    console.log(`\n✅ Pipeline complete!`);

  } catch (err) {
    console.error(`\n❌ Pipeline failed: ${err.message}`);
    if (err.cause) console.error(`   Cause: ${err.cause.message || err.cause}`);
    process.exit(1);
  }
}

main();
