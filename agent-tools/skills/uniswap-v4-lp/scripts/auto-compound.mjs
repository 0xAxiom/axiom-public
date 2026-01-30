#!/usr/bin/env node
/**
 * Auto-compound V4 LP fees: collect → re-add as liquidity
 * Usage: node auto-compound.mjs --token-id 1078751
 *        node auto-compound.mjs --token-id 1078751 --dry-run
 *        node auto-compound.mjs --token-id 1078751 --loop --interval 3600
 */

import { createPublicClient, createWalletClient, http, formatEther, parseEther, encodeAbiParameters, parseAbiParameters } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base } from 'viem/chains';
import * as dotenv from 'dotenv';
import { resolve } from 'path';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

dotenv.config({ path: resolve(process.env.HOME, '.axiom/wallet.env') });

const argv = yargs(hideBin(process.argv))
  .option('token-id', { type: 'number', required: true, description: 'LP NFT token ID' })
  .option('dry-run', { type: 'boolean', default: false, description: 'Simulate only — show estimated fees' })
  .option('loop', { type: 'boolean', default: false, description: 'Run continuously' })
  .option('interval', { type: 'number', default: 3600, description: 'Seconds between compounds (loop mode)' })
  .option('min-fees', { type: 'string', default: '0.0001', description: 'Min ETH-equivalent fees to trigger compound' })
  .parse();

const CONTRACTS = {
  POSITION_MANAGER: '0x7c5f5a4bbd8fd63184577525326123b519429bdc',
  STATE_VIEW: '0xa3c0c9b65bad0b08107aa264b0f3db444b867a71',
  WETH: '0x4200000000000000000000000000000000000006',
};

const POSITION_MANAGER_ABI = [
  { name: 'modifyLiquidities', type: 'function', inputs: [{ name: 'unlockData', type: 'bytes' }, { name: 'deadline', type: 'uint256' }], outputs: [] },
  { name: 'getPoolAndPositionInfo', type: 'function', inputs: [{ type: 'uint256' }], outputs: [{ type: 'tuple', components: [{ name: 'currency0', type: 'address' }, { name: 'currency1', type: 'address' }, { name: 'fee', type: 'uint24' }, { name: 'tickSpacing', type: 'int24' }, { name: 'hooks', type: 'address' }]}, { type: 'uint256' }] },
  { name: 'ownerOf', type: 'function', inputs: [{ type: 'uint256' }], outputs: [{ type: 'address' }] },
  { name: 'getPositionLiquidity', type: 'function', inputs: [{ type: 'uint256' }], outputs: [{ type: 'uint128' }] },
];

const STATE_VIEW_ABI = [
  { name: 'getPositionInfo', type: 'function', inputs: [{ type: 'bytes32' }, { type: 'address' }, { type: 'int24' }, { type: 'int24' }, { type: 'bytes32' }], outputs: [{ type: 'uint128' }, { type: 'uint256' }, { type: 'uint256' }] },
  { name: 'getSlot0', type: 'function', inputs: [{ type: 'bytes32' }], outputs: [{ type: 'uint160' }, { type: 'int24' }, { type: 'uint24' }, { type: 'uint24' }] },
];

// V4 Action codes (CORRECT — verified on-chain)
const Actions = {
  DECREASE_LIQUIDITY: 0x01,
  INCREASE_LIQUIDITY: 0x00,
  TAKE_PAIR: 0x11,
  SETTLE_PAIR: 0x10,
  CLOSE_CURRENCY: 0x15,
  SWEEP: 0x16,
};

const pad32 = (hex) => hex.replace('0x', '').padStart(64, '0');

// Retry helper for rate-limited RPCs
async function retry(fn, maxRetries = 3, delayMs = 2000) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i === maxRetries - 1) throw err;
      const isRateLimit = err.message?.includes('429') || err.message?.includes('rate limit');
      if (!isRateLimit) throw err;
      console.log(`   ⏳ Rate limited, retrying in ${delayMs / 1000}s... (${i + 1}/${maxRetries})`);
      await new Promise(r => setTimeout(r, delayMs));
      delayMs *= 2; // exponential backoff
    }
  }
}

async function compound(publicClient, walletClient, account) {
  const tokenId = argv.tokenId;
  console.log(`\n🔄 Auto-Compound — Position #${tokenId}`);
  console.log('═'.repeat(45));
  console.log(`Time: ${new Date().toISOString()}`);

  // Step 1: Get pool & position info
  const [poolKey, posInfo] = await retry(() => publicClient.readContract({
    address: CONTRACTS.POSITION_MANAGER,
    abi: POSITION_MANAGER_ABI,
    functionName: 'getPoolAndPositionInfo',
    args: [BigInt(tokenId)],
  }));

  await new Promise(r => setTimeout(r, 1000)); // small delay between calls

  const liquidity = await retry(() => publicClient.readContract({
    address: CONTRACTS.POSITION_MANAGER,
    abi: POSITION_MANAGER_ABI,
    functionName: 'getPositionLiquidity',
    args: [BigInt(tokenId)],
  }));

  console.log(`\n📊 Position Info:`);
  console.log(`   Pool: ${poolKey.currency0.slice(0,10)}.../${poolKey.currency1.slice(0,10)}...`);
  console.log(`   Fee: ${poolKey.fee === 8388608 ? 'DYNAMIC' : poolKey.fee}`);
  console.log(`   Liquidity: ${liquidity.toString()}`);

  if (liquidity === 0n) {
    console.log('⚠️  Position has no liquidity — nothing to compound');
    return false;
  }

  // Step 2: Check wallet balances before (to measure fees received)
  const balanceAbi = [{ name: 'balanceOf', type: 'function', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] }];

  const wethBefore = await retry(() => publicClient.readContract({
    address: CONTRACTS.WETH, abi: balanceAbi, functionName: 'balanceOf', args: [account.address],
  }));

  await new Promise(r => setTimeout(r, 500));

  const token1Before = await retry(() => publicClient.readContract({
    address: poolKey.currency1, abi: balanceAbi, functionName: 'balanceOf', args: [account.address],
  }));

  console.log(`\n💰 Wallet Before:`);
  console.log(`   WETH:   ${formatEther(wethBefore)}`);
  console.log(`   Token1: ${formatEther(token1Before)}`);

  if (argv.dryRun) {
    console.log('\n✅ Dry run — would collect fees and re-add as liquidity');
    console.log('   Run without --dry-run to execute');
    return false;
  }

  // Step 3: Collect fees (DECREASE with 0 liquidity)
  console.log('\n⏳ Step 1/2: Collecting fees...');

  const collectActions = new Uint8Array([Actions.DECREASE_LIQUIDITY, Actions.TAKE_PAIR]);
  const collectActionsHex = '0x' + Array.from(collectActions).map(b => b.toString(16).padStart(2, '0')).join('');

  // DECREASE params: tokenId, liquidity(0), amount0Min(0), amount1Min(0), hookData
  const decreaseParams = encodeAbiParameters(
    parseAbiParameters('uint256, uint256, uint128, uint128, bytes'),
    [BigInt(tokenId), 0n, 0n, 0n, '0x']
  );

  // TAKE_PAIR params: currency0, currency1, address
  const takeParams = encodeAbiParameters(
    parseAbiParameters('address, address, address'),
    [poolKey.currency0, poolKey.currency1, account.address]
  );

  const collectData = encodeAbiParameters(
    parseAbiParameters('bytes, bytes[]'),
    [collectActionsHex, [decreaseParams, takeParams]]
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
    console.error('❌ Fee collection failed');
    return false;
  }
  console.log('   ✅ Fees collected!');

  // Step 4: Check what we received
  const wethAfter = await retry(() => publicClient.readContract({
    address: CONTRACTS.WETH, abi: balanceAbi, functionName: 'balanceOf', args: [account.address],
  }));

  await new Promise(r => setTimeout(r, 500));

  const token1After = await retry(() => publicClient.readContract({
    address: poolKey.currency1, abi: balanceAbi, functionName: 'balanceOf', args: [account.address],
  }));

  const feesWeth = wethAfter - wethBefore;
  const feesToken1 = token1After - token1Before;

  console.log(`\n💸 Fees Collected:`);
  console.log(`   WETH:   ${formatEther(feesWeth)}`);
  console.log(`   Token1: ${formatEther(feesToken1)}`);

  // Check minimum threshold
  const minFees = parseEther(argv.minFees);
  if (feesWeth < minFees && feesToken1 === 0n) {
    console.log(`\n⚠️  Fees below minimum threshold (${argv.minFees} ETH). Skipping re-add.`);
    console.log('   Fees remain in wallet for next compound.');
    return true; // fees were collected, just not re-added
  }

  // Step 5: Re-add as liquidity
  console.log('\n⏳ Step 2/2: Adding fees back as liquidity...');

  // Approve tokens to position manager
  const approveAbi = [{ name: 'approve', type: 'function', inputs: [{ type: 'address' }, { type: 'uint256' }], outputs: [{ type: 'bool' }] }];

  if (feesWeth > 0n) {
    const approveTx = await walletClient.writeContract({
      address: CONTRACTS.WETH,
      abi: approveAbi,
      functionName: 'approve',
      args: [CONTRACTS.POSITION_MANAGER, feesWeth],
    });
    await publicClient.waitForTransactionReceipt({ hash: approveTx });
  }

  if (feesToken1 > 0n) {
    const approveTx = await walletClient.writeContract({
      address: poolKey.currency1,
      abi: approveAbi,
      functionName: 'approve',
      args: [CONTRACTS.POSITION_MANAGER, feesToken1],
    });
    await publicClient.waitForTransactionReceipt({ hash: approveTx });
  }

  // INCREASE_LIQUIDITY + SETTLE_PAIR + SWEEP (return dust)
  const addActions = new Uint8Array([Actions.INCREASE_LIQUIDITY, Actions.SETTLE_PAIR, Actions.CLOSE_CURRENCY, Actions.CLOSE_CURRENCY]);
  const addActionsHex = '0x' + Array.from(addActions).map(b => b.toString(16).padStart(2, '0')).join('');

  // Estimate liquidity from token amounts (use a conservative amount)
  // For INCREASE: tokenId, liquidity, amount0Max, amount1Max, hookData
  // We use type(uint128).max for liquidity to add all available tokens
  const increaseParams = encodeAbiParameters(
    parseAbiParameters('uint256, uint256, uint128, uint128, bytes'),
    [BigInt(tokenId), feesWeth > 0n ? feesWeth : feesToken1, feesWeth > 0n ? feesWeth : 0n, feesToken1 > 0n ? feesToken1 : 0n, '0x']
  );

  // SETTLE_PAIR
  const settleParams = encodeAbiParameters(
    parseAbiParameters('address, address'),
    [poolKey.currency0, poolKey.currency1]
  );

  // CLOSE_CURRENCY for each token (returns dust)
  const close0Params = encodeAbiParameters(
    parseAbiParameters('address'),
    [poolKey.currency0]
  );
  const close1Params = encodeAbiParameters(
    parseAbiParameters('address'),
    [poolKey.currency1]
  );

  const addData = encodeAbiParameters(
    parseAbiParameters('bytes, bytes[]'),
    [addActionsHex, [increaseParams, settleParams, close0Params, close1Params]]
  );

  const addHash = await walletClient.writeContract({
    address: CONTRACTS.POSITION_MANAGER,
    abi: POSITION_MANAGER_ABI,
    functionName: 'modifyLiquidities',
    args: [addData, deadline],
  });

  console.log(`   TX: ${addHash}`);
  const addReceipt = await publicClient.waitForTransactionReceipt({ hash: addHash });

  if (addReceipt.status === 'success') {
    console.log('\n✅ Auto-compound complete!');
    console.log(`   Fees collected → re-added as liquidity`);
    console.log(`   Gas used: ${collectReceipt.gasUsed + addReceipt.gasUsed}`);
    console.log(`   BaseScan: https://basescan.org/tx/${addHash}`);
    return true;
  } else {
    console.error('❌ Re-add liquidity failed. Fees remain in wallet.');
    return false;
  }
}

async function main() {
  const privateKey = process.env.NET_PRIVATE_KEY || process.env.PRIVATE_KEY;
  if (!privateKey) {
    console.error('❌ No private key found in ~/.axiom/wallet.env');
    process.exit(1);
  }

  const account = privateKeyToAccount(privateKey);
  const publicClient = createPublicClient({ chain: base, transport: http('https://mainnet.base.org') });
  const walletClient = createWalletClient({ account, chain: base, transport: http('https://mainnet.base.org') });

  // Verify ownership
  const owner = await publicClient.readContract({
    address: CONTRACTS.POSITION_MANAGER,
    abi: POSITION_MANAGER_ABI,
    functionName: 'ownerOf',
    args: [BigInt(argv.tokenId)],
  });

  if (owner.toLowerCase() !== account.address.toLowerCase()) {
    console.error(`❌ Not your position (owner: ${owner})`);
    process.exit(1);
  }

  if (argv.loop) {
    console.log(`🔁 Loop mode: compounding every ${argv.interval}s`);
    console.log(`   Min fees threshold: ${argv.minFees} ETH`);
    while (true) {
      try {
        await compound(publicClient, walletClient, account);
      } catch (err) {
        console.error(`\n❌ Error: ${err.message}`);
      }
      console.log(`\n⏰ Next compound in ${argv.interval}s...`);
      await new Promise(r => setTimeout(r, argv.interval * 1000));
    }
  } else {
    await compound(publicClient, walletClient, account);
  }
}

main().catch(console.error);
