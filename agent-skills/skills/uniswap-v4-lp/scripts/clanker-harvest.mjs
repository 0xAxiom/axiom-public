#!/usr/bin/env node
/**
 * 🌾 Clanker Harvest — Modular fee management for Clanker-launched tokens
 * 
 * Fully configurable pipeline — pick what you need:
 * 
 *   CLAIM ONLY:
 *     node clanker-harvest.mjs --token 0xTOKEN
 * 
 *   CLAIM + COMPOUND (all fees back into LP):
 *     node clanker-harvest.mjs --token 0xTOKEN --token-id 1078751 --compound-pct 100
 * 
 *   CLAIM + HARVEST (all fees swapped to USDC → vault):
 *     node clanker-harvest.mjs --token 0xTOKEN --harvest-address 0xVAULT --compound-pct 0
 * 
 *   CLAIM + COMPOUND + HARVEST (split fees):
 *     node clanker-harvest.mjs --token 0xTOKEN --token-id 1078751 \
 *       --harvest-address 0xVAULT --compound-pct 50
 * 
 *   WITH THRESHOLDS (only act if fees exceed $X):
 *     node clanker-harvest.mjs --token 0xTOKEN --token-id 1078751 \
 *       --harvest-address 0xVAULT --compound-pct 50 --min-usd 10
 * 
 *   WITH CONFIG FILE:
 *     node clanker-harvest.mjs --config harvest-config.json
 * 
 * Works for ANY Clanker token with a V4 LP position on Base.
 */

import { createPublicClient, createWalletClient, http, formatEther, formatUnits, parseAbi, maxUint256, encodeAbiParameters, parseAbiParameters } from 'viem';
import { base } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { defaultAbiCoder } from '@ethersproject/abi';
import fs from 'fs';

// ─── CLI / Config ────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const getArg = (name, def) => { const i = args.indexOf('--' + name); return i >= 0 && args[i + 1] ? args[i + 1] : def; };
const hasFlag = (name) => args.includes('--' + name);

// Load config file if provided, CLI args override
let config = {};
const configPath = getArg('config', null);
if (configPath && fs.existsSync(configPath)) {
  config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
}

const DEAD_ADDRESS = '0x000000000000000000000000000000000000dEaD';

const cfg = {
  token:          getArg('token', config.token || null),
  tokenId:        getArg('token-id', config.tokenId || null),
  harvestAddress: getArg('harvest-address', config.harvestAddress || null),
  treasuryAddress: getArg('treasury-address', config.treasuryAddress || null),
  compoundPct:    parseInt(getArg('compound-pct', config.compoundPct ?? '100')),
  burnPct:        parseInt(getArg('burn-pct', config.burnPct ?? '0')),
  bnkrPct:        parseInt(getArg('bnkr-pct', config.bnkrPct ?? '0')),
  minUsd:         parseFloat(getArg('min-usd', config.minUsd ?? '0')),
  slippage:       parseFloat(getArg('slippage', config.slippage ?? '1')),
  feeContract:    getArg('fee-contract', config.feeContract || '0xf3622742b1e446d92e45e22923ef11c2fcd55d68'),
  dryRun:         hasFlag('dry-run') || config.dryRun === true,
  skipClaim:      hasFlag('skip-claim') || config.skipClaim === true,
  skipLp:         hasFlag('skip-lp') || config.skipLp === true,
};

const wantBurn = cfg.burnPct > 0;
const harvestPct = 100 - cfg.compoundPct - cfg.burnPct;
const wantCompound = cfg.compoundPct > 0 && cfg.tokenId;
const wantHarvest = harvestPct > 0 && cfg.harvestAddress;

if (!cfg.token) {
  console.log(`
🌾 Clanker Harvest — Modular fee management for Clanker tokens

Usage:
  node clanker-harvest.mjs --token <TOKEN> [options]

Required:
  --token              Clanker token address

Pipeline options (mix & match):
  --token-id <ID>      LP position NFT ID (needed for compound/LP collection)
  --harvest-address    Where to send harvested USDC (needed for harvest)
  --compound-pct <N>   % to compound back into LP (default: 100 if token-id set, else 0)
                       0 = harvest everything, 100 = compound everything

Thresholds:
  --min-usd <N>        Minimum fee value (USD) to act (default: 0 = always act)

Advanced:
  --fee-contract       Clanker fee storage contract (default: 0xf362...)
  --slippage <N>       Swap slippage % (default: 1)
  --skip-claim         Skip Clanker fee claim (only do LP fees)
  --skip-lp            Skip LP fee collection (only do Clanker fees)
  --config <file>      Load config from JSON file
  --dry-run            Simulate without executing

Examples:
  # Just claim Clanker protocol fees
  node clanker-harvest.mjs --token 0xf3Ce5...

  # Claim + compound 100% into LP
  node clanker-harvest.mjs --token 0xf3Ce5... --token-id 1078751 --compound-pct 100

  # Claim + harvest 100% as USDC
  node clanker-harvest.mjs --token 0xf3Ce5... --harvest-address 0xVAULT --compound-pct 0

  # 50/50 split
  node clanker-harvest.mjs --token 0xf3Ce5... --token-id 1078751 \\
    --harvest-address 0xVAULT --compound-pct 50

  # 80% compound / 20% harvest, only if > $10 accumulated
  node clanker-harvest.mjs --token 0xf3Ce5... --token-id 1078751 \\
    --harvest-address 0xVAULT --compound-pct 80 --min-usd 10

  # Config file for cron
  node clanker-harvest.mjs --config my-agent.json
  `);
  process.exit(1);
}

// ─── Contracts ───────────────────────────────────────────────────────────────
const C = {
  POSITION_MANAGER: '0x7c5f5a4bbd8fd63184577525326123b519429bdc',
  PERMIT2: '0x000000000022D473030F116dDEE9F6B43aC78BA3',
  UNIVERSAL_ROUTER: '0x6ff5693b99212da76ad316178a184ab56d299b43',
  WETH: '0x4200000000000000000000000000000000000006',
  USDC: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  BNKR: '0x22aF33FE49fD1Fa80c7149773dDe5890D3c76F3b',
  SWAP_ROUTER: '0x2626664c2603336E57B271c5C0b26F421741e481',
};

// ─── ABIs ────────────────────────────────────────────────────────────────────
const CLANKER_ABI = parseAbi([
  'function claim(address feeOwner, address token) external',
  'function availableFees(address feeOwner, address token) external view returns (uint256)',
]);

const PM_ABI = [
  { name: 'modifyLiquidities', type: 'function', inputs: [{ name: 'unlockData', type: 'bytes' }, { name: 'deadline', type: 'uint256' }], outputs: [] },
  { name: 'getPoolAndPositionInfo', type: 'function', inputs: [{ type: 'uint256' }], outputs: [{ type: 'tuple', components: [{ name: 'currency0', type: 'address' }, { name: 'currency1', type: 'address' }, { name: 'fee', type: 'uint24' }, { name: 'tickSpacing', type: 'int24' }, { name: 'hooks', type: 'address' }] }, { type: 'uint256' }] },
  { name: 'getPositionLiquidity', type: 'function', inputs: [{ type: 'uint256' }], outputs: [{ type: 'uint128' }] },
];

const ERC20 = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function approve(address,uint256) returns (bool)',
  'function allowance(address,address) view returns (uint256)',
  'function symbol() view returns (string)',
  'function transfer(address,uint256) returns (bool)',
]);

const SWAP_ABI = parseAbi([
  'function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) payable returns (uint256)',
]);

const PERMIT2_ABI = [
  { name: 'allowance', type: 'function', inputs: [{ type: 'address' }, { type: 'address' }, { type: 'address' }], outputs: [{ type: 'uint160' }, { type: 'uint48' }, { type: 'uint48' }] },
  { name: 'approve', type: 'function', inputs: [{ type: 'address' }, { type: 'address' }, { type: 'uint160' }, { type: 'uint48' }], outputs: [] },
];

const UNIVERSAL_ROUTER_ABI = [{
  name: 'execute', type: 'function',
  inputs: [{ name: 'commands', type: 'bytes' }, { name: 'inputs', type: 'bytes[]' }, { name: 'deadline', type: 'uint256' }],
  outputs: [],
}];

// ─── V4 Swap via Universal Router ────────────────────────────────────────────

/**
 * Swap token → WETH via V4 Universal Router.
 * Uses SWAP_EXACT_IN_SINGLE + SETTLE_ALL + TAKE_ALL pattern.
 * CRITICAL: ExactInputSingleParams must be encoded as a SINGLE STRUCT parameter.
 */
async function swapTokenToWethV4(pub, wallet, account, tokenAddress, amount, poolKey) {
  console.log(`   Swapping token → WETH via V4 Universal Router...`);

  // 1. Ensure ERC20 → Permit2 approval
  const erc20Allow = await retry(() => pub.readContract({
    address: tokenAddress, abi: ERC20, functionName: 'allowance',
    args: [account.address, C.PERMIT2],
  }));
  if (erc20Allow < amount) {
    console.log(`   Approving token → Permit2...`);
    const tx = await wallet.writeContract({
      address: tokenAddress, abi: ERC20, functionName: 'approve',
      args: [C.PERMIT2, maxUint256],
    });
    await pub.waitForTransactionReceipt({ hash: tx });
    await sleep(1000);
  }

  // 2. Ensure Permit2 → Universal Router approval
  const [p2Amount] = await retry(() => pub.readContract({
    address: C.PERMIT2, abi: PERMIT2_ABI, functionName: 'allowance',
    args: [account.address, tokenAddress, C.UNIVERSAL_ROUTER],
  }));
  if (BigInt(p2Amount) < amount) {
    console.log(`   Approving Universal Router on Permit2...`);
    const maxU160 = (1n << 160n) - 1n;
    const maxU48 = (1n << 48n) - 1n;
    const tx = await wallet.writeContract({
      address: C.PERMIT2, abi: PERMIT2_ABI, functionName: 'approve',
      args: [tokenAddress, C.UNIVERSAL_ROUTER, maxU160, maxU48],
    });
    await pub.waitForTransactionReceipt({ hash: tx });
    await sleep(1000);
  }

  // 3. Build V4_SWAP: SWAP_EXACT_IN_SINGLE(0x06) + SETTLE_ALL(0x0c) + TAKE_ALL(0x0f)
  const tokenIsC0 = tokenAddress.toLowerCase() === poolKey.currency0.toLowerCase();
  const zeroForOne = tokenIsC0;
  const inputCurrency = zeroForOne ? poolKey.currency0 : poolKey.currency1;
  const outputCurrency = zeroForOne ? poolKey.currency1 : poolKey.currency0;

  // CRITICAL: Encode as single struct parameter (CalldataDecoder reads first word as offset)
  const swapParams = defaultAbiCoder.encode(
    ['tuple(tuple(address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) poolKey, bool zeroForOne, uint128 amountIn, uint128 amountOutMinimum, bytes hookData)'],
    [{
      poolKey: { currency0: poolKey.currency0, currency1: poolKey.currency1, fee: poolKey.fee, tickSpacing: poolKey.tickSpacing, hooks: poolKey.hooks },
      zeroForOne,
      amountIn: amount.toString(),
      amountOutMinimum: '0',
      hookData: '0x',
    }]
  );
  const settleParams = defaultAbiCoder.encode(['address', 'uint256'], [inputCurrency, amount.toString()]);
  const takeParams = defaultAbiCoder.encode(['address', 'uint256'], [outputCurrency, '0']);
  const v4SwapInput = defaultAbiCoder.encode(['bytes', 'bytes[]'], ['0x060c0f', [swapParams, settleParams, takeParams]]);

  const deadline = BigInt(Math.floor(Date.now() / 1000) + 1800);
  const hash = await wallet.writeContract({
    address: C.UNIVERSAL_ROUTER, abi: UNIVERSAL_ROUTER_ABI,
    functionName: 'execute',
    args: ['0x10', [v4SwapInput], deadline],
  });
  const receipt = await pub.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') throw new Error(`V4 swap reverted: ${hash}`);
  console.log(`   ✅ V4 swap: ${hash.slice(0, 20)}...`);
  return { hash, receipt };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const pad32 = (hex) => hex.replace('0x', '').padStart(64, '0');

async function retry(fn, n = 3) {
  for (let i = 0; i < n; i++) {
    try { return await fn(); }
    catch (e) { if (i === n - 1) throw e; await sleep(2000); }
  }
}

async function getEthPrice() {
  try {
    const r = await fetch('https://api.dexscreener.com/latest/dex/tokens/0x4200000000000000000000000000000000000006');
    const d = await r.json();
    const p = d.pairs?.find(p => p.chainId === 'base' && p.quoteToken?.symbol === 'USDC');
    if (p) return parseFloat(p.priceUsd);
  } catch {} return 2700;
}

async function getTokenPrice(token) {
  try {
    const r = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${token}`);
    const d = await r.json();
    const p = d.pairs?.[0];
    if (p) return parseFloat(p.priceUsd);
  } catch {} return 0;
}

function tickToSqrtPriceX96(tick) {
  const Q96 = 2n ** 96n;
  const absTick = Math.abs(tick);
  let ratio = (absTick & 0x1) !== 0 ? 0xfffcb933bd6fad37aa2d162d1a594001n : (1n << 128n);
  const tickBits = [
    [0x2, 0xfff97272373d413259a46990580e213an], [0x4, 0xfff2e50f5f656932ef12357cf3c7fdccn],
    [0x8, 0xffe5caca7e10e4e61c3624eaa0941cd0n], [0x10, 0xffcb9843d60f6159c9db58835c926644n],
    [0x20, 0xff973b41fa98c081472e6896dfb254c0n], [0x40, 0xff2ea16466c96a3843ec78b326b52861n],
    [0x80, 0xfe5dee046a99a2a811c461f1969c3053n], [0x100, 0xfcbe86c7900a88aedcffc83b479aa3a4n],
    [0x200, 0xf987a7253ac413176f2b074cf7815e54n], [0x400, 0xf3392b0822b70005940c7a398e4b70f3n],
    [0x800, 0xe7159475a2c29b7443b29c7fa6e889d9n], [0x1000, 0xd097f3bdfd2022b8845ad8f792aa5825n],
    [0x2000, 0xa9f746462d870fdf8a65dc1f90e061e5n], [0x4000, 0x70d869a156d2a1b890bb3df62baf32f7n],
    [0x8000, 0x31be135f97d08fd981231505542fcfa6n], [0x10000, 0x9aa508b5b7a84e1c677de54f3e99bc9n],
    [0x20000, 0x5d6af8dedb81196699c329225ee604n], [0x40000, 0x2216e584f5fa1ea926041bedfe98n],
    [0x80000, 0x48a170391f7dc42444e8fa2n],
  ];
  for (const [bit, val] of tickBits) {
    if ((absTick & bit) !== 0) ratio = (ratio * val) >> 128n;
  }
  if (tick > 0) ratio = ((1n << 256n) - 1n) / ratio;
  return (ratio >> 32n) + (ratio % (1n << 32n) === 0n ? 0n : 1n);
}

// ─── Main ────────────────────────────────────────────────────────────────────
async function main() {
  const pk = process.env.NET_PRIVATE_KEY;
  if (!pk) { console.error('❌ NET_PRIVATE_KEY not set'); process.exit(1); }

  const account = privateKeyToAccount(pk);
  const rpcUrl = process.env.BASE_RPC_URL || 'https://mainnet.base.org';
  const transport = http(rpcUrl);
  const pub = createPublicClient({ chain: base, transport });
  const wallet = createWalletClient({ chain: base, transport, account });

  // Token info
  let symbol = 'TOKEN';
  try { symbol = await pub.readContract({ address: cfg.token, abi: ERC20, functionName: 'symbol' }); } catch {}

  // Determine mode string
  const steps = [];
  if (!cfg.skipClaim) steps.push('claim');
  if (!cfg.skipLp && cfg.tokenId) steps.push('collect-lp');
  if (wantBurn) steps.push(`burn(${cfg.burnPct}%)→🔥`);
  if (wantCompound) steps.push(`compound(${cfg.compoundPct}%)`);
  if (wantHarvest) steps.push(`harvest(${harvestPct}%)→USDC`);

  console.log(`
🌾 Clanker Harvest
═══════════════════════════════════════════════════
🪙  Token: ${symbol} (${cfg.token})
📋  Pipeline: ${steps.join(' → ')}
${cfg.tokenId ? `📊  Position: #${cfg.tokenId}\n` : ''}${cfg.harvestAddress ? `📬  Vault: ${cfg.harvestAddress}\n` : ''}${cfg.minUsd > 0 ? `⚙️   Min threshold: $${cfg.minUsd}\n` : ''}👛  Wallet: ${account.address}
${cfg.dryRun ? '🔮  DRY RUN' : '🔥  LIVE'}
═══════════════════════════════════════════════════`);

  // Get prices for threshold check & reporting
  const [ethPrice, tokenPrice] = await Promise.all([getEthPrice(), getTokenPrice(cfg.token)]);
  console.log(`📈 Prices: ETH $${ethPrice.toFixed(0)} | ${symbol} $${tokenPrice.toFixed(10)}`);

  // Track total claimed amounts
  let claimedWeth = 0n;
  let claimedToken = 0n;

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 1: Claim Clanker protocol fees
  // ═══════════════════════════════════════════════════════════════════════════
  if (!cfg.skipClaim) {
    console.log(`\n📌 Step: Claim Clanker fees`);

    const [availWeth, availToken] = await Promise.all([
      retry(() => pub.readContract({ address: cfg.feeContract, abi: CLANKER_ABI, functionName: 'availableFees', args: [account.address, C.WETH] })),
      retry(() => pub.readContract({ address: cfg.feeContract, abi: CLANKER_ABI, functionName: 'availableFees', args: [account.address, cfg.token] })),
    ]);

    const wethUsd = parseFloat(formatEther(availWeth)) * ethPrice;
    const tokenUsd = parseFloat(formatEther(availToken)) * tokenPrice;
    console.log(`   WETH:  ${formatEther(availWeth)} (~$${wethUsd.toFixed(2)})`);
    console.log(`   ${symbol}: ${formatEther(availToken)} (~$${tokenUsd.toFixed(2)})`);
    console.log(`   Total: $${(wethUsd + tokenUsd).toFixed(2)}`);

    if (availWeth === 0n && availToken === 0n) {
      console.log(`   → Nothing to claim`);
    } else if (cfg.dryRun) {
      console.log(`   🔮 Would claim`);
      claimedWeth = availWeth;
      claimedToken = availToken;
    } else {
      if (availToken > 0n) {
        console.log(`   Claiming ${symbol}...`);
        const tx = await wallet.writeContract({ address: cfg.feeContract, abi: CLANKER_ABI, functionName: 'claim', args: [account.address, cfg.token] });
        await pub.waitForTransactionReceipt({ hash: tx });
        console.log(`   ✅ TX: ${tx.slice(0, 20)}...`);
        claimedToken = availToken;
        await sleep(2000);
      }
      if (availWeth > 0n) {
        console.log(`   Claiming WETH...`);
        const tx = await wallet.writeContract({ address: cfg.feeContract, abi: CLANKER_ABI, functionName: 'claim', args: [account.address, C.WETH] });
        await pub.waitForTransactionReceipt({ hash: tx });
        console.log(`   ✅ TX: ${tx.slice(0, 20)}...`);
        claimedWeth = availWeth;
        await sleep(1000);
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 2: Collect LP position fees
  // ═══════════════════════════════════════════════════════════════════════════
  let lpWeth = 0n;
  let lpToken = 0n;
  let poolKey = null;

  if (!cfg.skipLp && cfg.tokenId) {
    console.log(`\n📌 Step: Collect LP fees (#${cfg.tokenId})`);

    const tokenId = BigInt(cfg.tokenId);
    const [pk_result, posInfo] = await retry(() => pub.readContract({
      address: C.POSITION_MANAGER, abi: PM_ABI,
      functionName: 'getPoolAndPositionInfo', args: [tokenId],
    }));
    poolKey = pk_result;

    // Snapshot balances before collect
    const [wethBefore, tokenBefore] = await Promise.all([
      pub.readContract({ address: C.WETH, abi: ERC20, functionName: 'balanceOf', args: [account.address] }),
      pub.readContract({ address: cfg.token, abi: ERC20, functionName: 'balanceOf', args: [account.address] }),
    ]);

    if (cfg.dryRun) {
      console.log(`   🔮 Would collect LP fees`);
    } else {
      // Approve Permit2 if needed
      for (const addr of [poolKey.currency0, poolKey.currency1]) {
        const allow = await pub.readContract({ address: addr, abi: ERC20, functionName: 'allowance', args: [account.address, C.PERMIT2] });
        if (allow < BigInt('0xffffffffffffffffffffffff')) {
          console.log(`   Approving ${addr.slice(0, 10)}... to Permit2...`);
          const tx = await wallet.writeContract({ address: addr, abi: ERC20, functionName: 'approve', args: [C.PERMIT2, maxUint256] });
          await pub.waitForTransactionReceipt({ hash: tx });
          await sleep(500);
        }
      }

      // DECREASE(0x01) with 0 liquidity + CLOSE_CURRENCY(0x11) x2
      const collectActions = '0x0111';
      const decreaseParams = '0x' +
        pad32('0x' + tokenId.toString(16)) +
        '0'.padStart(64, '0') +
        '0'.padStart(64, '0') +
        '0'.padStart(64, '0') +
        (5 * 32).toString(16).padStart(64, '0') +
        '0'.padStart(64, '0');

      const closeParams = '0x' +
        pad32(poolKey.currency0) +
        pad32(poolKey.currency1) +
        pad32(account.address);

      const collectData = encodeAbiParameters(
        parseAbiParameters('bytes, bytes[]'),
        [collectActions, [decreaseParams, closeParams]]
      );

      const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);
      const tx = await wallet.writeContract({
        address: C.POSITION_MANAGER, abi: PM_ABI,
        functionName: 'modifyLiquidities', args: [collectData, deadline],
      });
      await pub.waitForTransactionReceipt({ hash: tx });
      console.log(`   ✅ Collected: ${tx.slice(0, 20)}...`);
      await sleep(1000);

      // Measure what we got
      const [wethAfter, tokenAfter] = await Promise.all([
        pub.readContract({ address: C.WETH, abi: ERC20, functionName: 'balanceOf', args: [account.address] }),
        pub.readContract({ address: cfg.token, abi: ERC20, functionName: 'balanceOf', args: [account.address] }),
      ]);
      lpWeth = wethAfter - wethBefore;
      lpToken = tokenAfter - tokenBefore;
    }

    const lpWethUsd = parseFloat(formatEther(lpWeth)) * ethPrice;
    const lpTokenUsd = parseFloat(formatEther(lpToken)) * tokenPrice;
    console.log(`   WETH:  ${formatEther(lpWeth)} (~$${lpWethUsd.toFixed(2)})`);
    console.log(`   ${symbol}: ${formatEther(lpToken)} (~$${lpTokenUsd.toFixed(2)})`);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TOTAL & THRESHOLD CHECK
  // ═══════════════════════════════════════════════════════════════════════════
  const totalWeth = claimedWeth + lpWeth;
  const totalToken = claimedToken + lpToken;
  const totalUsd = parseFloat(formatEther(totalWeth)) * ethPrice + parseFloat(formatEther(totalToken)) * tokenPrice;

  console.log(`\n💰 Total fees: $${totalUsd.toFixed(2)}`);
  console.log(`   WETH:  ${formatEther(totalWeth)}`);
  console.log(`   ${symbol}: ${formatEther(totalToken)}`);

  if (totalWeth === 0n && totalToken === 0n) {
    console.log(`\n✅ Nothing to process. Done.`);
    return { totalUsd: 0, compounded: 0, harvested: 0 };
  }

  if (cfg.minUsd > 0 && totalUsd < cfg.minUsd) {
    console.log(`\n⏸️  Below threshold ($${totalUsd.toFixed(2)} < $${cfg.minUsd}). Fees stay in wallet.`);
    return { totalUsd, compounded: 0, harvested: 0, belowThreshold: true };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP: Buy & Burn (rebalance so burnPct% is in AXIOM, then burn)
  // ═══════════════════════════════════════════════════════════════════════════
  let burnedToken = 0n;
  let burnTxHash = null;

  if (wantBurn && (totalWeth > 0n || totalToken > 0n)) {
    console.log(`\n🔥 Step: Buy & Burn (${cfg.burnPct}% of total value)`);

    // Calculate current USD values
    const wethValueUsd = parseFloat(formatEther(totalWeth)) * ethPrice;
    const tokenValueUsd = parseFloat(formatEther(totalToken)) * tokenPrice;
    const totalValueUsd = wethValueUsd + tokenValueUsd;
    const burnTargetUsd = totalValueUsd * cfg.burnPct / 100;

    console.log(`   Total value: $${totalValueUsd.toFixed(2)}`);
    console.log(`   Burn target: $${burnTargetUsd.toFixed(2)} (${cfg.burnPct}%)`);
    console.log(`   Current AXIOM value: $${tokenValueUsd.toFixed(2)}`);
    console.log(`   Current WETH value: $${wethValueUsd.toFixed(2)}`);

    if (tokenPrice <= 0) {
      console.log(`   ❌ Cannot burn — token price is $0, would lose everything`);
    } else if (cfg.dryRun) {
      console.log(`   🔮 Would rebalance and burn`);
    } else {
      // Ensure we have pool key for V4 swaps
      if (!poolKey && cfg.tokenId) {
        const [pk_result] = await retry(() => pub.readContract({
          address: C.POSITION_MANAGER, abi: PM_ABI,
          functionName: 'getPoolAndPositionInfo', args: [BigInt(cfg.tokenId)],
        }));
        poolKey = pk_result;
      }

      // How much AXIOM do we need for the burn?
      const burnTargetTokens = BigInt(Math.floor(burnTargetUsd / tokenPrice * 1e18));

      // Get current token balance in wallet
      const currentTokenBal = await pub.readContract({
        address: cfg.token, abi: ERC20, functionName: 'balanceOf', args: [account.address],
      });

      if (currentTokenBal >= burnTargetTokens) {
        // We have enough AXIOM already — might need to sell excess AXIOM→WETH
        const excessToken = currentTokenBal - burnTargetTokens;
        if (excessToken > 0n && poolKey) {
          const excessUsd = parseFloat(formatEther(excessToken)) * tokenPrice;
          if (excessUsd > 1) { // only swap if > $1 excess
            console.log(`   Selling excess ${formatEther(excessToken)} ${symbol} → WETH (worth ~$${excessUsd.toFixed(2)})...`);
            try {
              await swapTokenToWethV4(pub, wallet, account, cfg.token, excessToken, poolKey);
              await sleep(2000);
            } catch (err) {
              console.log(`   ⚠️ Excess token→WETH swap failed: ${err.shortMessage || err.message}`);
            }
          }
        }
        burnedToken = burnTargetTokens;
      } else {
        // Need to buy more AXIOM with WETH
        const shortfallUsd = burnTargetUsd - (parseFloat(formatEther(currentTokenBal)) * tokenPrice);
        const wethNeeded = BigInt(Math.floor(shortfallUsd / ethPrice * 1e18));
        
        // Check we have enough WETH
        const currentWethBal = await pub.readContract({
          address: C.WETH, abi: ERC20, functionName: 'balanceOf', args: [account.address],
        });
        const swapWeth = wethNeeded < currentWethBal ? wethNeeded : currentWethBal;

        if (swapWeth > 0n && poolKey) {
          console.log(`   Buying ${symbol} with ${formatEther(swapWeth)} WETH (~$${(parseFloat(formatEther(swapWeth)) * ethPrice).toFixed(2)})...`);
          try {
            // Swap WETH → TOKEN via V4 (reverse direction)
            // We need to use Universal Router for WETH→TOKEN
            const tokenIsC0 = cfg.token.toLowerCase() === poolKey.currency0.toLowerCase();
            const zeroForOne = !tokenIsC0; // WETH is the input, so if token is c0, we go c1→c0

            // ERC20 → Permit2 approval for WETH
            const erc20Allow = await retry(() => pub.readContract({
              address: C.WETH, abi: ERC20, functionName: 'allowance',
              args: [account.address, C.PERMIT2],
            }));
            if (erc20Allow < swapWeth) {
              console.log(`   Approving WETH → Permit2...`);
              const tx = await wallet.writeContract({
                address: C.WETH, abi: ERC20, functionName: 'approve',
                args: [C.PERMIT2, maxUint256],
              });
              await pub.waitForTransactionReceipt({ hash: tx });
              await sleep(1000);
            }

            // Permit2 → Universal Router approval for WETH
            const [p2Amount] = await retry(() => pub.readContract({
              address: C.PERMIT2, abi: PERMIT2_ABI, functionName: 'allowance',
              args: [account.address, C.WETH, C.UNIVERSAL_ROUTER],
            }));
            if (BigInt(p2Amount) < swapWeth) {
              console.log(`   Approving Universal Router on Permit2 for WETH...`);
              const maxU160 = (1n << 160n) - 1n;
              const maxU48 = (1n << 48n) - 1n;
              const tx = await wallet.writeContract({
                address: C.PERMIT2, abi: PERMIT2_ABI, functionName: 'approve',
                args: [C.WETH, C.UNIVERSAL_ROUTER, maxU160, maxU48],
              });
              await pub.waitForTransactionReceipt({ hash: tx });
              await sleep(1000);
            }

            const inputCurrency = zeroForOne ? poolKey.currency0 : poolKey.currency1;
            const outputCurrency = zeroForOne ? poolKey.currency1 : poolKey.currency0;

            const swapParams = defaultAbiCoder.encode(
              ['tuple(tuple(address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) poolKey, bool zeroForOne, uint128 amountIn, uint128 amountOutMinimum, bytes hookData)'],
              [{
                poolKey: { currency0: poolKey.currency0, currency1: poolKey.currency1, fee: poolKey.fee, tickSpacing: poolKey.tickSpacing, hooks: poolKey.hooks },
                zeroForOne,
                amountIn: swapWeth.toString(),
                amountOutMinimum: '0',
                hookData: '0x',
              }]
            );
            const settleParams = defaultAbiCoder.encode(['address', 'uint256'], [inputCurrency, swapWeth.toString()]);
            const takeParams = defaultAbiCoder.encode(['address', 'uint256'], [outputCurrency, '0']);
            const v4SwapInput = defaultAbiCoder.encode(['bytes', 'bytes[]'], ['0x060c0f', [swapParams, settleParams, takeParams]]);

            const deadline = BigInt(Math.floor(Date.now() / 1000) + 1800);
            const hash = await wallet.writeContract({
              address: C.UNIVERSAL_ROUTER, abi: UNIVERSAL_ROUTER_ABI,
              functionName: 'execute',
              args: ['0x10', [v4SwapInput], deadline],
            });
            const receipt = await pub.waitForTransactionReceipt({ hash });
            if (receipt.status !== 'success') throw new Error(`V4 swap reverted: ${hash}`);
            console.log(`   ✅ WETH → ${symbol}: ${hash.slice(0, 20)}...`);
            await sleep(2000);
          } catch (err) {
            console.log(`   ❌ WETH→${symbol} swap failed: ${err.shortMessage || err.message}`);
          }
        }

        // Recheck token balance after swap
        const newTokenBal = await pub.readContract({
          address: cfg.token, abi: ERC20, functionName: 'balanceOf', args: [account.address],
        });
        burnedToken = newTokenBal < burnTargetTokens ? newTokenBal : burnTargetTokens;
      }

      // BURN: Transfer tokens to dead address
      if (burnedToken > 0n) {
        console.log(`   🔥 Burning ${formatEther(burnedToken)} ${symbol} (~$${(parseFloat(formatEther(burnedToken)) * tokenPrice).toFixed(2)})...`);
        const tx = await wallet.writeContract({
          address: cfg.token, abi: ERC20, functionName: 'transfer',
          args: [DEAD_ADDRESS, burnedToken],
        });
        await pub.waitForTransactionReceipt({ hash: tx });
        burnTxHash = tx;
        console.log(`   ✅ Burned! TX: https://basescan.org/tx/${tx}`);
        await sleep(1000);
      } else {
        console.log(`   ⚠️ No tokens to burn after rebalancing`);
      }
    }

    // Update totals after burn (remaining goes to compound/harvest)
    const remainingWeth = await pub.readContract({ address: C.WETH, abi: ERC20, functionName: 'balanceOf', args: [account.address] });
    const remainingToken = await pub.readContract({ address: cfg.token, abi: ERC20, functionName: 'balanceOf', args: [account.address] });

    // Recalculate with remaining balances for compound/harvest split
    // The burn has consumed its share; remaining is split between compound and harvest
    const remainingPct = 100 - cfg.burnPct;
    const compoundOfRemaining = remainingPct > 0 ? cfg.compoundPct * 100 / remainingPct : 0;
    const harvestOfRemaining = remainingPct > 0 ? harvestPct * 100 / remainingPct : 0;

    console.log(`   Remaining after burn: ${formatEther(remainingWeth)} WETH + ${formatEther(remainingToken)} ${symbol}`);
  }

  // Split remaining for compound/harvest (use wallet balances post-burn)
  let compoundWeth, compoundToken, harvestWethAmt, harvestTokenAmt;

  if (wantBurn) {
    // After burn, use actual wallet balances
    const walletWeth = await pub.readContract({ address: C.WETH, abi: ERC20, functionName: 'balanceOf', args: [account.address] });
    const walletToken = await pub.readContract({ address: cfg.token, abi: ERC20, functionName: 'balanceOf', args: [account.address] });
    
    if (wantCompound && wantHarvest) {
      const compRatio = BigInt(cfg.compoundPct);
      const totalRatio = BigInt(cfg.compoundPct + harvestPct);
      compoundWeth = walletWeth * compRatio / totalRatio;
      compoundToken = walletToken * compRatio / totalRatio;
      harvestWethAmt = walletWeth - compoundWeth;
      harvestTokenAmt = walletToken - compoundToken;
    } else if (wantCompound) {
      compoundWeth = walletWeth;
      compoundToken = walletToken;
      harvestWethAmt = 0n;
      harvestTokenAmt = 0n;
    } else {
      compoundWeth = 0n;
      compoundToken = 0n;
      harvestWethAmt = walletWeth;
      harvestTokenAmt = walletToken;
    }
  } else {
    compoundWeth = totalWeth * BigInt(cfg.compoundPct) / 100n;
    compoundToken = totalToken * BigInt(cfg.compoundPct) / 100n;
    harvestWethAmt = totalWeth - compoundWeth;
    harvestTokenAmt = totalToken - compoundToken;
  }

  const harvestWeth = harvestWethAmt;
  const harvestToken = harvestTokenAmt;

  console.log(`\n📊 Split: ${cfg.burnPct > 0 ? cfg.burnPct + '% burn / ' : ''}${cfg.compoundPct}% compound / ${harvestPct}% harvest`);
  if (wantBurn && burnedToken > 0n) console.log(`   Burned:   ${formatEther(burnedToken)} ${symbol} (~$${(parseFloat(formatEther(burnedToken)) * tokenPrice).toFixed(2)})`);
  if (wantCompound) console.log(`   Compound: ${formatEther(compoundWeth)} WETH + ${formatEther(compoundToken)} ${symbol}`);
  if (wantHarvest) console.log(`   Harvest:  ${formatEther(harvestWeth)} WETH + ${formatEther(harvestToken)} ${symbol}`);

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 3: Compound into LP
  // ═══════════════════════════════════════════════════════════════════════════
  if (wantCompound && (compoundWeth > 0n || compoundToken > 0n)) {
    console.log(`\n📌 Step: Compound ${cfg.compoundPct}% → LP #${cfg.tokenId}`);

    if (cfg.dryRun) {
      console.log(`   🔮 Would compound`);
    } else {
      try {
        if (!poolKey) {
          const [pk_result] = await retry(() => pub.readContract({
            address: C.POSITION_MANAGER, abi: PM_ABI,
            functionName: 'getPoolAndPositionInfo', args: [BigInt(cfg.tokenId)],
          }));
          poolKey = pk_result;
        }

        const tokenId = BigInt(cfg.tokenId);

        // Read current tick for liquidity calculation
        const { keccak256, encodePacked } = await import('viem');
        const poolId = keccak256(encodeAbiParameters(
          parseAbiParameters('address, address, uint24, int24, address'),
          [poolKey.currency0, poolKey.currency1, poolKey.fee, poolKey.tickSpacing, poolKey.hooks]
        ));
        const stateViewAbi = [{ name: 'getSlot0', type: 'function', inputs: [{ type: 'bytes32' }], outputs: [{ type: 'uint160' }, { type: 'int24' }, { type: 'uint24' }, { type: 'uint24' }] }];
        const [sqrtPriceX96, currentTick] = await retry(() => pub.readContract({
          address: '0xa3c0c9b65bad0b08107aa264b0f3db444b867a71', abi: stateViewAbi,
          functionName: 'getSlot0', args: [poolId],
        }));

        // Read position tick range from posInfo
        const [, posInfo] = await retry(() => pub.readContract({
          address: C.POSITION_MANAGER, abi: PM_ABI,
          functionName: 'getPoolAndPositionInfo', args: [tokenId],
        }));
        const rawLower = Number(BigInt(posInfo) >> 232n);
        const rawUpper = Number((BigInt(posInfo) >> 208n) & BigInt(0xFFFFFF));
        const tL = rawLower > 0x7FFFFF ? rawLower - 0x1000000 : rawLower;
        const tU = rawUpper > 0x7FFFFF ? rawUpper - 0x1000000 : rawUpper;
        const tickLower = Math.min(tL, tU);
        const tickUpper = Math.max(tL, tU);

        // Calculate liquidity from amounts
        const sqrtLower = tickToSqrtPriceX96(tickLower);
        const sqrtUpper = tickToSqrtPriceX96(tickUpper);
        const Q96 = 2n ** 96n;

        let liquidity;
        const isWethCurrency0 = poolKey.currency0.toLowerCase() === C.WETH.toLowerCase();
        const amount0 = isWethCurrency0 ? compoundWeth : compoundToken;
        const amount1 = isWethCurrency0 ? compoundToken : compoundWeth;

        if (sqrtPriceX96 <= sqrtLower) {
          liquidity = amount0 * sqrtLower * sqrtUpper / ((sqrtUpper - sqrtLower) * Q96);
        } else if (sqrtPriceX96 >= sqrtUpper) {
          liquidity = amount1 * Q96 / (sqrtUpper - sqrtLower);
        } else {
          const liq0 = amount0 * sqrtPriceX96 * sqrtUpper / ((sqrtUpper - sqrtPriceX96) * Q96);
          const liq1 = amount1 * Q96 / (sqrtPriceX96 - sqrtLower);
          liquidity = liq0 < liq1 ? liq0 : liq1;
        }

        if (liquidity <= 0n) {
          console.log(`   ⚠️ Computed liquidity = 0, skipping compound`);
        } else {
          // Slippage buffer on max amounts
          const slippageMul = BigInt(Math.floor((100 + cfg.slippage * 2) * 100));
          const amount0Max = amount0 * slippageMul / 10000n;
          const amount1Max = amount1 * slippageMul / 10000n;

          // INCREASE(0x00) + SETTLE_PAIR(0x0d)
          const addActions = '0x000d';
          const { defaultAbiCoder } = await import('./node_modules/@ethersproject/abi/lib/index.js');
          const increaseParams = defaultAbiCoder.encode(
            ['uint256', 'uint256', 'uint128', 'uint128', 'bytes'],
            [tokenId.toString(), liquidity.toString(), amount0Max.toString(), amount1Max.toString(), '0x']
          );
          const settleParams = defaultAbiCoder.encode(
            ['address', 'address'],
            [poolKey.currency0, poolKey.currency1]
          );
          const addData = encodeAbiParameters(
            parseAbiParameters('bytes, bytes[]'),
            [addActions, [increaseParams, settleParams]]
          );

          const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);
          const tx = await wallet.writeContract({
            address: C.POSITION_MANAGER, abi: PM_ABI,
            functionName: 'modifyLiquidities', args: [addData, deadline],
          });
          await pub.waitForTransactionReceipt({ hash: tx });
          console.log(`   ✅ Compounded! TX: ${tx.slice(0, 20)}...`);
          await sleep(1000);
        }
      } catch (err) {
        console.log(`   ⚠️ Compound failed: ${err.shortMessage || err.message}`);
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 4: Swap harvest WETH → 50% USDC + 50% BNKR, send to treasury
  // ═══════════════════════════════════════════════════════════════════════════
  let harvestedUsdc = 0n;
  let harvestedBnkr = 0n;
  let usdcTxHash = null;
  let bnkrTxHash = null;
  const treasuryAddr = cfg.treasuryAddress || cfg.harvestAddress;

  if ((wantHarvest || cfg.bnkrPct > 0) && (harvestWeth > 0n || harvestToken > 0n)) {
    // First: swap any remaining harvest tokens → WETH
    if (harvestToken > 0n && poolKey && !cfg.dryRun) {
      try {
        console.log(`\n📌 Step: Swap remaining ${formatEther(harvestToken)} ${symbol} → WETH`);
        const wethBefore = await pub.readContract({ address: C.WETH, abi: ERC20, functionName: 'balanceOf', args: [account.address] });
        await swapTokenToWethV4(pub, wallet, account, cfg.token, harvestToken, poolKey);
        await sleep(2000);
        const wethAfter = await pub.readContract({ address: C.WETH, abi: ERC20, functionName: 'balanceOf', args: [account.address] });
        harvestWeth = harvestWeth + (wethAfter - wethBefore);
        console.log(`   Total harvest WETH now: ${formatEther(harvestWeth)}`);
      } catch (err) {
        console.log(`   ⚠️ Token→WETH swap failed: ${err.shortMessage || err.message}`);
      }
    }

    // Get actual WETH balance for harvest
    const actualWeth = await pub.readContract({ address: C.WETH, abi: ERC20, functionName: 'balanceOf', args: [account.address] });
    const wethForHarvest = actualWeth < harvestWeth ? actualWeth : harvestWeth;

    // Split WETH: 50% → USDC, 50% → BNKR
    const wethForUsdc = wethForHarvest / 2n;
    const wethForBnkr = wethForHarvest - wethForUsdc;

    console.log(`\n📌 Step: Split harvest WETH → 50% USDC + 50% BNKR`);
    console.log(`   WETH for USDC: ${formatEther(wethForUsdc)}`);
    console.log(`   WETH for BNKR: ${formatEther(wethForBnkr)}`);

    if (cfg.dryRun) {
      const est = parseFloat(formatEther(wethForHarvest)) * ethPrice;
      console.log(`   🔮 Would swap ~$${est.toFixed(2)} (50/50 USDC/BNKR)`);
    } else {
      // Ensure WETH approved for SwapRouter
      const allow = await pub.readContract({ address: C.WETH, abi: ERC20, functionName: 'allowance', args: [account.address, C.SWAP_ROUTER] });
      if (allow < wethForHarvest) {
        const tx = await wallet.writeContract({ address: C.WETH, abi: ERC20, functionName: 'approve', args: [C.SWAP_ROUTER, maxUint256] });
        await pub.waitForTransactionReceipt({ hash: tx });
        await sleep(500);
      }

      // Swap WETH → USDC (50%)
      if (wethForUsdc > 0n) {
        try {
          console.log(`   Swapping ${formatEther(wethForUsdc)} WETH → USDC...`);
          const usdcBefore = await pub.readContract({ address: C.USDC, abi: ERC20, functionName: 'balanceOf', args: [account.address] });
          const tx = await wallet.writeContract({
            address: C.SWAP_ROUTER, abi: SWAP_ABI,
            functionName: 'exactInputSingle',
            args: [{ tokenIn: C.WETH, tokenOut: C.USDC, fee: 500, recipient: account.address, amountIn: wethForUsdc, amountOutMinimum: 0n, sqrtPriceLimitX96: 0n }],
          });
          await pub.waitForTransactionReceipt({ hash: tx });
          await sleep(1000);
          const usdcAfter = await pub.readContract({ address: C.USDC, abi: ERC20, functionName: 'balanceOf', args: [account.address] });
          harvestedUsdc = usdcAfter - usdcBefore;
          console.log(`   ✅ WETH → USDC: ${formatUnits(harvestedUsdc, 6)} USDC | ${tx.slice(0, 20)}...`);
        } catch (err) {
          console.log(`   ❌ WETH→USDC swap failed: ${err.shortMessage || err.message}`);
        }
      }

      // Swap WETH → BNKR (50%) via V3 (WETH→BNKR pool)
      if (wethForBnkr > 0n) {
        try {
          console.log(`   Swapping ${formatEther(wethForBnkr)} WETH → BNKR...`);
          const bnkrBefore = await pub.readContract({ address: C.BNKR, abi: ERC20, functionName: 'balanceOf', args: [account.address] });
          // Try 1% fee tier first (10000), then 0.3% (3000)
          let swapped = false;
          for (const fee of [10000, 3000, 500]) {
            try {
              const tx = await wallet.writeContract({
                address: C.SWAP_ROUTER, abi: SWAP_ABI,
                functionName: 'exactInputSingle',
                args: [{ tokenIn: C.WETH, tokenOut: C.BNKR, fee, recipient: account.address, amountIn: wethForBnkr, amountOutMinimum: 0n, sqrtPriceLimitX96: 0n }],
              });
              await pub.waitForTransactionReceipt({ hash: tx });
              swapped = true;
              await sleep(1000);
              const bnkrAfter = await pub.readContract({ address: C.BNKR, abi: ERC20, functionName: 'balanceOf', args: [account.address] });
              harvestedBnkr = bnkrAfter - bnkrBefore;
              console.log(`   ✅ WETH → BNKR: ${formatEther(harvestedBnkr)} BNKR (fee tier ${fee}) | ${tx.slice(0, 20)}...`);
              break;
            } catch (e) {
              console.log(`   Fee tier ${fee} failed, trying next...`);
            }
          }
          if (!swapped) {
            console.log(`   ❌ All WETH→BNKR fee tiers failed. WETH remains in wallet.`);
          }
        } catch (err) {
          console.log(`   ❌ WETH→BNKR swap failed: ${err.shortMessage || err.message}`);
        }
      }

      // Transfer USDC to treasury
      if (harvestedUsdc > 0n && treasuryAddr) {
        console.log(`\n📌 Step: Transfer USDC → treasury`);
        console.log(`   Amount: ${formatUnits(harvestedUsdc, 6)} USDC → ${treasuryAddr}`);
        const tx = await wallet.writeContract({
          address: C.USDC, abi: ERC20, functionName: 'transfer',
          args: [treasuryAddr, harvestedUsdc],
        });
        await pub.waitForTransactionReceipt({ hash: tx });
        usdcTxHash = tx;
        console.log(`   ✅ USDC sent! TX: https://basescan.org/tx/${tx}`);
        await sleep(500);
      }

      // Transfer BNKR to treasury
      if (harvestedBnkr > 0n && treasuryAddr) {
        console.log(`\n📌 Step: Transfer BNKR → treasury`);
        console.log(`   Amount: ${formatEther(harvestedBnkr)} BNKR → ${treasuryAddr}`);
        const tx = await wallet.writeContract({
          address: C.BNKR, abi: ERC20, functionName: 'transfer',
          args: [treasuryAddr, harvestedBnkr],
        });
        await pub.waitForTransactionReceipt({ hash: tx });
        bnkrTxHash = tx;
        console.log(`   ✅ BNKR sent! TX: https://basescan.org/tx/${tx}`);
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SUMMARY
  // ═══════════════════════════════════════════════════════════════════════════
  console.log(`
═══════════════════════════════════════════════════
✅ Clanker Harvest Complete
═══════════════════════════════════════════════════
   Total fees:     $${totalUsd.toFixed(2)}
   Clanker fees:   ${formatEther(claimedWeth)} WETH + ${formatEther(claimedToken)} ${symbol}
   LP fees:        ${formatEther(lpWeth)} WETH + ${formatEther(lpToken)} ${symbol}${burnedToken > 0n ? `\n   🔥 Burned:      ${formatEther(burnedToken)} ${symbol} (~$${(parseFloat(formatEther(burnedToken)) * tokenPrice).toFixed(2)})` : ''}${burnTxHash ? `\n   Burn TX:       https://basescan.org/tx/${burnTxHash}` : ''}${harvestedUsdc > 0n ? `\n   💵 USDC:       ${formatUnits(harvestedUsdc, 6)} USDC → treasury` : ''}${usdcTxHash ? `\n   USDC TX:      https://basescan.org/tx/${usdcTxHash}` : ''}${harvestedBnkr > 0n ? `\n   🏦 BNKR:       ${formatEther(harvestedBnkr)} BNKR → treasury` : ''}${bnkrTxHash ? `\n   BNKR TX:      https://basescan.org/tx/${bnkrTxHash}` : ''}${treasuryAddr ? `\n   Treasury:     ${treasuryAddr}` : ''}
═══════════════════════════════════════════════════`);

  return { totalUsd, compounded: cfg.compoundPct, harvested: parseFloat(formatUnits(harvestedUsdc, 6)), harvestedBnkr: parseFloat(formatEther(harvestedBnkr)), burned: parseFloat(formatEther(burnedToken)), burnTxHash, usdcTxHash, bnkrTxHash };
}

main().catch(err => { console.error('❌ Fatal:', err.message); process.exit(1); });
