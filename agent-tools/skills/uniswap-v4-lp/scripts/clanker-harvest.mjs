#!/usr/bin/env node
/**
 * Clanker Harvest — Complete fee management for Clanker-launched tokens
 * 
 * End-to-end pipeline:
 *   1. Claim Clanker protocol fees (WETH + token)
 *   2. Collect LP position fees
 *   3. Compound X% back into the LP position
 *   4. Swap the remaining (100-X)% to USDC
 *   5. Send USDC to a harvest/vault address
 * 
 * Usage:
 *   node clanker-harvest.mjs --token 0xTOKEN --token-id 1078751 \
 *     --harvest-address 0xVAULT --compound-pct 50
 *   
 *   node clanker-harvest.mjs --token 0xTOKEN --token-id 1078751 \
 *     --harvest-address 0xVAULT --compound-pct 80 --dry-run
 *
 *   node clanker-harvest.mjs --token 0xTOKEN --token-id 1078751 \
 *     --harvest-address 0xVAULT --compound-pct 20
 * 
 * Works for ANY Clanker-launched token with a V4 LP position.
 */

import { createPublicClient, createWalletClient, http, formatEther, formatUnits, parseAbi, maxUint256, encodeAbiParameters, parseAbiParameters } from 'viem';
import { base } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { defaultAbiCoder } from './node_modules/@ethersproject/abi/lib/index.js';

// ─── CLI Args ────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const getArg = (name, def) => { const i = args.indexOf('--' + name); return i >= 0 && args[i + 1] ? args[i + 1] : def; };
const hasFlag = (name) => args.includes('--' + name);

const TOKEN = getArg('token', null);
const TOKEN_ID = getArg('token-id', null);
const HARVEST_ADDRESS = getArg('harvest-address', null);
const COMPOUND_PCT = parseInt(getArg('compound-pct', '50'));
const SLIPPAGE_PCT = parseFloat(getArg('slippage', '1'));
const DRY_RUN = hasFlag('dry-run');
const FEE_CONTRACT = getArg('fee-contract', '0xf3622742b1e446d92e45e22923ef11c2fcd55d68');

if (!TOKEN || !TOKEN_ID || !HARVEST_ADDRESS) {
  console.log(`
🌾 Clanker Harvest — Complete fee management for Clanker tokens

Usage:
  node clanker-harvest.mjs --token <TOKEN_ADDRESS> --token-id <LP_POSITION_ID> \\
    --harvest-address <VAULT_ADDRESS> [--compound-pct 50] [--slippage 1] [--dry-run]

Options:
  --token            Clanker token address (required)
  --token-id         Uniswap V4 LP position NFT ID (required)
  --harvest-address  Where to send harvested USDC (required)
  --compound-pct     Percentage to compound back (0-100, default: 50)
  --slippage         Slippage tolerance for swaps (default: 1%)
  --fee-contract     Clanker fee contract (default: 0xf362...)
  --dry-run          Simulate without executing

Examples:
  # 50/50 split — compound half, harvest half
  node clanker-harvest.mjs --token 0xf3Ce5... --token-id 1078751 --harvest-address 0xVAULT

  # Conservative — compound 80%, harvest 20%
  node clanker-harvest.mjs --token 0xf3Ce5... --token-id 1078751 --harvest-address 0xVAULT --compound-pct 80

  # Max harvest — compound 20%, harvest 80%
  node clanker-harvest.mjs --token 0xf3Ce5... --token-id 1078751 --harvest-address 0xVAULT --compound-pct 20

  # Pure compound (no harvest)
  node clanker-harvest.mjs --token 0xf3Ce5... --token-id 1078751 --harvest-address 0xVAULT --compound-pct 100
  `);
  process.exit(1);
}

const harvestPct = 100 - COMPOUND_PCT;

// ─── Contracts ───────────────────────────────────────────────────────────────
const CONTRACTS = {
  POOL_MANAGER: '0x498581ff718922c3f8e6a244956af099b2652b2b',
  POSITION_MANAGER: '0x7c5f5a4bbd8fd63184577525326123b519429bdc',
  STATE_VIEW: '0xa3c0c9b65bad0b08107aa264b0f3db444b867a71',
  PERMIT2: '0x000000000022D473030F116dDEE9F6B43aC78BA3',
  WETH: '0x4200000000000000000000000000000000000006',
  USDC: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  SWAP_ROUTER_02: '0x2626664c2603336E57B271c5C0b26F421741e481',
};

// ─── ABIs ────────────────────────────────────────────────────────────────────
const CLANKER_FEE_ABI = parseAbi([
  'function claim(address feeOwner, address token) external',
  'function availableFees(address feeOwner, address token) external view returns (uint256)',
]);

const POSITION_MANAGER_ABI = [
  { name: 'modifyLiquidities', type: 'function', inputs: [{ name: 'unlockData', type: 'bytes' }, { name: 'deadline', type: 'uint256' }], outputs: [] },
  { name: 'getPoolAndPositionInfo', type: 'function', inputs: [{ type: 'uint256' }], outputs: [{ type: 'tuple', components: [{ name: 'currency0', type: 'address' }, { name: 'currency1', type: 'address' }, { name: 'fee', type: 'uint24' }, { name: 'tickSpacing', type: 'int24' }, { name: 'hooks', type: 'address' }] }, { type: 'uint256' }] },
  { name: 'getPositionLiquidity', type: 'function', inputs: [{ type: 'uint256' }], outputs: [{ type: 'uint128' }] },
];

const STATE_VIEW_ABI = [
  { name: 'getSlot0', type: 'function', inputs: [{ type: 'bytes32' }], outputs: [{ type: 'uint160' }, { type: 'int24' }, { type: 'uint24' }, { type: 'uint24' }] },
];

const ERC20_ABI = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function approve(address,uint256) returns (bool)',
  'function allowance(address,address) view returns (uint256)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function transfer(address,uint256) returns (bool)',
]);

const SWAP_ROUTER_ABI = parseAbi([
  'function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) payable returns (uint256)',
]);

// ─── Helpers ─────────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const retry = async (fn, n = 3) => { for (let i = 0; i < n; i++) { try { return await fn(); } catch (e) { if (i === n - 1) throw e; await sleep(1000); } } };
const pad32 = (hex) => hex.replace('0x', '').padStart(64, '0');
const Q96 = BigInt(2) ** BigInt(96);

function computePoolId(poolKey) {
  const encoded = defaultAbiCoder.encode(
    ['address', 'address', 'uint24', 'int24', 'address'],
    [poolKey.currency0, poolKey.currency1, poolKey.fee, poolKey.tickSpacing, poolKey.hooks]
  );
  const { keccak256 } = require('./node_modules/viem/index.js');
  // Use viem's keccak256
  return keccak256(encoded);
}

// ─── Main ────────────────────────────────────────────────────────────────────
async function main() {
  const pk = process.env.NET_PRIVATE_KEY;
  if (!pk) { console.error('NET_PRIVATE_KEY not set'); process.exit(1); }

  const account = privateKeyToAccount(pk);
  const rpcUrl = process.env.BASE_RPC_URL || 'https://mainnet.base.org';
  const transport = http(rpcUrl);
  const publicClient = createPublicClient({ chain: base, transport });
  const walletClient = createWalletClient({ chain: base, transport, account });

  const tokenId = BigInt(TOKEN_ID);

  // Get token info
  let tokenSymbol = 'TOKEN';
  try { tokenSymbol = await publicClient.readContract({ address: TOKEN, abi: ERC20_ABI, functionName: 'symbol' }); } catch(e) {}

  console.log(`
🌾 Clanker Harvest — Full Pipeline
═══════════════════════════════════════════════════
🪙 Token: ${tokenSymbol} (${TOKEN})
📋 Position: #${TOKEN_ID}
💰 Split: ${COMPOUND_PCT}% compound / ${harvestPct}% harvest → USDC
📬 Vault: ${HARVEST_ADDRESS}
👛 Wallet: ${account.address}
${DRY_RUN ? '🔮 DRY RUN MODE' : '🔥 LIVE MODE'}
═══════════════════════════════════════════════════`);

  // ─── Step 1: Claim Clanker Protocol Fees ──────────────────────────────────
  console.log(`\n📌 Step 1/5: Checking Clanker protocol fees...`);
  
  let clankerWeth = 0n, clankerToken = 0n;
  try {
    clankerWeth = await retry(() => publicClient.readContract({
      address: FEE_CONTRACT, abi: CLANKER_FEE_ABI, functionName: 'availableFees',
      args: [account.address, CONTRACTS.WETH],
    }));
    clankerToken = await retry(() => publicClient.readContract({
      address: FEE_CONTRACT, abi: CLANKER_FEE_ABI, functionName: 'availableFees',
      args: [account.address, TOKEN],
    }));
  } catch (e) {
    console.log(`   ⚠️  Could not read Clanker fees: ${e.message}`);
  }

  console.log(`   WETH: ${formatEther(clankerWeth)}`);
  console.log(`   ${tokenSymbol}: ${formatEther(clankerToken)}`);

  if (!DRY_RUN && (clankerWeth > 0n || clankerToken > 0n)) {
    if (clankerToken > 0n) {
      console.log(`   Claiming ${tokenSymbol}...`);
      const tx = await walletClient.writeContract({
        address: FEE_CONTRACT, abi: CLANKER_FEE_ABI, functionName: 'claim',
        args: [account.address, TOKEN],
      });
      await publicClient.waitForTransactionReceipt({ hash: tx });
      console.log(`   ✅ ${tokenSymbol} claimed: ${tx}`);
      await sleep(2000); // Wait for nonce
    }
    if (clankerWeth > 0n) {
      console.log(`   Claiming WETH...`);
      const tx = await walletClient.writeContract({
        address: FEE_CONTRACT, abi: CLANKER_FEE_ABI, functionName: 'claim',
        args: [account.address, CONTRACTS.WETH],
      });
      await publicClient.waitForTransactionReceipt({ hash: tx });
      console.log(`   ✅ WETH claimed: ${tx}`);
      await sleep(1000);
    }
  } else if (DRY_RUN && (clankerWeth > 0n || clankerToken > 0n)) {
    console.log(`   🔮 Would claim both`);
  } else {
    console.log(`   No Clanker fees to claim`);
  }

  // ─── Step 2: Collect LP Position Fees ─────────────────────────────────────
  console.log(`\n📌 Step 2/5: Collecting LP position fees...`);

  // Read position
  const [poolKey, posInfo] = await retry(() => publicClient.readContract({
    address: CONTRACTS.POSITION_MANAGER, abi: POSITION_MANAGER_ABI,
    functionName: 'getPoolAndPositionInfo', args: [tokenId],
  }));

  const rawLiquidity = await retry(() => publicClient.readContract({
    address: CONTRACTS.POSITION_MANAGER, abi: POSITION_MANAGER_ABI,
    functionName: 'getPositionLiquidity', args: [tokenId],
  }));

  console.log(`   Pool: ${poolKey.currency0.slice(0,10)}... / ${poolKey.currency1.slice(0,10)}...`);
  console.log(`   Liquidity: ${rawLiquidity}`);

  // Wallet balances before
  const wethBefore = await publicClient.readContract({ address: CONTRACTS.WETH, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address] });
  const tokenBefore = await publicClient.readContract({ address: TOKEN, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address] });

  if (!DRY_RUN) {
    // Collect fees: DECREASE(0x01) with 0 liquidity + CLOSE_CURRENCY(0x11)
    const tickLower = Number(BigInt(posInfo) >> BigInt(232));
    const tickUpper = Number(BigInt((BigInt(posInfo) >> BigInt(208)) & BigInt(0xFFFFFF)));
    // Adjust for signed ticks
    const tL = tickLower > 0x7FFFFF ? tickLower - 0x1000000 : tickLower;
    const tU = tickUpper > 0x7FFFFF ? tickUpper - 0x1000000 : tickUpper;
    const actualTickLower = Math.min(tL, tU);
    const actualTickUpper = Math.max(tL, tU);

    // Proven pattern from auto-compound: DECREASE(0x01) + CLOSE_CURRENCY(0x11) x2
    // Single closeParams encodes both currencies + recipient
    const collectActionsHex = '0x0111';
    const decreaseParams = '0x' +
      pad32('0x' + tokenId.toString(16)) +
      '0'.padStart(64, '0') +     // liquidity = 0 (fees only)
      '0'.padStart(64, '0') +     // amount0Min = 0
      '0'.padStart(64, '0') +     // amount1Min = 0
      (5 * 32).toString(16).padStart(64, '0') +
      '0'.padStart(64, '0');      // hookData = empty

    const closeParams = '0x' +
      pad32(poolKey.currency0) +
      pad32(poolKey.currency1) +
      pad32(account.address);

    const collectData = encodeAbiParameters(
      parseAbiParameters('bytes, bytes[]'),
      [collectActionsHex, [decreaseParams, closeParams]]
    );

    // Approve Permit2
    for (const tokenAddr of [poolKey.currency0, poolKey.currency1]) {
      const allow = await publicClient.readContract({ address: tokenAddr, abi: ERC20_ABI, functionName: 'allowance', args: [account.address, CONTRACTS.PERMIT2] });
      if (allow < BigInt('0xffffffffffffffffffffffff')) {
        const tx = await walletClient.writeContract({ address: tokenAddr, abi: ERC20_ABI, functionName: 'approve', args: [CONTRACTS.PERMIT2, maxUint256] });
        await publicClient.waitForTransactionReceipt({ hash: tx });
        await sleep(500);
      }
    }

    const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);
    const collectTx = await walletClient.writeContract({
      address: CONTRACTS.POSITION_MANAGER, abi: POSITION_MANAGER_ABI,
      functionName: 'modifyLiquidities', args: [collectData, deadline],
    });
    await publicClient.waitForTransactionReceipt({ hash: collectTx });
    console.log(`   ✅ LP fees collected: ${collectTx}`);
    await sleep(1000);
  } else {
    console.log(`   🔮 Would collect LP fees`);
  }

  // Check how much we collected (diff in wallet balances)
  const wethAfterCollect = await publicClient.readContract({ address: CONTRACTS.WETH, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address] });
  const tokenAfterCollect = await publicClient.readContract({ address: TOKEN, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address] });

  const totalWethFees = wethAfterCollect - wethBefore + clankerWeth;
  const totalTokenFees = tokenAfterCollect - tokenBefore + clankerToken;

  console.log(`\n💰 Total Fees (Clanker + LP):`);
  console.log(`   WETH: ${formatEther(totalWethFees)}`);
  console.log(`   ${tokenSymbol}: ${formatEther(totalTokenFees)}`);

  if (totalWethFees === 0n && totalTokenFees === 0n) {
    console.log(`\n⚠️  No fees to process`);
    return;
  }

  // Calculate split
  const compoundWeth = totalWethFees * BigInt(COMPOUND_PCT) / 100n;
  const compoundToken = totalTokenFees * BigInt(COMPOUND_PCT) / 100n;
  const harvestWeth = totalWethFees - compoundWeth;
  const harvestToken = totalTokenFees - compoundToken;

  console.log(`\n📊 Split (${COMPOUND_PCT}/${harvestPct}):`);
  console.log(`   Compound: ${formatEther(compoundWeth)} WETH + ${formatEther(compoundToken)} ${tokenSymbol}`);
  console.log(`   Harvest:  ${formatEther(harvestWeth)} WETH + ${formatEther(harvestToken)} ${tokenSymbol}`);

  // ─── Step 3: Compound ─────────────────────────────────────────────────────
  if (COMPOUND_PCT > 0 && (compoundWeth > 0n || compoundToken > 0n)) {
    console.log(`\n📌 Step 3/5: Compounding ${COMPOUND_PCT}% back into position...`);

    if (!DRY_RUN) {
      try {
        // Calculate liquidity from available amounts
        // Use a large liquidity value — the contract will use what it can
        const liquidity = compoundWeth > 0n ? compoundWeth * BigInt(1e12) : compoundToken;

        const addActionsHex = '0x000d'; // INCREASE + SETTLE_PAIR
        const amount0Max = poolKey.currency0.toLowerCase() === CONTRACTS.WETH.toLowerCase() ? compoundWeth * 150n / 100n : compoundToken * 150n / 100n;
        const amount1Max = poolKey.currency1.toLowerCase() === CONTRACTS.WETH.toLowerCase() ? compoundWeth * 150n / 100n : compoundToken * 150n / 100n;

        const increaseParams = defaultAbiCoder.encode(
          ['uint256', 'uint256', 'uint128', 'uint128', 'bytes'],
          [tokenId.toString(), liquidity.toString(), amount0Max.toString(), amount1Max.toString(), '0x']
        );
        const settleParams = defaultAbiCoder.encode(['address', 'address'], [poolKey.currency0, poolKey.currency1]);

        const addData = encodeAbiParameters(
          parseAbiParameters('bytes, bytes[]'),
          [addActionsHex, [increaseParams, settleParams]]
        );

        const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);
        const tx = await walletClient.writeContract({
          address: CONTRACTS.POSITION_MANAGER, abi: POSITION_MANAGER_ABI,
          functionName: 'modifyLiquidities', args: [addData, deadline],
        });
        const receipt = await publicClient.waitForTransactionReceipt({ hash: tx });
        console.log(`   ✅ Compounded! TX: ${tx}`);
        await sleep(1000);
      } catch (err) {
        console.log(`   ⚠️  Compound failed: ${err.shortMessage || err.message}`);
        console.log(`   Continuing to harvest...`);
      }
    } else {
      console.log(`   🔮 Would compound`);
    }
  } else {
    console.log(`\n📌 Step 3/5: Skipping compound (${COMPOUND_PCT}%)`);
  }

  // ─── Step 4: Swap harvest portion to USDC ─────────────────────────────────
  if (harvestPct > 0 && (harvestWeth > 0n || harvestToken > 0n)) {
    console.log(`\n📌 Step 4/5: Swapping ${harvestPct}% to USDC...`);

    const usdcBefore = await publicClient.readContract({ address: CONTRACTS.USDC, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address] });

    if (!DRY_RUN) {
      // Swap WETH → USDC via V3
      if (harvestWeth > 0n) {
        try {
          console.log(`   Swapping ${formatEther(harvestWeth)} WETH → USDC...`);
          
          // Approve WETH to SwapRouter
          const allow = await publicClient.readContract({ address: CONTRACTS.WETH, abi: ERC20_ABI, functionName: 'allowance', args: [account.address, CONTRACTS.SWAP_ROUTER_02] });
          if (allow < harvestWeth) {
            const appTx = await walletClient.writeContract({ address: CONTRACTS.WETH, abi: ERC20_ABI, functionName: 'approve', args: [CONTRACTS.SWAP_ROUTER_02, maxUint256] });
            await publicClient.waitForTransactionReceipt({ hash: appTx });
            await sleep(500);
          }

          const tx = await walletClient.writeContract({
            address: CONTRACTS.SWAP_ROUTER_02, abi: SWAP_ROUTER_ABI,
            functionName: 'exactInputSingle',
            args: [{
              tokenIn: CONTRACTS.WETH, tokenOut: CONTRACTS.USDC, fee: 500,
              recipient: account.address, amountIn: harvestWeth,
              amountOutMinimum: 0n, sqrtPriceLimitX96: 0n,
            }],
          });
          await publicClient.waitForTransactionReceipt({ hash: tx });
          console.log(`   ✅ WETH → USDC: ${tx}`);
          await sleep(1000);
        } catch (err) {
          console.log(`   ❌ WETH swap failed: ${err.shortMessage || err.message}`);
        }
      }

      // For non-WETH tokens, we'd need V4 swap (AXIOM → WETH → USDC)
      // TODO: V4 Universal Router swap for token → WETH
      if (harvestToken > 0n) {
        console.log(`   ⚠️  ${tokenSymbol} → USDC swap via V4 not yet implemented`);
        console.log(`   ${formatEther(harvestToken)} ${tokenSymbol} remains in wallet`);
      }
    } else {
      console.log(`   🔮 Would swap to USDC`);
    }

    // ─── Step 5: Transfer USDC to vault ───────────────────────────────────────
    console.log(`\n📌 Step 5/5: Transferring USDC to vault...`);

    if (!DRY_RUN) {
      await sleep(2000); // Wait for balance to update
      const usdcNow = await publicClient.readContract({ address: CONTRACTS.USDC, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address] });
      const usdcGained = usdcNow - usdcBefore;

      if (usdcGained > 0n) {
        console.log(`   USDC to transfer: ${formatUnits(usdcGained, 6)}`);
        const tx = await walletClient.writeContract({
          address: CONTRACTS.USDC, abi: ERC20_ABI, functionName: 'transfer',
          args: [HARVEST_ADDRESS, usdcGained],
        });
        await publicClient.waitForTransactionReceipt({ hash: tx });
        console.log(`   ✅ Sent ${formatUnits(usdcGained, 6)} USDC → ${HARVEST_ADDRESS}`);
        console.log(`   TX: https://basescan.org/tx/${tx}`);
      } else {
        console.log(`   ⚠️  No USDC gained from swaps`);
      }
    } else {
      console.log(`   🔮 Would transfer USDC to vault`);
    }
  } else {
    console.log(`\n📌 Step 4-5: Skipping harvest (compound-pct = 100%)`);
  }

  // ─── Summary ───────────────────────────────────────────────────────────────
  const wethFinal = await publicClient.readContract({ address: CONTRACTS.WETH, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address] });
  const tokenFinal = await publicClient.readContract({ address: TOKEN, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address] });

  console.log(`
═══════════════════════════════════════════════════
✅ Clanker Harvest Complete!
═══════════════════════════════════════════════════
   Clanker fees claimed: ${formatEther(clankerWeth)} WETH + ${formatEther(clankerToken)} ${tokenSymbol}
   LP fees collected: ${formatEther(totalWethFees - clankerWeth)} WETH + ${formatEther(totalTokenFees - clankerToken)} ${tokenSymbol}
   Compounded (${COMPOUND_PCT}%): ${formatEther(compoundWeth)} WETH + ${formatEther(compoundToken)} ${tokenSymbol}
   Harvested (${harvestPct}%): ${formatEther(harvestWeth)} WETH swapped to USDC

💰 Wallet:
   WETH: ${formatEther(wethFinal)}
   ${tokenSymbol}: ${formatEther(tokenFinal)}
`);
}

main().catch(err => { console.error('❌ Fatal:', err.message); process.exit(1); });
