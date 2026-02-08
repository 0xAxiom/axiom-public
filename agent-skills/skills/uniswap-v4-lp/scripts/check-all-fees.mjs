import { createPublicClient, http, formatEther } from 'viem';
import { base } from 'viem/chains';
import { defaultAbiCoder } from '@ethersproject/abi';
import * as dotenv from 'dotenv';
import { resolve } from 'path';
dotenv.config({ path: resolve(process.env.HOME, '.axiom/wallet.env') });

const PM = '0x7c5f5a4bbd8fd63184577525326123b519429bdc';
const SV = '0xa3c0c9b65bad0b08107aa264b0f3db444b867a71';
const PKS = '(address,address,uint24,int24,address)';

const PM_ABI = [
  { name: 'getPoolAndPositionInfo', type: 'function', inputs: [{ type: 'uint256' }], outputs: [{ type: 'tuple', components: [{ name: 'currency0', type: 'address' }, { name: 'currency1', type: 'address' }, { name: 'fee', type: 'uint24' }, { name: 'tickSpacing', type: 'int24' }, { name: 'hooks', type: 'address' }] }, { type: 'uint256' }] },
  { name: 'getPositionLiquidity', type: 'function', inputs: [{ type: 'uint256' }], outputs: [{ type: 'uint128' }] },
];

const SV_ABI = [
  { name: 'getSlot0', type: 'function', inputs: [{ type: 'bytes32' }], outputs: [{ type: 'uint160' }, { type: 'int24' }, { type: 'uint24' }, { type: 'uint24' }] },
  { name: 'getPositionInfo', type: 'function', inputs: [{ type: 'bytes32' }, { type: 'address' }, { type: 'int24' }, { type: 'int24' }, { type: 'bytes32' }], outputs: [{ type: 'uint128' }, { type: 'uint256' }, { type: 'uint256' }] },
];

const pub = createPublicClient({ chain: base, transport: http(process.env.BASE_RPC_URL || 'https://mainnet.base.org') });
const sleep = ms => new Promise(r => setTimeout(r, ms));

const Q96 = BigInt(2) ** BigInt(96);
const toInt24 = v => v >= 0x800000 ? v - 0x1000000 : v;

async function checkPosition(tokenId) {
  const [poolKey, posInfo] = await pub.readContract({ address: PM, abi: PM_ABI, functionName: 'getPoolAndPositionInfo', args: [BigInt(tokenId)] });
  await sleep(500);
  const liq = await pub.readContract({ address: PM, abi: PM_ABI, functionName: 'getPositionLiquidity', args: [BigInt(tokenId)] });
  await sleep(500);

  const { keccak256 } = await import('viem');
  const poolId = keccak256(defaultAbiCoder.encode([PKS], [[poolKey.currency0, poolKey.currency1, poolKey.fee, poolKey.tickSpacing, poolKey.hooks]]));
  const [sqrtPrice, currentTick] = await pub.readContract({ address: SV, abi: SV_ABI, functionName: 'getSlot0', args: [poolId] });
  await sleep(500);

  const posInfoBN = BigInt(posInfo);
  const rawA = toInt24(Number((posInfoBN >> 32n) & 0xFFFFFFn));
  const rawB = toInt24(Number((posInfoBN >> 8n) & 0xFFFFFFn));
  const tickLower = Math.min(rawA, rawB);
  const tickUpper = Math.max(rawA, rawB);
  const salt = '0x' + (posInfoBN & 0xFFn).toString(16).padStart(64, '0');

  // Get fees from StateView
  const [posLiq, feeGrowthInside0, feeGrowthInside1] = await pub.readContract({
    address: SV, abi: SV_ABI, functionName: 'getPositionInfo',
    args: [poolId, PM, tickLower, tickUpper, salt]
  });
  await sleep(500);

  const inRange = currentTick >= tickLower && currentTick < tickUpper;
  const rangePct = ((currentTick - tickLower) / (tickUpper - tickLower) * 100).toFixed(1);

  return { tokenId, tickLower, tickUpper, currentTick, inRange, rangePct, liquidity: liq, feeGrowth0: feeGrowthInside0, feeGrowth1: feeGrowthInside1 };
}

// Get ETH + AXIOM prices
async function getPrices() {
  try {
    const r1 = await fetch('https://api.dexscreener.com/latest/dex/tokens/0x4200000000000000000000000000000000000006');
    const d1 = await r1.json();
    const ethPrice = parseFloat(d1.pairs?.find(p => p.chainId === 'base' && p.quoteToken?.symbol === 'USDC')?.priceUsd || '3200');
    
    const r2 = await fetch('https://api.dexscreener.com/latest/dex/tokens/0xf3Ce5dDAAb6C133F9875a4a46C55cf0b58111B07');
    const d2 = await r2.json();
    const axiomPrice = parseFloat(d2.pairs?.find(p => p.chainId === 'base')?.priceUsd || '0');
    
    return { ethPrice, axiomPrice };
  } catch { return { ethPrice: 3200, axiomPrice: 0 }; }
}

async function main() {
  const positions = [1078695, 1078720, 1078751];
  const prices = await getPrices();
  console.log(`ETH: $${prices.ethPrice.toFixed(0)} | AXIOM: $${prices.axiomPrice.toFixed(8)}`);
  console.log('═'.repeat(60));

  for (const id of positions) {
    try {
      const p = await checkPosition(id);
      console.log(`\n#${p.tokenId}: ${p.inRange ? '✅ IN RANGE' : '❌ OUT OF RANGE'} (${p.rangePct}%)`);
      console.log(`  Tick: ${p.currentTick} (range ${p.tickLower}→${p.tickUpper})`);
      console.log(`  Liquidity: ${p.liquidity.toString()}`);
      console.log(`  FeeGrowth0: ${p.feeGrowth0.toString()}`);
      console.log(`  FeeGrowth1: ${p.feeGrowth1.toString()}`);
    } catch (err) {
      console.error(`#${id}: Error — ${err.message}`);
    }
    await sleep(1000);
  }
}
main().catch(console.error);
