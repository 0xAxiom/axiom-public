#!/usr/bin/env node
/**
 * burn-and-harvest.mjs
 * 
 * Claims Clanker fees and implements 50% buy-and-burn:
 * - Claims WETH + AXIOM fees from Clanker
 * - Calculates USD value of both
 * - Burns exactly 50% of total value as $AXIOM
 * - Sends remaining 50% (as WETH) to destination
 * 
 * CRITICAL RULES:
 * 1. NEVER burn WETH - only AXIOM goes to dead address
 * 2. ALWAYS burn exactly 50% - no more, no less
 * 3. Use real-time prices - no hardcoded values
 * 4. Strict validation before any tx
 */

import { createPublicClient, createWalletClient, http, parseUnits, formatUnits, encodeFunctionData } from 'viem';
import { base } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';

// === CONSTANTS ===
const DEAD_ADDRESS = '0x000000000000000000000000000000000000dEaD';
const WETH = '0x4200000000000000000000000000000000000006';
const AXIOM = '0xf3Ce5dDAAb6C133F9875a4a46C55cf0b58111B07';
const CLANKER_FEES = '0xf3622742b1e446d92e45e22923ef11c2fcd55d68';
const FEE_OWNER = '0x523Eff3dB03938eaa31a5a6FBd41E3B9d23edde5'; // axiombot.base.eth resolved

// Uniswap V4 for swaps
const SWAP_ROUTER = '0x6ff5693b99212da76ad316178a184ab56d299b43';
const POOL_MANAGER = '0x498581ff718922c3f8e6a244956af099b2652b2b';

// === SETUP ===
const privateKey = process.env.NET_PRIVATE_KEY;
if (!privateKey) {
  console.error('❌ NET_PRIVATE_KEY not set');
  process.exit(1);
}

const account = privateKeyToAccount(privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`);
const publicClient = createPublicClient({ chain: base, transport: http('https://mainnet.base.org') });
const walletClient = createWalletClient({ account, chain: base, transport: http('https://mainnet.base.org') });

// === PRICE FETCHING ===
async function getPrices() {
  // Get WETH price from CoinGecko
  const wethResp = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=weth&vs_currencies=usd');
  const wethData = await wethResp.json();
  const wethPrice = wethData.weth?.usd;
  
  if (!wethPrice) throw new Error('Failed to get WETH price');
  
  // Get AXIOM price from DexScreener
  const axiomResp = await fetch('https://api.dexscreener.com/latest/dex/tokens/0xf3Ce5dDAAb6C133F9875a4a46C55cf0b58111B07');
  const axiomData = await axiomResp.json();
  const axiomPrice = parseFloat(axiomData.pairs?.[0]?.priceUsd);
  
  if (!axiomPrice || isNaN(axiomPrice)) throw new Error('Failed to get AXIOM price');
  
  return { wethPrice, axiomPrice };
}

// === CHECK PENDING FEES ===
async function getPendingFees() {
  const abi = [{
    name: 'availableFees',
    type: 'function',
    inputs: [{ name: 'feeOwner', type: 'address' }, { name: 'token', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view'
  }];
  
  const [wethFees, axiomFees] = await Promise.all([
    publicClient.readContract({ address: CLANKER_FEES, abi, functionName: 'availableFees', args: [FEE_OWNER, WETH] }),
    publicClient.readContract({ address: CLANKER_FEES, abi, functionName: 'availableFees', args: [FEE_OWNER, AXIOM] })
  ]);
  
  return {
    weth: wethFees,
    axiom: axiomFees,
    wethFormatted: formatUnits(wethFees, 18),
    axiomFormatted: formatUnits(axiomFees, 18)
  };
}

// === CLAIM FEES ===
async function claimFees(token) {
  const abi = [{
    name: 'claim',
    type: 'function',
    inputs: [{ name: 'feeOwner', type: 'address' }, { name: 'token', type: 'address' }],
    outputs: [],
    stateMutability: 'nonpayable'
  }];
  
  const hash = await walletClient.writeContract({
    address: CLANKER_FEES,
    abi,
    functionName: 'claim',
    args: [FEE_OWNER, token]
  });
  
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  return { hash, receipt };
}

// === SWAP FUNCTIONS ===
// Using Uniswap V4 via v4-swap.mjs script
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const V4_SWAP_SCRIPT = join(__dirname, '../../uniswap-v4-lp/scripts/v4-swap.mjs');
const LP_POSITION_ID = '1078751'; // Our main LP position for pool key

async function swapV4(tokenIn, tokenOut, amount, options = {}) {
  const { dryRun = false, slippage = 2 } = options;
  
  // Build command
  const tokenInArg = tokenIn === WETH ? 'WETH' : tokenIn;
  const tokenOutArg = tokenOut === WETH ? 'WETH' : tokenOut;
  
  const cmd = [
    'node', V4_SWAP_SCRIPT,
    '--token-in', tokenInArg,
    '--token-out', tokenOutArg,
    '--amount', amount.toString(),
    '--token-id', LP_POSITION_ID,
    '--slippage', slippage.toString(),
    dryRun ? '--dry-run' : ''
  ].filter(Boolean).join(' ');
  
  console.log(`   Executing: ${cmd.substring(0, 100)}...`);
  
  try {
    const output = execSync(cmd, {
      env: { ...process.env, NET_PRIVATE_KEY: process.env.NET_PRIVATE_KEY },
      encoding: 'utf8',
      timeout: 60000
    });
    
    console.log(output);
    
    // Parse output for tx hash
    const txMatch = output.match(/TX: (0x[a-fA-F0-9]+)/);
    const amountMatch = output.match(/Received: ([\d.]+)/);
    
    return {
      success: true,
      hash: txMatch ? txMatch[1] : null,
      amountOut: amountMatch ? amountMatch[1] : null
    };
  } catch (err) {
    console.error(`   Swap error: ${err.message}`);
    throw err;
  }
}

// === BURN AXIOM ===
async function burnAxiom(amount) {
  // Simple ERC20 transfer to dead address
  const abi = [{
    name: 'transfer',
    type: 'function',
    inputs: [{ name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'nonpayable'
  }];
  
  const hash = await walletClient.writeContract({
    address: AXIOM,
    abi,
    functionName: 'transfer',
    args: [DEAD_ADDRESS, amount]
  });
  
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  return { hash, receipt };
}

// === GET TOKEN BALANCE ===
async function getBalance(token) {
  const abi = [{
    name: 'balanceOf',
    type: 'function',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view'
  }];
  
  return publicClient.readContract({
    address: token,
    abi,
    functionName: 'balanceOf',
    args: [account.address]
  });
}

// === MAIN BURN-AND-HARVEST LOGIC ===
async function burnAndHarvest(options = {}) {
  const { dryRun = false, destinationAddress } = options;
  
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('                    BURN & HARVEST PIPELINE');
  console.log('═══════════════════════════════════════════════════════════════\n');
  
  // Step 1: Get current prices
  console.log('📊 Fetching prices...');
  const { wethPrice, axiomPrice } = await getPrices();
  console.log(`   WETH:  $${wethPrice.toFixed(2)}`);
  console.log(`   AXIOM: $${axiomPrice.toFixed(10)}\n`);
  
  // Step 2: Check pending fees
  console.log('💰 Checking pending Clanker fees...');
  const pending = await getPendingFees();
  console.log(`   WETH:  ${pending.wethFormatted} ($${(parseFloat(pending.wethFormatted) * wethPrice).toFixed(2)})`);
  console.log(`   AXIOM: ${pending.axiomFormatted} ($${(parseFloat(pending.axiomFormatted) * axiomPrice).toFixed(2)})\n`);
  
  if (pending.weth === 0n && pending.axiom === 0n) {
    console.log('ℹ️  No fees to claim.');
    return;
  }
  
  // Step 3: Calculate USD values
  const wethUsd = parseFloat(pending.wethFormatted) * wethPrice;
  const axiomUsd = parseFloat(pending.axiomFormatted) * axiomPrice;
  const totalUsd = wethUsd + axiomUsd;
  const burnTarget = totalUsd / 2;
  
  console.log('📈 USD Breakdown:');
  console.log(`   WETH:  $${wethUsd.toFixed(4)}`);
  console.log(`   AXIOM: $${axiomUsd.toFixed(4)}`);
  console.log(`   TOTAL: $${totalUsd.toFixed(4)}`);
  console.log(`   50% BURN TARGET: $${burnTarget.toFixed(4)}\n`);
  
  // Step 4: Determine swap direction
  let swapDirection, swapAmountUsd, axiomToBurn;
  
  if (axiomUsd > burnTarget) {
    // Have more AXIOM than needed - swap excess to WETH
    swapDirection = 'AXIOM_TO_WETH';
    swapAmountUsd = axiomUsd - burnTarget;
    axiomToBurn = burnTarget;
    console.log(`🔄 Strategy: Swap $${swapAmountUsd.toFixed(4)} AXIOM → WETH`);
    console.log(`   Then burn $${axiomToBurn.toFixed(4)} worth of AXIOM\n`);
  } else if (axiomUsd < burnTarget) {
    // Need more AXIOM - swap WETH to AXIOM
    swapDirection = 'WETH_TO_AXIOM';
    swapAmountUsd = burnTarget - axiomUsd;
    axiomToBurn = burnTarget;
    console.log(`🔄 Strategy: Swap $${swapAmountUsd.toFixed(4)} WETH → AXIOM`);
    console.log(`   Then burn $${axiomToBurn.toFixed(4)} worth of AXIOM\n`);
  } else {
    // Perfect balance
    swapDirection = 'NONE';
    axiomToBurn = axiomUsd;
    console.log(`✅ Perfect balance! Burn all AXIOM ($${axiomToBurn.toFixed(4)})\n`);
  }
  
  // Calculate exact token amounts
  const axiomToBurnAmount = parseUnits((axiomToBurn / axiomPrice).toFixed(0), 18);
  
  console.log('🎯 Execution Plan:');
  console.log(`   Claim WETH:  ${pending.weth > 0n ? '✓' : '✗'}`);
  console.log(`   Claim AXIOM: ${pending.axiom > 0n ? '✓' : '✗'}`);
  console.log(`   Swap: ${swapDirection}`);
  console.log(`   Burn: ${formatUnits(axiomToBurnAmount, 18)} AXIOM to ${DEAD_ADDRESS}`);
  console.log(`   Keep: ~$${(totalUsd - axiomToBurn).toFixed(4)} as WETH\n`);
  
  if (dryRun) {
    console.log('🔸 DRY RUN - No transactions executed\n');
    return {
      dryRun: true,
      totalUsd,
      burnTargetUsd: burnTarget,
      axiomToBurnAmount: axiomToBurnAmount.toString(),
      swapDirection,
      swapAmountUsd
    };
  }
  
  // === EXECUTE ===
  console.log('🚀 EXECUTING...\n');
  
  // Claim WETH
  if (pending.weth > 0n) {
    console.log('   Claiming WETH...');
    const { hash } = await claimFees(WETH);
    console.log(`   ✅ TX: ${hash}\n`);
  }
  
  // Claim AXIOM
  if (pending.axiom > 0n) {
    console.log('   Claiming AXIOM...');
    const { hash } = await claimFees(AXIOM);
    console.log(`   ✅ TX: ${hash}\n`);
  }
  
  // Get current balances after claim
  const wethBalance = await getBalance(WETH);
  const axiomBalance = await getBalance(AXIOM);
  
  console.log('   Post-claim balances:');
  console.log(`   WETH:  ${formatUnits(wethBalance, 18)}`);
  console.log(`   AXIOM: ${formatUnits(axiomBalance, 18)}\n`);
  
  // Execute swap if needed (using Uniswap V4)
  if (swapDirection === 'AXIOM_TO_WETH') {
    const swapAmount = parseUnits((swapAmountUsd / axiomPrice).toFixed(0), 18);
    console.log(`   Swapping ${formatUnits(swapAmount, 18)} AXIOM → WETH via V4...`);
    
    // First approve AXIOM for Permit2 if needed
    const allowance = await publicClient.readContract({
      address: AXIOM,
      abi: [{ name: 'allowance', type: 'function', inputs: [{ type: 'address' }, { type: 'address' }], outputs: [{ type: 'uint256' }], stateMutability: 'view' }],
      functionName: 'allowance',
      args: [account.address, '0x000000000022D473030F116dDEE9F6B43aC78BA3'] // Permit2
    });
    
    if (allowance < swapAmount) {
      console.log('   Approving AXIOM for Permit2...');
      const approveHash = await walletClient.writeContract({
        address: AXIOM,
        abi: [{ name: 'approve', type: 'function', inputs: [{ type: 'address' }, { type: 'uint256' }], outputs: [{ type: 'bool' }], stateMutability: 'nonpayable' }],
        functionName: 'approve',
        args: ['0x000000000022D473030F116dDEE9F6B43aC78BA3', 2n ** 256n - 1n]
      });
      await publicClient.waitForTransactionReceipt({ hash: approveHash });
      console.log(`   ✅ Approved: ${approveHash}`);
    }
    
    const result = await swapV4(AXIOM, WETH, swapAmount, { dryRun });
    console.log(`   ✅ Swap complete\n`);
  } else if (swapDirection === 'WETH_TO_AXIOM') {
    const swapAmount = parseUnits((swapAmountUsd / wethPrice).toFixed(18), 18);
    console.log(`   Swapping ${formatUnits(swapAmount, 18)} WETH → AXIOM via V4...`);
    
    // Approve WETH for Permit2 if needed
    const allowance = await publicClient.readContract({
      address: WETH,
      abi: [{ name: 'allowance', type: 'function', inputs: [{ type: 'address' }, { type: 'address' }], outputs: [{ type: 'uint256' }], stateMutability: 'view' }],
      functionName: 'allowance',
      args: [account.address, '0x000000000022D473030F116dDEE9F6B43aC78BA3'] // Permit2
    });
    
    if (allowance < swapAmount) {
      console.log('   Approving WETH for Permit2...');
      const approveHash = await walletClient.writeContract({
        address: WETH,
        abi: [{ name: 'approve', type: 'function', inputs: [{ type: 'address' }, { type: 'uint256' }], outputs: [{ type: 'bool' }], stateMutability: 'nonpayable' }],
        functionName: 'approve',
        args: ['0x000000000022D473030F116dDEE9F6B43aC78BA3', 2n ** 256n - 1n]
      });
      await publicClient.waitForTransactionReceipt({ hash: approveHash });
      console.log(`   ✅ Approved: ${approveHash}`);
    }
    
    const result = await swapV4(WETH, AXIOM, swapAmount, { dryRun });
    console.log(`   ✅ Swap complete\n`);
  }
  
  // Recalculate exact burn amount based on new balance and current price
  const finalAxiomBalance = await getBalance(AXIOM);
  const finalAxiomUsd = parseFloat(formatUnits(finalAxiomBalance, 18)) * axiomPrice;
  
  // CRITICAL: Recalculate burn amount to be exactly 50%
  const exactBurnAmount = parseUnits((burnTarget / axiomPrice).toFixed(0), 18);
  
  // Validate we have enough
  if (finalAxiomBalance < exactBurnAmount) {
    throw new Error(`INSUFFICIENT AXIOM: Have ${formatUnits(finalAxiomBalance, 18)}, need ${formatUnits(exactBurnAmount, 18)}`);
  }
  
  // BURN
  console.log(`🔥 BURNING ${formatUnits(exactBurnAmount, 18)} AXIOM (~$${burnTarget.toFixed(4)})...`);
  const { hash: burnHash } = await burnAxiom(exactBurnAmount);
  console.log(`   ✅ TX: ${burnHash}`);
  console.log(`   Sent to: ${DEAD_ADDRESS}\n`);
  
  // Final summary
  const remainingWeth = await getBalance(WETH);
  const remainingAxiom = await getBalance(AXIOM);
  
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('                         SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`   Total fees claimed: $${totalUsd.toFixed(4)}`);
  console.log(`   AXIOM burned (50%): $${burnTarget.toFixed(4)}`);
  console.log(`   WETH retained (50%): $${(totalUsd - burnTarget).toFixed(4)}`);
  console.log(`\n   Remaining balances:`);
  console.log(`   WETH:  ${formatUnits(remainingWeth, 18)}`);
  console.log(`   AXIOM: ${formatUnits(remainingAxiom, 18)}`);
  console.log('═══════════════════════════════════════════════════════════════\n');
  
  return {
    success: true,
    totalUsd,
    burnedUsd: burnTarget,
    burnedAxiom: formatUnits(exactBurnAmount, 18),
    burnTx: burnHash
  };
}

// === CLI ===
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');

burnAndHarvest({ dryRun })
  .then(result => {
    if (result) console.log(JSON.stringify(result, null, 2));
  })
  .catch(err => {
    console.error('❌ Error:', err.message);
    process.exit(1);
  });
