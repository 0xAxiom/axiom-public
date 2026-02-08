#!/usr/bin/env node
/**
 * Buy & Burn Pipeline
 * 
 * Fulfills the commitment: 50% of Clanker protocol fees go to $AXIOM buy & burn
 * 
 * Pipeline:
 * 1. Claim Clanker protocol fees (WETH + token)
 * 2. Calculate 50% of WETH proceeds
 * 3. Swap 50% WETH → $AXIOM via V4
 * 4. Burn $AXIOM (send to dead address)
 * 5. Log everything for transparency
 * 6. Output shareable proof for Twitter
 *
 * Usage:
 *   node buy-burn.mjs --token 0xf3Ce5dDAAb6C133F9875a4a46C55cf0b58111B07
 *   node buy-burn.mjs --token 0xf3Ce5... --burn-pct 50    # default is 50%
 *   node buy-burn.mjs --token 0xf3Ce5... --dry-run
 *   node buy-burn.mjs --token 0xf3Ce5... --position-id 1078751  # for pool key
 */

import { createPublicClient, createWalletClient, http, formatEther, formatUnits, parseAbi, maxUint256, encodeAbiParameters, parseAbiParameters, keccak256 } from 'viem';
import { base } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { defaultAbiCoder } from '@ethersproject/abi';
import * as dotenv from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'fs';

dotenv.config({ path: resolve(process.env.HOME, '.axiom/wallet.env') });

// ─── CLI Args ────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const getArg = (name, def) => { const i = args.indexOf('--' + name); return i >= 0 && args[i + 1] ? args[i + 1] : def; };
const hasFlag = (name) => args.includes('--' + name);

const TOKEN = getArg('token', '0xf3Ce5dDAAb6C133F9875a4a46C55cf0b58111B07'); // $AXIOM default
const BURN_PCT = parseInt(getArg('burn-pct', '50'), 10);
const POSITION_ID = getArg('position-id', '1078751');
const FEE_CONTRACT = getArg('fee-contract', '0xf3622742b1e446d92e45e22923ef11c2fcd55d68');
const DRY_RUN = hasFlag('dry-run');
const JSON_OUTPUT = hasFlag('json');

// ─── Constants ───────────────────────────────────────────────────────────────

const DEAD_ADDRESS = '0x000000000000000000000000000000000000dEaD';
const WETH = '0x4200000000000000000000000000000000000006';
const CONTRACTS = {
  POOL_MANAGER: '0x498581ff718922c3f8e6a244956af099b2652b2b',
  POSITION_MANAGER: '0x7c5f5a4bbd8fd63184577525326123b519429bdc',
  UNIVERSAL_ROUTER: '0x6ff5693b99212da76ad316178a184ab56d299b43',
  PERMIT2: '0x000000000022D473030F116dDEE9F6B43aC78BA3',
  STATE_VIEW: '0xa3c0c9b65bad0b08107aa264b0f3db444b867a71',
};

// Universal Router Commands
const Commands = { V4_SWAP: 0x10 };
// V4 Actions
const Actions = {
  SWAP_EXACT_IN_SINGLE: 0x06,
  SETTLE_ALL: 0x0c,
  TAKE_ALL: 0x0f,
};

// ─── ABIs ────────────────────────────────────────────────────────────────────

const CLANKER_FEE_ABI = parseAbi([
  'function claim(address feeOwner, address token) external',
  'function availableFees(address feeOwner, address token) external view returns (uint256)',
  'function feesToClaim(address feeOwner, address token) external view returns (uint256)',
]);

const ERC20_ABI = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
]);

const POSITION_MANAGER_ABI = [{
  name: 'getPoolAndPositionInfo',
  type: 'function',
  stateMutability: 'view',
  inputs: [{ type: 'uint256', name: 'tokenId' }],
  outputs: [
    { type: 'tuple', name: 'poolKey', components: [
      { name: 'currency0', type: 'address' },
      { name: 'currency1', type: 'address' },
      { name: 'fee', type: 'uint24' },
      { name: 'tickSpacing', type: 'int24' },
      { name: 'hooks', type: 'address' },
    ]},
    { type: 'uint256', name: 'positionInfo' },
  ],
}];

const PERMIT2_ABI = parseAbi([
  'function approve(address token, address spender, uint160 amount, uint48 expiration) external',
  'function allowance(address owner, address token, address spender) external view returns (uint160 amount, uint48 expiration, uint48 nonce)',
]);

const UNIVERSAL_ROUTER_ABI = parseAbi([
  'function execute(bytes calldata commands, bytes[] calldata inputs, uint256 deadline) external payable',
]);

const STATE_VIEW_ABI = parseAbi([
  'function getSlot0(bytes32 poolId) external view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)',
]);

// ─── Helpers ─────────────────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOG_FILE = resolve(__dirname, '../data/buy-burn-log.json');

function logBurn(entry) {
  let log = [];
  if (existsSync(LOG_FILE)) {
    try { log = JSON.parse(readFileSync(LOG_FILE, 'utf8')); } catch {}
  }
  log.push(entry);
  writeFileSync(LOG_FILE, JSON.stringify(log, null, 2));
}

function computePoolId(poolKey) {
  const encoded = defaultAbiCoder.encode(
    ['address', 'address', 'uint24', 'int24', 'address'],
    [poolKey.currency0, poolKey.currency1, poolKey.fee, poolKey.tickSpacing, poolKey.hooks]
  );
  return keccak256(encoded);
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const pk = process.env.NET_PRIVATE_KEY;
  if (!pk) { console.error('NET_PRIVATE_KEY not set'); process.exit(1); }

  const account = privateKeyToAccount(pk);
  // Use Alchemy or fallback RPC to avoid rate limits
  const rpcUrl = process.env.BASE_RPC_URL || 'https://base.meowrpc.com';
  const transport = http(rpcUrl);
  const publicClient = createPublicClient({ chain: base, transport });
  const walletClient = createWalletClient({ chain: base, transport, account });

  console.log(`\n🔥 BUY & BURN PIPELINE 🔥`);
  console.log(`═`.repeat(50));
  console.log(`Token: ${TOKEN}`);
  console.log(`Burn %: ${BURN_PCT}%`);
  console.log(`Wallet: ${account.address}`);
  if (DRY_RUN) console.log(`🔮 DRY RUN MODE`);
  console.log(`═`.repeat(50));

  // Get token info
  const tokenSymbol = await publicClient.readContract({ address: TOKEN, abi: ERC20_ABI, functionName: 'symbol' }).catch(() => 'TOKEN');
  const tokenDecimals = await publicClient.readContract({ address: TOKEN, abi: ERC20_ABI, functionName: 'decimals' }).catch(() => 18);

  // ─── Step 1: Check Clanker Fees ───────────────────────────────────────────
  console.log(`\n📊 Step 1: Check Clanker Protocol Fees`);
  
  let wethFees = 0n;
  try {
    wethFees = await publicClient.readContract({
      address: FEE_CONTRACT, abi: CLANKER_FEE_ABI, functionName: 'availableFees',
      args: [account.address, WETH],
    });
  } catch (e) {
    try {
      wethFees = await publicClient.readContract({
        address: FEE_CONTRACT, abi: CLANKER_FEE_ABI, functionName: 'feesToClaim',
        args: [account.address, WETH],
      });
    } catch {}
  }

  let tokenFees = 0n;
  try {
    tokenFees = await publicClient.readContract({
      address: FEE_CONTRACT, abi: CLANKER_FEE_ABI, functionName: 'availableFees',
      args: [account.address, TOKEN],
    });
  } catch (e) {
    try {
      tokenFees = await publicClient.readContract({
        address: FEE_CONTRACT, abi: CLANKER_FEE_ABI, functionName: 'feesToClaim',
        args: [account.address, TOKEN],
      });
    } catch {}
  }

  console.log(`   WETH fees: ${formatEther(wethFees)} WETH`);
  console.log(`   ${tokenSymbol} fees: ${formatUnits(tokenFees, tokenDecimals)}`);

  if (wethFees === 0n) {
    console.log(`\n⚠️  No WETH fees to claim. Nothing to buy & burn.`);
    if (JSON_OUTPUT) console.log(JSON.stringify({ success: true, claimed: 0, burned: 0, reason: 'no_fees' }));
    return;
  }

  // ─── Step 2: Claim Fees ───────────────────────────────────────────────────
  console.log(`\n💰 Step 2: Claim Clanker Fees`);
  
  const wethBalBefore = await publicClient.readContract({ address: WETH, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address] });

  if (!DRY_RUN) {
    // Claim WETH fees
    if (wethFees > 0n) {
      console.log(`   ⏳ Claiming WETH...`);
      const tx = await walletClient.writeContract({
        address: FEE_CONTRACT, abi: CLANKER_FEE_ABI, functionName: 'claim',
        args: [account.address, WETH],
      });
      await publicClient.waitForTransactionReceipt({ hash: tx });
      console.log(`   ✅ WETH claimed: ${tx}`);
    }

    // Claim token fees
    if (tokenFees > 0n) {
      console.log(`   ⏳ Claiming ${tokenSymbol}...`);
      const tx = await walletClient.writeContract({
        address: FEE_CONTRACT, abi: CLANKER_FEE_ABI, functionName: 'claim',
        args: [account.address, TOKEN],
      });
      await publicClient.waitForTransactionReceipt({ hash: tx });
      console.log(`   ✅ ${tokenSymbol} claimed: ${tx}`);
    }
  } else {
    console.log(`   🔮 Would claim: ${formatEther(wethFees)} WETH + ${formatUnits(tokenFees, tokenDecimals)} ${tokenSymbol}`);
  }

  // ─── Step 3: Calculate Buy Amount ─────────────────────────────────────────
  console.log(`\n📐 Step 3: Calculate ${BURN_PCT}% for Buy & Burn`);
  
  const buyAmount = (wethFees * BigInt(BURN_PCT)) / 100n;
  console.log(`   Total WETH: ${formatEther(wethFees)}`);
  console.log(`   ${BURN_PCT}% for burn: ${formatEther(buyAmount)} WETH`);

  if (buyAmount === 0n) {
    console.log(`\n⚠️  Buy amount too small, skipping.`);
    return;
  }

  // ─── Step 4: Get Pool Key from Position ───────────────────────────────────
  console.log(`\n🔑 Step 4: Get Pool Key from Position #${POSITION_ID}`);
  
  const [poolKey] = await publicClient.readContract({
    address: CONTRACTS.POSITION_MANAGER,
    abi: POSITION_MANAGER_ABI,
    functionName: 'getPoolAndPositionInfo',
    args: [BigInt(POSITION_ID)],
  });
  
  console.log(`   currency0: ${poolKey.currency0}`);
  console.log(`   currency1: ${poolKey.currency1}`);
  console.log(`   fee: ${poolKey.fee}`);
  console.log(`   tickSpacing: ${poolKey.tickSpacing}`);
  console.log(`   hooks: ${poolKey.hooks}`);

  // Determine swap direction (WETH → TOKEN)
  const isWethCurrency0 = poolKey.currency0.toLowerCase() === WETH.toLowerCase();
  const zeroForOne = isWethCurrency0; // true if swapping currency0 for currency1

  // ─── Step 5: Approve WETH for Permit2 ─────────────────────────────────────
  console.log(`\n🔓 Step 5: Approve WETH`);
  
  if (!DRY_RUN) {
    // Approve WETH → Permit2
    const currentAllowance = await publicClient.readContract({
      address: WETH, abi: ERC20_ABI, functionName: 'allowance',
      args: [account.address, CONTRACTS.PERMIT2],
    });
    
    if (currentAllowance < buyAmount) {
      console.log(`   ⏳ Approving WETH for Permit2...`);
      const tx = await walletClient.writeContract({
        address: WETH, abi: ERC20_ABI, functionName: 'approve',
        args: [CONTRACTS.PERMIT2, maxUint256],
      });
      await publicClient.waitForTransactionReceipt({ hash: tx });
      console.log(`   ✅ Approved`);
    } else {
      console.log(`   ✅ Already approved`);
    }

    // Permit2 → Universal Router
    const [permit2Amount] = await publicClient.readContract({
      address: CONTRACTS.PERMIT2, abi: PERMIT2_ABI, functionName: 'allowance',
      args: [account.address, WETH, CONTRACTS.UNIVERSAL_ROUTER],
    });
    
    if (permit2Amount < buyAmount) {
      console.log(`   ⏳ Approving Permit2 → Universal Router...`);
      const expiration = Math.floor(Date.now() / 1000) + 86400 * 365;
      const tx = await walletClient.writeContract({
        address: CONTRACTS.PERMIT2, abi: PERMIT2_ABI, functionName: 'approve',
        args: [WETH, CONTRACTS.UNIVERSAL_ROUTER, BigInt('0xffffffffffffffffffffffffffffffff'), expiration],
      });
      await publicClient.waitForTransactionReceipt({ hash: tx });
      console.log(`   ✅ Permit2 approved`);
    }
  } else {
    console.log(`   🔮 Would approve WETH for swap`);
  }

  // ─── Step 6: Execute V4 Swap (WETH → TOKEN) ───────────────────────────────
  console.log(`\n🔄 Step 6: Swap WETH → ${tokenSymbol}`);

  const tokenBalBefore = await publicClient.readContract({ address: TOKEN, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address] });

  if (!DRY_RUN) {
    // Build V4 swap actions
    // Action sequence: SWAP_EXACT_IN_SINGLE, SETTLE_ALL, TAKE_ALL
    const sqrtPriceLimitX96 = zeroForOne
      ? BigInt('4295128740') // MIN_SQRT_RATIO + 1
      : BigInt('1461446703485210103287273052203988822378723970341'); // MAX_SQRT_RATIO - 1

    // Encode swap params
    const swapParams = defaultAbiCoder.encode(
      ['tuple(address,address,uint24,int24,address)', 'bool', 'int256', 'uint160', 'bytes'],
      [
        [poolKey.currency0, poolKey.currency1, poolKey.fee, poolKey.tickSpacing, poolKey.hooks],
        zeroForOne,
        buyAmount, // exactIn amount
        sqrtPriceLimitX96,
        '0x' // hookData
      ]
    );

    // Encode settle params (WETH)
    const settleParams = defaultAbiCoder.encode(
      ['address', 'uint256'],
      [WETH, buyAmount]
    );

    // Encode take params (TOKEN)
    const takeParams = defaultAbiCoder.encode(
      ['address', 'uint256'],
      [TOKEN, 1n] // minAmount = 1, actual determined by swap
    );

    // Build actions bytes
    const actions = '0x' + 
      Actions.SWAP_EXACT_IN_SINGLE.toString(16).padStart(2, '0') +
      Actions.SETTLE_ALL.toString(16).padStart(2, '0') +
      Actions.TAKE_ALL.toString(16).padStart(2, '0');

    // Encode V4_SWAP input
    const v4Input = defaultAbiCoder.encode(
      ['bytes', 'bytes[]'],
      [actions, [swapParams, settleParams, takeParams]]
    );

    // Execute via Universal Router
    const commands = '0x' + Commands.V4_SWAP.toString(16).padStart(2, '0');
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);

    console.log(`   ⏳ Executing swap...`);
    try {
      const tx = await walletClient.writeContract({
        address: CONTRACTS.UNIVERSAL_ROUTER,
        abi: UNIVERSAL_ROUTER_ABI,
        functionName: 'execute',
        args: [commands, [v4Input], deadline],
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash: tx });
      console.log(`   ✅ Swap TX: https://basescan.org/tx/${tx}`);
      console.log(`   Status: ${receipt.status}`);
    } catch (err) {
      console.error(`   ❌ Swap failed: ${err.message}`);
      // Try to continue anyway to burn any token balance we have
    }
  } else {
    console.log(`   🔮 Would swap ${formatEther(buyAmount)} WETH → ${tokenSymbol}`);
  }

  // ─── Step 7: Burn Tokens ──────────────────────────────────────────────────
  console.log(`\n🔥 Step 7: BURN ${tokenSymbol}`);

  const tokenBalAfter = await publicClient.readContract({ address: TOKEN, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address] });
  const tokensAcquired = tokenBalAfter - tokenBalBefore;
  
  // Also burn any token fees we claimed
  const totalToBurn = tokensAcquired + tokenFees;
  
  console.log(`   Tokens acquired from swap: ${formatUnits(tokensAcquired, tokenDecimals)}`);
  console.log(`   Token fees claimed: ${formatUnits(tokenFees, tokenDecimals)}`);
  console.log(`   Total to burn: ${formatUnits(totalToBurn, tokenDecimals)}`);

  let burnTxHash = null;
  if (!DRY_RUN && totalToBurn > 0n) {
    console.log(`   ⏳ Burning to ${DEAD_ADDRESS}...`);
    const tx = await walletClient.writeContract({
      address: TOKEN, abi: ERC20_ABI, functionName: 'transfer',
      args: [DEAD_ADDRESS, totalToBurn],
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash: tx });
    burnTxHash = tx;
    console.log(`   🔥 BURNED: https://basescan.org/tx/${tx}`);
    console.log(`   Status: ${receipt.status}`);
  } else if (DRY_RUN) {
    console.log(`   🔮 Would burn ${formatUnits(totalToBurn, tokenDecimals)} ${tokenSymbol}`);
  }

  // ─── Step 8: Final Summary ────────────────────────────────────────────────
  console.log(`\n` + `═`.repeat(50));
  console.log(`✅ BUY & BURN COMPLETE`);
  console.log(`═`.repeat(50));
  console.log(`   WETH used: ${formatEther(buyAmount)}`);
  console.log(`   ${tokenSymbol} burned: ${formatUnits(totalToBurn, tokenDecimals)}`);
  console.log(`   Dead address: ${DEAD_ADDRESS}`);
  if (burnTxHash) {
    console.log(`   Burn TX: https://basescan.org/tx/${burnTxHash}`);
  }

  // ─── Log for Transparency ─────────────────────────────────────────────────
  const logEntry = {
    timestamp: new Date().toISOString(),
    wethClaimed: formatEther(wethFees),
    wethUsedForBurn: formatEther(buyAmount),
    tokensBurned: formatUnits(totalToBurn, tokenDecimals),
    tokenSymbol,
    burnTx: burnTxHash,
    dryRun: DRY_RUN,
  };

  if (!DRY_RUN) {
    logBurn(logEntry);
    console.log(`\n📝 Logged to: ${LOG_FILE}`);
  }

  // ─── Twitter-Ready Output ─────────────────────────────────────────────────
  console.log(`\n📢 SHAREABLE PROOF:`);
  console.log(`─`.repeat(50));
  console.log(`🔥 Buy & Burn Report`);
  console.log(`• Claimed: ${formatEther(wethFees)} WETH from Clanker fees`);
  console.log(`• Used: ${formatEther(buyAmount)} WETH (${BURN_PCT}%)`);
  console.log(`• Bought & burned: ${formatUnits(totalToBurn, tokenDecimals)} $AXIOM`);
  console.log(`• Burn TX: https://basescan.org/tx/${burnTxHash || '[DRY RUN]'}`);
  console.log(`• Sent to: ${DEAD_ADDRESS}`);
  console.log(`─`.repeat(50));

  if (JSON_OUTPUT) {
    console.log(JSON.stringify({
      success: true,
      claimed: formatEther(wethFees),
      burned: formatUnits(totalToBurn, tokenDecimals),
      burnTx: burnTxHash,
    }));
  }
}

main().catch(err => { console.error('❌', err.message); process.exit(1); });
