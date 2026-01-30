#!/usr/bin/env node
/**
 * Remove liquidity from V4 LP position (using SDK-style encoding)
 * Usage: node remove-liquidity.mjs --token-id 1078344 --percent 100
 */

import { createPublicClient, createWalletClient, http, formatEther } from 'viem';
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
  .option('percent', { type: 'number', default: 100, description: 'Percentage to remove (1-100)' })
  .option('dry-run', { type: 'boolean', default: false, description: 'Simulate only' })
  .parse();

const CONTRACTS = {
  POSITION_MANAGER: '0x7c5f5a4bbd8fd63184577525326123b519429bdc',
  WETH: '0x4200000000000000000000000000000000000006',
  AXIOM: '0xf3Ce5dDAAb6C133F9875a4a46C55cf0b58111B07',
};

const POSITION_MANAGER_ABI = [
  { name: 'modifyLiquidities', type: 'function', inputs: [{ name: 'unlockData', type: 'bytes' }, { name: 'deadline', type: 'uint256' }], outputs: [{ type: 'bytes' }] },
  { name: 'getPoolAndPositionInfo', type: 'function', inputs: [{ type: 'uint256' }], outputs: [{ type: 'tuple', components: [{ name: 'currency0', type: 'address' }, { name: 'currency1', type: 'address' }, { name: 'fee', type: 'uint24' }, { name: 'tickSpacing', type: 'int24' }, { name: 'hooks', type: 'address' }]}, { type: 'uint256' }] },
  { name: 'getPositionLiquidity', type: 'function', inputs: [{ type: 'uint256' }], outputs: [{ type: 'uint128' }] },
  { name: 'ownerOf', type: 'function', inputs: [{ type: 'uint256' }], outputs: [{ type: 'address' }] },
];

// Action codes from V4 periphery (verified from Actions.sol)
const Actions = {
  DECREASE_LIQUIDITY: 0x01,
  BURN_POSITION: 0x03,
  TAKE_PAIR: 0x11,
};

async function main() {
  console.log('🦄 Uniswap V4 LP - Remove Liquidity');
  console.log('====================================');
  console.log(`Token ID: ${argv.tokenId}`);
  console.log(`Percent: ${argv.percent}%`);
  console.log(`Dry run: ${argv.dryRun}`);
  console.log('');

  if (argv.percent < 1 || argv.percent > 100) {
    console.error('❌ Percent must be between 1 and 100');
    process.exit(1);
  }

  const privateKey = process.env.NET_PRIVATE_KEY || process.env.PRIVATE_KEY;
  if (!privateKey) {
    console.error('❌ No private key found');
    process.exit(1);
  }

  const account = privateKeyToAccount(privateKey);
  console.log(`Wallet: ${account.address}`);

  const publicClient = createPublicClient({
    chain: base,
    transport: http(process.env.BASE_RPC_URL || 'https://mainnet.base.org'),
  });

  const walletClient = createWalletClient({
    account,
    chain: base,
    transport: http(process.env.BASE_RPC_URL || 'https://mainnet.base.org'),
  });

  // Verify ownership
  const owner = await publicClient.readContract({
    address: CONTRACTS.POSITION_MANAGER,
    abi: POSITION_MANAGER_ABI,
    functionName: 'ownerOf',
    args: [argv.tokenId],
  });

  if (owner.toLowerCase() !== account.address.toLowerCase()) {
    console.error(`❌ You don't own this position (owner: ${owner})`);
    process.exit(1);
  }

  // Get current liquidity
  const liquidity = await publicClient.readContract({
    address: CONTRACTS.POSITION_MANAGER,
    abi: POSITION_MANAGER_ABI,
    functionName: 'getPositionLiquidity',
    args: [argv.tokenId],
  });

  console.log(`Current liquidity: ${liquidity.toString()}`);

  if (liquidity === 0n) {
    console.error('❌ Position has no liquidity');
    process.exit(1);
  }

  // Calculate liquidity to remove
  const liquidityToRemove = (liquidity * BigInt(argv.percent)) / 100n;
  console.log(`Removing: ${liquidityToRemove.toString()} (${argv.percent}%)`);

  // Get pool info
  const [poolKey] = await publicClient.readContract({
    address: CONTRACTS.POSITION_MANAGER,
    abi: POSITION_MANAGER_ABI,
    functionName: 'getPoolAndPositionInfo',
    args: [argv.tokenId],
  });

  console.log(`Pool: ${poolKey.currency0} / ${poolKey.currency1}`);

  if (argv.dryRun) {
    console.log('\n✅ Dry run complete');
    return;
  }

  console.log('\n🔥 Removing liquidity...');

  // Build actions - if 100%, also burn the NFT
  const burnPosition = argv.percent === 100;
  let actionsHex;
  if (burnPosition) {
    actionsHex = '0x' + 
      Actions.DECREASE_LIQUIDITY.toString(16).padStart(2, '0') +
      Actions.BURN_POSITION.toString(16).padStart(2, '0') +
      Actions.TAKE_PAIR.toString(16).padStart(2, '0');
  } else {
    actionsHex = '0x' + 
      Actions.DECREASE_LIQUIDITY.toString(16).padStart(2, '0') +
      Actions.TAKE_PAIR.toString(16).padStart(2, '0');
  }

  // DECREASE_LIQUIDITY params: tokenId, liquidityDelta, amount0Min, amount1Min, hookData
  const decreaseParams = defaultAbiCoder.encode(
    ['uint256', 'uint256', 'uint128', 'uint128', 'bytes'],
    [
      argv.tokenId,
      liquidityToRemove.toString(),
      0,  // amount0Min (add slippage protection in production)
      0,  // amount1Min
      '0x', // hookData
    ]
  );

  // BURN_POSITION params (if burning): tokenId
  const burnParams = burnPosition 
    ? defaultAbiCoder.encode(['uint256'], [argv.tokenId])
    : null;

  // TAKE_PAIR params: currency0, currency1, recipient (use MSG_SENDER = address(1))
  const takeParams = defaultAbiCoder.encode(
    ['address', 'address', 'address'],
    [poolKey.currency0, poolKey.currency1, account.address]
  );

  // Build params array
  const paramsArray = burnPosition
    ? [decreaseParams, burnParams, takeParams]
    : [decreaseParams, takeParams];

  // Build unlockData
  const unlockData = defaultAbiCoder.encode(
    ['bytes', 'bytes[]'],
    [actionsHex, paramsArray]
  );

  const deadline = Math.floor(Date.now() / 1000) + 1800;

  try {
    const hash = await walletClient.writeContract({
      address: CONTRACTS.POSITION_MANAGER,
      abi: POSITION_MANAGER_ABI,
      functionName: 'modifyLiquidities',
      args: [unlockData, deadline],
    });

    console.log(`\n⏳ Transaction sent: ${hash}`);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });

    if (receipt.status === 'success') {
      console.log(`\n✅ Liquidity removed successfully!`);
      if (burnPosition) {
        console.log('🔥 Position NFT burned');
      }
      console.log(`Gas used: ${receipt.gasUsed}`);
      console.log(`\nView on BaseScan: https://basescan.org/tx/${hash}`);
    } else {
      console.error('❌ Transaction failed');
      process.exit(1);
    }
  } catch (error) {
    console.error('❌ Error:', error.shortMessage || error.message);
    if (error.signature) {
      console.error('Error signature:', error.signature);
    }
    process.exit(1);
  }
}

main().catch(console.error);
