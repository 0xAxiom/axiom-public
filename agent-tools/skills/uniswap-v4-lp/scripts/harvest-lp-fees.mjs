#!/usr/bin/env node
/**
 * Harvest LP Fees → Treasury
 * 
 * 1. Collect accrued fees from V4 LP position (WETH + AXIOM)
 * 2. Swap all AXIOM → WETH
 * 3. Split WETH: 50% → USDC, 50% → BNKR
 * 4. Send USDC + BNKR to treasury
 * 
 * Usage:
 *   node harvest-lp-fees.mjs --token-id 1401418
 *   node harvest-lp-fees.mjs --token-id 1401418 --dry-run
 */

import { createPublicClient, createWalletClient, http, formatEther, formatUnits, maxUint256, keccak256, encodeAbiParameters, parseAbiParameters } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base } from 'viem/chains';
import { defaultAbiCoder } from '@ethersproject/abi';
import * as dotenv from 'dotenv';
import { resolve } from 'path';
import minimist from 'minimist';

dotenv.config({ path: resolve(process.env.HOME, '.axiom/wallet.env') });

const argv = minimist(process.argv.slice(2), {
  string: ['token-id', 'treasury'],
  boolean: ['dry-run'],
  default: {
    'treasury': '0x19fe674a83e98c44ad4c2172e006c542b8e8fe08',
    'dry-run': false,
  },
});
argv.tokenId = argv['token-id'];
argv.dryRun = argv['dry-run'];

if (!argv.tokenId) {
  console.error('Usage: node harvest-lp-fees.mjs --token-id <id> [--dry-run] [--treasury <addr>]');
  process.exit(1);
}

const CONTRACTS = {
  POSITION_MANAGER: '0x7c5f5a4bbd8fd63184577525326123b519429bdc',
  STATE_VIEW: '0xa3c0c9b65bad0b08107aa264b0f3db444b867a71',
  PERMIT2: '0x000000000022D473030F116dDEE9F6B43aC78BA3',
  UNIVERSAL_ROUTER: '0x6ff5693b99212da76ad316178a184ab56d299b43',
  WETH: '0x4200000000000000000000000000000000000006',
  AXIOM: '0xf3Ce5dDAAb6C133F9875a4a46C55cf0b58111B07',
  USDC: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  BNKR: '0x22aF33FE49fD1Fa80c7149773dDe5890D3c76F3b',
};

const POOL_KEY = {
  currency0: '0x4200000000000000000000000000000000000006',
  currency1: '0xf3ce5ddaab6c133f9875a4a46c55cf0b58111b07',
  fee: 8388608,  // DYNAMIC fee — must match on-chain pool key
  tickSpacing: 200,
  hooks: '0xb429d62f8f3bffb98cdb9569533ea23bf0ba28cc',
};

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ABIs
const ERC20_ABI = [
  { type: 'function', name: 'balanceOf', inputs: [{ name: '', type: 'address' }], outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'approve', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ name: '', type: 'bool' }], stateMutability: 'nonpayable' },
  { type: 'function', name: 'allowance', inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }], outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'transfer', inputs: [{ name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ name: '', type: 'bool' }], stateMutability: 'nonpayable' },
  { type: 'function', name: 'decimals', inputs: [], outputs: [{ name: '', type: 'uint8' }], stateMutability: 'view' },
];

const POSITION_MANAGER_ABI = [
  { type: 'function', name: 'modifyLiquidities', inputs: [{ name: 'unlockData', type: 'bytes' }, { name: 'deadline', type: 'uint256' }], outputs: [], stateMutability: 'payable' },
  { type: 'function', name: 'getPoolAndPositionInfo', inputs: [{ name: 'tokenId', type: 'uint256' }], outputs: [{ name: 'poolKey', type: 'tuple', components: [{ name: 'currency0', type: 'address' }, { name: 'currency1', type: 'address' }, { name: 'fee', type: 'uint24' }, { name: 'tickSpacing', type: 'int24' }, { name: 'hooks', type: 'address' }] }, { name: 'info', type: 'bytes32' }], stateMutability: 'view' },
  { type: 'function', name: 'getPositionLiquidity', inputs: [{ name: 'tokenId', type: 'uint256' }], outputs: [{ name: 'liquidity', type: 'uint128' }], stateMutability: 'view' },
];

const PERMIT2_ABI = [
  { type: 'function', name: 'allowance', inputs: [{ name: 'owner', type: 'address' }, { name: 'token', type: 'address' }, { name: 'spender', type: 'address' }], outputs: [{ name: 'amount', type: 'uint160' }, { name: 'expiration', type: 'uint48' }, { name: 'nonce', type: 'uint48' }], stateMutability: 'view' },
  { type: 'function', name: 'approve', inputs: [{ name: 'token', type: 'address' }, { name: 'spender', type: 'address' }, { name: 'amount', type: 'uint160' }, { name: 'expiration', type: 'uint48' }], outputs: [], stateMutability: 'nonpayable' },
];

const UNIVERSAL_ROUTER_ABI = [
  { type: 'function', name: 'execute', inputs: [{ name: 'commands', type: 'bytes' }, { name: 'inputs', type: 'bytes[]' }, { name: 'deadline', type: 'uint256' }], outputs: [], stateMutability: 'payable' },
];

async function retry(fn, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try { return await fn(); } catch (e) {
      if (i === maxRetries - 1) throw e;
      await sleep(2000 * (i + 1));
    }
  }
}

async function ensurePermit2(publicClient, walletClient, account, token, spender, amount, label) {
  const allowance = await retry(() => publicClient.readContract({ address: token, abi: ERC20_ABI, functionName: 'allowance', args: [account.address, CONTRACTS.PERMIT2] }));
  if (allowance < amount) {
    console.log(`   Approving ${label} → Permit2...`);
    const tx = await walletClient.writeContract({ address: token, abi: ERC20_ABI, functionName: 'approve', args: [CONTRACTS.PERMIT2, maxUint256] });
    await publicClient.waitForTransactionReceipt({ hash: tx });
    await sleep(1000);
  }
  const [permit2Amt] = await retry(() => publicClient.readContract({ address: CONTRACTS.PERMIT2, abi: PERMIT2_ABI, functionName: 'allowance', args: [account.address, token, spender] }));
  if (BigInt(permit2Amt) < amount) {
    console.log(`   Approving ${label} on Permit2 → ${spender.slice(0,10)}...`);
    const maxU160 = (1n << 160n) - 1n;
    const maxU48 = (1n << 48n) - 1n;
    const tx = await walletClient.writeContract({ address: CONTRACTS.PERMIT2, abi: PERMIT2_ABI, functionName: 'approve', args: [token, spender, maxU160, maxU48] });
    await publicClient.waitForTransactionReceipt({ hash: tx });
    await sleep(1000);
  }
}

async function swapV4(publicClient, walletClient, account, poolKey, zeroForOne, amountIn) {
  const inputToken = zeroForOne ? poolKey.currency0 : poolKey.currency1;
  const outputToken = zeroForOne ? poolKey.currency1 : poolKey.currency0;

  await ensurePermit2(publicClient, walletClient, account, inputToken, CONTRACTS.UNIVERSAL_ROUTER, amountIn, zeroForOne ? 'WETH' : 'AXIOM');

  // Proven V4 swap pattern: 0x06 (V4_SWAP) + 0x0c (SETTLE) + 0x0f (TAKE)
  const swapParams = defaultAbiCoder.encode(
    ['tuple(tuple(address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) poolKey, bool zeroForOne, uint128 amountIn, uint128 amountOutMinimum, bytes hookData)'],
    [{
      poolKey: { currency0: poolKey.currency0, currency1: poolKey.currency1, fee: poolKey.fee, tickSpacing: Number(poolKey.tickSpacing), hooks: poolKey.hooks },
      zeroForOne,
      amountIn: amountIn.toString(),
      amountOutMinimum: '0',
      hookData: '0x',
    }]
  );
  const settleParams = defaultAbiCoder.encode(['address', 'uint256'], [inputToken, amountIn.toString()]);
  const takeParams = defaultAbiCoder.encode(['address', 'uint256'], [outputToken, '0']);
  const v4SwapInput = defaultAbiCoder.encode(['bytes', 'bytes[]'], ['0x060c0f', [swapParams, settleParams, takeParams]]);
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 1800);

  const hash = await walletClient.writeContract({
    address: CONTRACTS.UNIVERSAL_ROUTER,
    abi: [{ type: 'function', name: 'execute', inputs: [{ name: 'commands', type: 'bytes' }, { name: 'inputs', type: 'bytes[]' }, { name: 'deadline', type: 'uint256' }], outputs: [], stateMutability: 'payable' }],
    functionName: 'execute',
    args: ['0x10', [v4SwapInput], deadline],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') throw new Error(`Swap reverted: ${hash}`);
  return hash;
}

// Swap WETH → token via Uniswap V3 (for USDC and BNKR)
async function swapV3(publicClient, walletClient, account, tokenOut, amountIn, fee = 3000) {
  await ensurePermit2(publicClient, walletClient, account, CONTRACTS.WETH, CONTRACTS.UNIVERSAL_ROUTER, amountIn, 'WETH');

  // V3_SWAP_EXACT_IN command = 0x00
  const path = CONTRACTS.WETH.slice(2).toLowerCase() +
    fee.toString(16).padStart(6, '0') +
    tokenOut.slice(2).toLowerCase();

  const v3Params = defaultAbiCoder.encode(
    ['address', 'uint256', 'uint256', 'bytes', 'bool'],
    [account.address, amountIn.toString(), '0', '0x' + path, true]  // payerIsUser = true
  );

  const deadline = BigInt(Math.floor(Date.now() / 1000) + 1800);
  const hash = await walletClient.writeContract({
    address: CONTRACTS.UNIVERSAL_ROUTER,
    abi: UNIVERSAL_ROUTER_ABI,
    functionName: 'execute',
    args: ['0x00', [v3Params], deadline],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') throw new Error(`V3 swap reverted: ${hash}`);
  return hash;
}

async function main() {
  const privateKey = process.env.NET_PRIVATE_KEY || process.env.PRIVATE_KEY;
  if (!privateKey) { console.error('❌ No private key'); process.exit(1); }

  const account = privateKeyToAccount(privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`);
  const rpcUrl = process.env.BASE_RPC_URL || 'https://mainnet.base.org';

  const publicClient = createPublicClient({ chain: base, transport: http(rpcUrl) });
  const walletClient = createWalletClient({ chain: base, transport: http(rpcUrl), account });

  const tokenId = BigInt(argv.tokenId);

  console.log(`💰 Harvest LP Fees → Treasury`);
  console.log(`   Position: #${tokenId}`);
  console.log(`   Treasury: ${argv.treasury}`);
  console.log(`   ${argv.dryRun ? '🔮 DRY RUN' : '⚡ LIVE'}`);
  console.log('═'.repeat(60));

  // ─── 1. Collect fees ─────────────────────────────────────────────────────
  console.log('\n📥 Step 1: Collecting LP fees...');

  const [wethBefore, axiomBefore] = await Promise.all([
    retry(() => publicClient.readContract({ address: CONTRACTS.WETH, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address] })),
    retry(() => publicClient.readContract({ address: CONTRACTS.AXIOM, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address] })),
  ]);

  // DECREASE_LIQUIDITY(0) + TAKE_PAIR → collects fees only
  const collectActionsHex = '0x0111';
  const decreaseParams = defaultAbiCoder.encode(
    ['uint256', 'uint256', 'uint128', 'uint128', 'bytes'],
    [tokenId.toString(), '0', '0', '0', '0x']
  );
  const takePairParams = defaultAbiCoder.encode(
    ['address', 'address', 'address'],
    [POOL_KEY.currency0, POOL_KEY.currency1, account.address]
  );
  const collectData = encodeAbiParameters(
    parseAbiParameters('bytes, bytes[]'),
    [collectActionsHex, [decreaseParams, takePairParams]]
  );
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 1800);

  if (argv.dryRun) {
    console.log('   🔮 Would collect fees (dry run)');
  } else {
    const collectHash = await walletClient.writeContract({
      address: CONTRACTS.POSITION_MANAGER,
      abi: POSITION_MANAGER_ABI,
      functionName: 'modifyLiquidities',
      args: [collectData, deadline],
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash: collectHash });
    if (receipt.status !== 'success') { console.error('❌ Fee collection failed'); process.exit(1); }
    console.log(`   ✅ Collected — TX: https://basescan.org/tx/${collectHash}`);
    await sleep(2000);
  }

  const [wethAfter, axiomAfter] = await Promise.all([
    retry(() => publicClient.readContract({ address: CONTRACTS.WETH, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address] })),
    retry(() => publicClient.readContract({ address: CONTRACTS.AXIOM, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address] })),
  ]);

  const feesWeth = argv.dryRun ? 0n : (wethAfter > wethBefore ? wethAfter - wethBefore : 0n);
  const feesAxiom = argv.dryRun ? 0n : (axiomAfter > axiomBefore ? axiomAfter - axiomBefore : 0n);

  console.log(`   Fees: ${formatEther(feesWeth)} WETH + ${formatEther(feesAxiom)} AXIOM`);

  if (feesWeth === 0n && feesAxiom === 0n) {
    console.log('\n✅ No fees to harvest. Done.');
    process.exit(0);
  }

  // ─── 2. Swap AXIOM → WETH ───────────────────────────────────────────────
  let totalWeth = feesWeth;
  if (feesAxiom > 10n ** 15n) { // only swap if > dust
    console.log(`\n🔄 Step 2: Swapping ${formatEther(feesAxiom)} AXIOM → WETH...`);
    if (!argv.dryRun) {
      const hash = await swapV4(publicClient, walletClient, account, POOL_KEY, false, feesAxiom);
      console.log(`   ✅ TX: https://basescan.org/tx/${hash}`);
      await sleep(2000);
      const wethNow = await retry(() => publicClient.readContract({ address: CONTRACTS.WETH, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address] }));
      totalWeth = wethNow - wethBefore; // net WETH gained from fees
      console.log(`   Total WETH from fees: ${formatEther(totalWeth)}`);
    }
  } else {
    console.log('\n   AXIOM fees too small to swap, using WETH only.');
  }

  if (totalWeth < 10n ** 14n) { // < 0.0001 WETH
    console.log('\n✅ Fees too small to split. Done.');
    process.exit(0);
  }

  // ─── 3. Split: 50% → USDC, 50% → BNKR ──────────────────────────────────
  const halfWeth = totalWeth / 2n;
  const otherHalf = totalWeth - halfWeth;

  console.log(`\n💱 Step 3: Splitting ${formatEther(totalWeth)} WETH...`);
  console.log(`   → ${formatEther(halfWeth)} WETH → USDC`);
  console.log(`   → ${formatEther(otherHalf)} WETH → BNKR`);

  if (!argv.dryRun) {
    // Swap WETH → USDC (V3, 500 fee tier for WETH/USDC)
    try {
      const usdcHash = await swapV3(publicClient, walletClient, account, CONTRACTS.USDC, halfWeth, 500);
      console.log(`   ✅ USDC swap: https://basescan.org/tx/${usdcHash}`);
    } catch (e) {
      console.log(`   ⚠️ USDC swap failed (${e.message}), trying 3000 fee tier...`);
      const usdcHash = await swapV3(publicClient, walletClient, account, CONTRACTS.USDC, halfWeth, 3000);
      console.log(`   ✅ USDC swap (3000): https://basescan.org/tx/${usdcHash}`);
    }
    await sleep(2000);

    // Swap WETH → BNKR (V3, try 10000 fee tier first for meme tokens)
    try {
      const bnkrHash = await swapV3(publicClient, walletClient, account, CONTRACTS.BNKR, otherHalf, 10000);
      console.log(`   ✅ BNKR swap: https://basescan.org/tx/${bnkrHash}`);
    } catch (e) {
      console.log(`   ⚠️ BNKR 10000 failed, trying 3000...`);
      try {
        const bnkrHash = await swapV3(publicClient, walletClient, account, CONTRACTS.BNKR, otherHalf, 3000);
        console.log(`   ✅ BNKR swap: https://basescan.org/tx/${bnkrHash}`);
      } catch (e2) {
        console.log(`   ❌ BNKR swap failed on all fee tiers. WETH stays in wallet.`);
      }
    }
    await sleep(2000);
  }

  // ─── 4. Send to treasury ─────────────────────────────────────────────────
  console.log(`\n📤 Step 4: Sending to treasury ${argv.treasury}...`);

  const [usdcBal, bnkrBal] = await Promise.all([
    retry(() => publicClient.readContract({ address: CONTRACTS.USDC, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address] })),
    retry(() => publicClient.readContract({ address: CONTRACTS.BNKR, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address] })),
  ]);

  if (!argv.dryRun) {
    if (usdcBal > 0n) {
      const tx = await walletClient.writeContract({ address: CONTRACTS.USDC, abi: ERC20_ABI, functionName: 'transfer', args: [argv.treasury, usdcBal] });
      await publicClient.waitForTransactionReceipt({ hash: tx });
      console.log(`   ✅ Sent ${formatUnits(usdcBal, 6)} USDC → treasury`);
    }
    if (bnkrBal > 0n) {
      const tx = await walletClient.writeContract({ address: CONTRACTS.BNKR, abi: ERC20_ABI, functionName: 'transfer', args: [argv.treasury, bnkrBal] });
      await publicClient.waitForTransactionReceipt({ hash: tx });
      console.log(`   ✅ Sent ${formatEther(bnkrBal)} BNKR → treasury`);
    }
  }

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`✅ HARVEST COMPLETE`);
  console.log(`   USDC sent: ${formatUnits(usdcBal, 6)}`);
  console.log(`   BNKR sent: ${formatEther(bnkrBal)}`);
  console.log(`   Treasury: ${argv.treasury}`);
  console.log('═'.repeat(60));
}

main().catch(e => { console.error('❌ Fatal:', e.message); process.exit(1); });
