#!/usr/bin/env node
/**
 * Auto-compound V4 LP fees: collect → re-add as liquidity
 * 
 * Usage:
 *   node auto-compound.mjs --token-id 1078751                       # one-shot compound
 *   node auto-compound.mjs --token-id 1078751 --dry-run             # preview only
 *   node auto-compound.mjs --token-id 1078751 --loop --interval 3600  # loop mode
 *   node auto-compound.mjs --token-id 1078751 --min-usd 10          # min $10 to trigger
 * 
 * Gas-aware: only compounds when fees exceed a configurable USD threshold
 * AND a minimum multiple of gas cost (default 10x).
 */

import { createPublicClient, createWalletClient, http, formatEther, parseEther, maxUint256 } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base } from 'viem/chains';
import { defaultAbiCoder } from '@ethersproject/abi';
import * as dotenv from 'dotenv';
import { resolve } from 'path';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

dotenv.config({ path: resolve(process.env.HOME, '.axiom/wallet.env') });

const argv = yargs(hideBin(process.argv))
  .option('token-id', { type: 'number', required: true, description: 'LP NFT token ID' })
  .option('dry-run', { type: 'boolean', default: false, description: 'Preview fees without executing' })
  .option('loop', { type: 'boolean', default: false, description: 'Run continuously' })
  .option('interval', { type: 'number', default: 3600, description: 'Seconds between checks (loop mode)' })
  .option('min-usd', { type: 'number', default: 5, description: 'Min USD value to trigger compound' })
  .option('min-gas-multiple', { type: 'number', default: 10, description: 'Fees must exceed Nx gas cost' })
  .option('force', { type: 'boolean', default: false, description: 'Skip profitability check' })
  .parse();

// ─── Constants ───────────────────────────────────────────────────────────────

const CONTRACTS = {
  POOL_MANAGER: '0x498581ff718922c3f8e6a244956af099b2652b2b',
  POSITION_MANAGER: '0x7c5f5a4bbd8fd63184577525326123b519429bdc',
  STATE_VIEW: '0xa3c0c9b65bad0b08107aa264b0f3db444b867a71',
  PERMIT2: '0x000000000022D473030F116dDEE9F6B43aC78BA3',
  WETH: '0x4200000000000000000000000000000000000006',
};

// V4 Action Codes — canonical from Actions.sol
const Actions = {
  INCREASE_LIQUIDITY: 0x00,
  DECREASE_LIQUIDITY: 0x01,
  MINT_POSITION: 0x02,
  BURN_POSITION: 0x03,
  SETTLE_PAIR: 0x0d,
  TAKE_PAIR: 0x0e,
  SETTLE: 0x0f,
  TAKE: 0x10,
  CLOSE_CURRENCY: 0x11,
  SWEEP: 0x13,
};

// ABI type strings (matching V4 SDK)
const POOL_KEY_STRUCT = '(address,address,uint24,int24,address)';

const Q96 = BigInt(2) ** BigInt(96);

// ─── ABIs ────────────────────────────────────────────────────────────────────

const POSITION_MANAGER_ABI = [
  { name: 'modifyLiquidities', type: 'function', inputs: [{ name: 'unlockData', type: 'bytes' }, { name: 'deadline', type: 'uint256' }], outputs: [] },
  { name: 'getPoolAndPositionInfo', type: 'function', inputs: [{ type: 'uint256' }], outputs: [{ type: 'tuple', components: [{ name: 'currency0', type: 'address' }, { name: 'currency1', type: 'address' }, { name: 'fee', type: 'uint24' }, { name: 'tickSpacing', type: 'int24' }, { name: 'hooks', type: 'address' }] }, { type: 'uint256' }] },
  { name: 'ownerOf', type: 'function', inputs: [{ type: 'uint256' }], outputs: [{ type: 'address' }] },
  { name: 'getPositionLiquidity', type: 'function', inputs: [{ type: 'uint256' }], outputs: [{ type: 'uint128' }] },
];

const STATE_VIEW_ABI = [
  { name: 'getSlot0', type: 'function', inputs: [{ name: 'poolId', type: 'bytes32' }], outputs: [{ name: 'sqrtPriceX96', type: 'uint160' }, { name: 'tick', type: 'int24' }, { name: 'protocolFee', type: 'uint24' }, { name: 'lpFee', type: 'uint24' }] },
];

const ERC20_ABI = [
  { name: 'balanceOf', type: 'function', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] },
  { name: 'approve', type: 'function', inputs: [{ type: 'address' }, { type: 'uint256' }], outputs: [{ type: 'bool' }] },
  { name: 'allowance', type: 'function', inputs: [{ type: 'address' }, { type: 'address' }], outputs: [{ type: 'uint256' }] },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function tickToSqrtPriceX96(tick) {
  const sqrtRatio = Math.sqrt(Math.pow(1.0001, tick));
  return BigInt(Math.floor(sqrtRatio * Number(Q96)));
}

function getLiquidityForAmounts(sqrtPriceX96, sqrtPriceA, sqrtPriceB, amount0, amount1) {
  if (sqrtPriceA > sqrtPriceB) [sqrtPriceA, sqrtPriceB] = [sqrtPriceB, sqrtPriceA];
  
  const liq0 = (amount0, sqrtA, sqrtB) => {
    const intermediate = (sqrtA * sqrtB) / Q96;
    return (amount0 * intermediate) / (sqrtB - sqrtA);
  };
  const liq1 = (amount1, sqrtA, sqrtB) => (amount1 * Q96) / (sqrtB - sqrtA);

  if (sqrtPriceX96 <= sqrtPriceA) {
    return liq0(amount0, sqrtPriceA, sqrtPriceB);
  } else if (sqrtPriceX96 < sqrtPriceB) {
    const l0 = liq0(amount0, sqrtPriceX96, sqrtPriceB);
    const l1 = liq1(amount1, sqrtPriceA, sqrtPriceX96);
    return l0 < l1 ? l0 : l1;
  } else {
    return liq1(amount1, sqrtPriceA, sqrtPriceB);
  }
}

async function retry(fn, maxRetries = 4, baseDelayMs = 2000) {
  let delay = baseDelayMs;
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i === maxRetries - 1) throw err;
      const isRateLimit = err.message?.includes('429') || err.message?.includes('rate limit');
      if (!isRateLimit) throw err;
      console.log(`   ⏳ Rate limited, retry ${i + 1}/${maxRetries} in ${delay / 1000}s...`);
      await new Promise(r => setTimeout(r, delay));
      delay *= 2;
    }
  }
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function getEthPrice() {
  try {
    const resp = await fetch('https://api.dexscreener.com/latest/dex/tokens/0x4200000000000000000000000000000000000006');
    const data = await resp.json();
    const pair = data.pairs?.find(p => p.chainId === 'base' && p.quoteToken?.symbol === 'USDC');
    if (pair) return parseFloat(pair.priceUsd);
  } catch {}
  return 3200; // fallback
}

// ─── Core ────────────────────────────────────────────────────────────────────

async function compound(publicClient, walletClient, account) {
  const tokenId = BigInt(argv.tokenId);
  console.log(`\n🔄 Auto-Compound — Position #${argv.tokenId}`);
  console.log('═'.repeat(50));
  console.log(`Time: ${new Date().toISOString()}`);

  // 1. Get pool & position info
  const [poolKey, posInfo] = await retry(() => publicClient.readContract({
    address: CONTRACTS.POSITION_MANAGER,
    abi: POSITION_MANAGER_ABI,
    functionName: 'getPoolAndPositionInfo',
    args: [tokenId],
  }));
  await sleep(800);

  const liquidity = await retry(() => publicClient.readContract({
    address: CONTRACTS.POSITION_MANAGER,
    abi: POSITION_MANAGER_ABI,
    functionName: 'getPositionLiquidity',
    args: [tokenId],
  }));

  console.log(`\n📊 Position:`);
  console.log(`   Pool: ${poolKey.currency0} / ${poolKey.currency1}`);
  console.log(`   Fee: ${poolKey.fee === 8388608 ? 'DYNAMIC' : poolKey.fee}`);
  console.log(`   Liquidity: ${liquidity.toString()}`);

  if (liquidity === 0n) {
    console.log('⚠️  No liquidity — nothing to compound');
    return { compounded: false, reason: 'no-liquidity' };
  }

  // 2. Get tick range from posInfo (packed as tickLower|tickUpper in the info)
  // posInfo is the packed position info uint256
  // We need the pool's poolId to get current tick
  // Compute poolId from poolKey
  const poolId = defaultAbiCoder.encode(
    [POOL_KEY_STRUCT],
    [[poolKey.currency0, poolKey.currency1, poolKey.fee, poolKey.tickSpacing, poolKey.hooks]]
  );
  const { keccak256: viemKeccak } = await import('viem');
  const poolIdHash = viemKeccak(poolId);
  
  await sleep(800);
  const [sqrtPriceX96, currentTick] = await retry(() => publicClient.readContract({
    address: CONTRACTS.STATE_VIEW,
    abi: STATE_VIEW_ABI,
    functionName: 'getSlot0',
    args: [poolIdHash],
  }));
  console.log(`   Current tick: ${currentTick}`);
  console.log(`   sqrtPriceX96: ${sqrtPriceX96}`);

  // 3. Record wallet balances BEFORE collecting
  await sleep(500);
  const wethBefore = await retry(() => publicClient.readContract({
    address: CONTRACTS.WETH, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address],
  }));
  await sleep(500);
  const token1Before = await retry(() => publicClient.readContract({
    address: poolKey.currency1, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address],
  }));

  console.log(`\n💰 Wallet Before:`);
  console.log(`   WETH:   ${formatEther(wethBefore)}`);
  console.log(`   Token1: ${formatEther(token1Before)}`);

  if (argv.dryRun) {
    console.log('\n✅ Dry run — would collect fees and re-add as liquidity');
    console.log('   Run without --dry-run to execute');
    return { compounded: false, reason: 'dry-run' };
  }

  // ─── Step 1: Collect fees ──────────────────────────────────────────────────
  console.log('\n⏳ Step 1: Collecting fees...');

  // Proven pattern: DECREASE(0x01) + CLOSE_CURRENCY(0x11)
  // CLOSE_CURRENCY with currency0 address resolves both token deltas
  // (V4 settles remaining deltas at end of unlock)
  // Verified on-chain: tx 0xb000...8964 collected both WETH + AXIOM
  const collectActionsHex = '0x0111';

  const pad32 = (hex) => hex.replace('0x', '').padStart(64, '0');

  // DECREASE_LIQUIDITY: tokenId, liquidity(0=fees only), amount0Min, amount1Min, hookData
  const decreaseParams = '0x' +
    pad32('0x' + tokenId.toString(16)) +  // tokenId
    '0'.padStart(64, '0') +               // liquidity = 0
    '0'.padStart(64, '0') +               // amount0Min = 0
    '0'.padStart(64, '0') +               // amount1Min = 0
    (5 * 32).toString(16).padStart(64, '0') +  // hookData offset
    '0'.padStart(64, '0');                 // hookData length = 0

  // CLOSE_CURRENCY: pass both currency addresses + recipient
  // V4 reads first address as currency, ignores rest, and resolves ALL deltas
  const closeParams = '0x' +
    pad32(poolKey.currency0) +
    pad32(poolKey.currency1) +
    pad32(account.address);

  const { encodeAbiParameters: viemEncode, parseAbiParameters: viemParse } = await import('viem');
  const collectData = viemEncode(
    viemParse('bytes, bytes[]'),
    [collectActionsHex, [decreaseParams, closeParams]]
  );

  const deadline = BigInt(Math.floor(Date.now() / 1000) + 1800);

  const collectHash = await walletClient.writeContract({
    address: CONTRACTS.POSITION_MANAGER,
    abi: POSITION_MANAGER_ABI,
    functionName: 'modifyLiquidities',
    args: [collectData, deadline],
  });
  console.log(`   TX: ${collectHash}`);

  const collectReceipt = await publicClient.waitForTransactionReceipt({ hash: collectHash });
  if (collectReceipt.status !== 'success') {
    console.error('❌ Fee collection tx reverted');
    return { compounded: false, reason: 'collect-failed' };
  }
  console.log('   ✅ Fees collected!');

  // Wait for state to settle
  await sleep(3000);

  // ─── Step 2: Measure fees received ─────────────────────────────────────────
  const wethAfter = await retry(() => publicClient.readContract({
    address: CONTRACTS.WETH, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address],
  }));
  await sleep(500);
  const token1After = await retry(() => publicClient.readContract({
    address: poolKey.currency1, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address],
  }));

  const feesWeth = wethAfter - wethBefore;
  const feesToken1 = token1After - token1Before;

  console.log(`\n💸 Fees Received:`);
  console.log(`   WETH:   ${formatEther(feesWeth)}`);
  console.log(`   Token1: ${formatEther(feesToken1)}`);

  if (feesWeth <= 0n && feesToken1 <= 0n) {
    console.log('\n⚠️  No fees accrued. Nothing to compound.');
    return { compounded: false, reason: 'no-fees', collectTx: collectHash };
  }

  // ─── Step 3: Profitability check ───────────────────────────────────────────
  const ethPrice = await getEthPrice();
  const gasPrice = await retry(() => publicClient.getGasPrice());
  const estimatedGas = 350000n; // approve(s) + increase liquidity
  const gasCostWei = gasPrice * estimatedGas;
  const gasCostUsd = (Number(gasCostWei) / 1e18) * ethPrice;
  const feesWethUsd = (Number(feesWeth) / 1e18) * ethPrice;

  // Get token1 price for total USD calculation
  let token1PriceUsd = 0;
  try {
    const resp2 = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${poolKey.currency1}`);
    const data2 = await resp2.json();
    const pair2 = data2.pairs?.find(p => p.chainId === 'base');
    if (pair2) token1PriceUsd = parseFloat(pair2.priceUsd);
  } catch {}
  const feesToken1Usd = (Number(feesToken1) / 1e18) * token1PriceUsd;
  const feesUsd = feesWethUsd + feesToken1Usd;

  const minThreshold = Math.max(argv.minUsd, gasCostUsd * argv.minGasMultiple);

  console.log(`\n📊 Economics:`);
  console.log(`   ETH price:  $${ethPrice.toFixed(0)}`);
  console.log(`   Gas cost:   ~$${gasCostUsd.toFixed(4)}`);
  console.log(`   Fees (WETH): ~$${feesWethUsd.toFixed(4)}`);
  console.log(`   Fees (Token1): ~$${feesToken1Usd.toFixed(4)} (${token1PriceUsd > 0 ? '$' + token1PriceUsd.toFixed(8) + '/token' : 'price unknown'})`);
  console.log(`   Fees total: ~$${feesUsd.toFixed(4)}`);
  console.log(`   Threshold:  $${minThreshold.toFixed(2)} (max of $${argv.minUsd} or ${argv.minGasMultiple}x gas)`);

  if (!argv.force && feesUsd < minThreshold) {
    console.log(`\n⏸️  Fees ($${feesUsd.toFixed(2)}) below threshold ($${minThreshold.toFixed(2)}). Skipping re-add.`);
    console.log('   Fees sit in wallet — will compound on next profitable run.');
    console.log('   Use --force to override.');
    return { compounded: false, reason: 'below-threshold', feesUsd, collectTx: collectHash };
  }

  console.log(`\n✅ Fees ($${feesUsd.toFixed(2)}) profitable — compounding!`);

  // ─── Step 4: Approve tokens to PositionManager ────────────────────────────
  // Sequential approvals to avoid nonce race conditions

  if (feesWeth > 0n) {
    console.log('\n   Approving WETH...');
    const allowance = await publicClient.readContract({
      address: CONTRACTS.WETH, abi: ERC20_ABI, functionName: 'allowance',
      args: [account.address, CONTRACTS.POSITION_MANAGER],
    });
    if (allowance < feesWeth) {
      const tx = await walletClient.writeContract({
        address: CONTRACTS.WETH, abi: ERC20_ABI, functionName: 'approve',
        args: [CONTRACTS.POSITION_MANAGER, maxUint256],
      });
      await publicClient.waitForTransactionReceipt({ hash: tx });
      console.log('   ✅ WETH approved');
    } else {
      console.log('   ✅ WETH already approved');
    }
  }

  if (feesToken1 > 0n) {
    console.log('   Approving Token1...');
    await sleep(1000); // let nonce propagate
    const allowance = await publicClient.readContract({
      address: poolKey.currency1, abi: ERC20_ABI, functionName: 'allowance',
      args: [account.address, CONTRACTS.POSITION_MANAGER],
    });
    if (allowance < feesToken1) {
      const tx = await walletClient.writeContract({
        address: poolKey.currency1, abi: ERC20_ABI, functionName: 'approve',
        args: [CONTRACTS.POSITION_MANAGER, maxUint256],
      });
      await publicClient.waitForTransactionReceipt({ hash: tx });
      console.log('   ✅ Token1 approved');
    } else {
      console.log('   ✅ Token1 already approved');
    }
  }

  await sleep(1000);

  // ─── Step 5: Calculate liquidity from fee amounts ─────────────────────────
  // We need the position's tick range to calculate proper liquidity
  // The posInfo uint256 contains tickLower and tickUpper packed
  // For now, use the position's existing range by re-reading
  // tickLower = int24(posInfo >> 232), tickUpper = int24(posInfo >> 208)
  // Actually posInfo packing: first 160 bits = poolId prefix, then packed ticks
  // Let's extract from the raw posInfo value
  
  // V4 PositionManager packs: poolId(25bytes=200bits) | tickLower(3bytes=24bits) | tickUpper(3bytes=24bits) | salt(1byte=8bits)
  // Total = 256 bits
  const posInfoBN = BigInt(posInfo);
  const tickUpperRaw = Number((posInfoBN >> 8n) & 0xFFFFFFn);
  const tickLowerRaw = Number((posInfoBN >> 32n) & 0xFFFFFFn);
  
  // Convert from uint24 to int24
  const toInt24 = (v) => v >= 0x800000 ? v - 0x1000000 : v;
  const tickLower = toInt24(tickLowerRaw);
  const tickUpper = toInt24(tickUpperRaw);
  
  console.log(`\n📐 Position range: tick ${tickLower} → ${tickUpper}`);

  const sqrtPriceLower = tickToSqrtPriceX96(tickLower);
  const sqrtPriceUpper = tickToSqrtPriceX96(tickUpper);
  const newLiquidity = getLiquidityForAmounts(sqrtPriceX96, sqrtPriceLower, sqrtPriceUpper, feesWeth, feesToken1);

  if (newLiquidity <= 0n) {
    console.log('⚠️  Calculated liquidity is 0 — fees may be too small or out of range');
    return { compounded: false, reason: 'zero-liquidity', collectTx: collectHash };
  }

  console.log(`   New liquidity to add: ${newLiquidity}`);

  // ─── Step 6: Increase liquidity ───────────────────────────────────────────
  console.log('\n⏳ Step 2: Re-adding fees as liquidity...');

  // Actions: INCREASE_LIQUIDITY(0x00) + SETTLE_PAIR(0x0d)
  // Using same encoding approach as proven add-liquidity-v2.mjs
  const addActionsHex = '0x' +
    Actions.INCREASE_LIQUIDITY.toString(16).padStart(2, '0') +
    Actions.SETTLE_PAIR.toString(16).padStart(2, '0');

  // Add slippage buffer (50%) to max amounts
  const amount0Max = feesWeth > 0n ? feesWeth * 150n / 100n : 0n;
  const amount1Max = feesToken1 > 0n ? feesToken1 * 150n / 100n : 0n;

  // INCREASE_LIQUIDITY: (PoolKey, tokenId, liquidity, amount0Max, amount1Max, hookData)
  // Use ethersproject encoding (proven in add-liquidity-v2.mjs)
  const increaseParams = defaultAbiCoder.encode(
    ['uint256', 'uint256', 'uint128', 'uint128', 'bytes'],
    [tokenId.toString(), newLiquidity.toString(), amount0Max.toString(), amount1Max.toString(), '0x']
  );

  // SETTLE_PAIR: (currency0, currency1)
  const settleParams = defaultAbiCoder.encode(
    ['address', 'address'],
    [poolKey.currency0, poolKey.currency1]
  );

  const addData = defaultAbiCoder.encode(
    ['bytes', 'bytes[]'],
    [addActionsHex, [increaseParams, settleParams]]
  );

  try {
    const addHash = await walletClient.writeContract({
      address: CONTRACTS.POSITION_MANAGER,
      abi: POSITION_MANAGER_ABI,
      functionName: 'modifyLiquidities',
      args: [addData, deadline],
    });
    console.log(`   TX: ${addHash}`);

    const addReceipt = await publicClient.waitForTransactionReceipt({ hash: addHash });

    if (addReceipt.status === 'success') {
      const totalGas = collectReceipt.gasUsed + addReceipt.gasUsed;
      console.log(`\n✅ Auto-compound complete!`);
      console.log(`   Fees → liquidity in position #${argv.tokenId}`);
      console.log(`   WETH compounded: ${formatEther(feesWeth)}`);
      console.log(`   Token1 compounded: ${formatEther(feesToken1)}`);
      console.log(`   Total gas: ${totalGas}`);
      console.log(`   https://basescan.org/tx/${addHash}`);
      return { compounded: true, feesUsd, collectTx: collectHash, addTx: addHash, gas: totalGas };
    } else {
      console.error('❌ Increase liquidity tx reverted. Fees remain in wallet.');
      console.error(`   https://basescan.org/tx/${addHash}`);
      return { compounded: false, reason: 'add-reverted', collectTx: collectHash, addTx: addHash };
    }
  } catch (err) {
    console.error(`❌ Increase liquidity failed: ${err.shortMessage || err.message}`);
    console.error('   Fees collected but not re-added — they sit in wallet.');
    return { compounded: false, reason: 'add-error', error: err.message, collectTx: collectHash };
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const privateKey = process.env.NET_PRIVATE_KEY || process.env.PRIVATE_KEY;
  if (!privateKey) {
    console.error('❌ No private key found in ~/.axiom/wallet.env');
    process.exit(1);
  }

  const account = privateKeyToAccount(privateKey);
  const publicClient = createPublicClient({ chain: base, transport: http('https://mainnet.base.org') });
  const walletClient = createWalletClient({ account, chain: base, transport: http('https://mainnet.base.org') });

  console.log(`Wallet: ${account.address}`);

  // Verify ownership
  const owner = await retry(() => publicClient.readContract({
    address: CONTRACTS.POSITION_MANAGER,
    abi: POSITION_MANAGER_ABI,
    functionName: 'ownerOf',
    args: [BigInt(argv.tokenId)],
  }));

  if (owner.toLowerCase() !== account.address.toLowerCase()) {
    console.error(`❌ Not your position (owner: ${owner})`);
    process.exit(1);
  }

  if (argv.loop) {
    console.log(`\n🔁 Loop mode — checking every ${argv.interval}s`);
    console.log(`   Compound when fees > $${argv.minUsd} AND > ${argv.minGasMultiple}x gas cost`);
    console.log(`   Use Ctrl+C to stop\n`);

    let runs = 0;
    let totalCompounded = 0;
    while (true) {
      runs++;
      console.log(`\n━━━ Run #${runs} ━━━`);
      try {
        const result = await compound(publicClient, walletClient, account);
        if (result.compounded) totalCompounded++;
        console.log(`\n📈 Stats: ${totalCompounded}/${runs} runs compounded`);
      } catch (err) {
        console.error(`\n❌ Error: ${err.message}`);
      }
      console.log(`\n⏰ Next check in ${argv.interval}s...`);
      await sleep(argv.interval * 1000);
    }
  } else {
    try {
      const result = await compound(publicClient, walletClient, account);
      if (!result.compounded) {
        console.log(`\nResult: ${result.reason}`);
      }
    } catch (err) {
      console.error(`\n❌ Fatal: ${err.message}`);
      process.exit(1);
    }
  }
}

main().catch(console.error);
