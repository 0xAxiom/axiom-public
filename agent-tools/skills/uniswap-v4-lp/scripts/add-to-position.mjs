#!/usr/bin/env node
import { createPublicClient, createWalletClient, http, formatEther, encodeAbiParameters, parseAbiParameters, keccak256, encodePacked } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base } from 'viem/chains';
import * as dotenv from 'dotenv';
import { resolve } from 'path';
dotenv.config({ path: resolve(process.env.HOME, '.axiom/wallet.env') });

const account = privateKeyToAccount(process.env.NET_PRIVATE_KEY);
const pub = createPublicClient({ chain: base, transport: http() });
const wallet = createWalletClient({ account, chain: base, transport: http() });

const PM = '0x7c5f5a4bbd8fd63184577525326123b519429bdc';
const SV = '0xa3c0c9b65bad0b08107aa264b0f3db444b867a71';
const AXIOM = '0xf3Ce5dDAAb6C133F9875a4a46C55cf0b58111B07';
const WETH = '0x4200000000000000000000000000000000000006';
const tokenId = 1078751;

const PM_ABI = [
  { name: 'modifyLiquidities', type: 'function', inputs: [{ name: 'unlockData', type: 'bytes' }, { name: 'deadline', type: 'uint256' }], outputs: [{ type: 'bytes' }] },
  { name: 'getPoolAndPositionInfo', type: 'function', inputs: [{ type: 'uint256' }], outputs: [{ type: 'tuple', components: [{ name: 'currency0', type: 'address' }, { name: 'currency1', type: 'address' }, { name: 'fee', type: 'uint24' }, { name: 'tickSpacing', type: 'int24' }, { name: 'hooks', type: 'address' }]}, { type: 'uint256' }] },
];
const SV_ABI = [
  { name: 'getSlot0', type: 'function', stateMutability: 'view', inputs: [{ type: 'bytes32' }], outputs: [{ type: 'uint160' }, { type: 'int24' }, { type: 'uint24' }, { type: 'uint24' }] },
];
const abi20 = [{ name: 'balanceOf', type: 'function', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] }];

// Get position info
const [poolKey, posInfo] = await pub.readContract({ address: PM, abi: PM_ABI, functionName: 'getPoolAndPositionInfo', args: [BigInt(tokenId)] });
// V4 packs: poolId(25B) | tickLower(3B) | tickUpper(3B) | salt(1B) = 32B total
const posInfoBN = BigInt(posInfo);
const toInt24 = (v) => v >= 0x800000 ? v - 0x1000000 : v;
const rawA = toInt24(Number((posInfoBN >> 32n) & 0xFFFFFFn));
const rawB = toInt24(Number((posInfoBN >> 8n) & 0xFFFFFFn));
const tickLower = Math.min(rawA, rawB);
const tickUpper = Math.max(rawA, rawB);

// Get balances
const wethBal = await pub.readContract({ address: WETH, abi: abi20, functionName: 'balanceOf', args: [account.address] });
const axiomBal = await pub.readContract({ address: AXIOM, abi: abi20, functionName: 'balanceOf', args: [account.address] });

console.log('WETH:', formatEther(wethBal), '(~$' + (Number(formatEther(wethBal)) * 2690).toFixed(2) + ')');
console.log('AXIOM:', formatEther(axiomBal), '(~$' + (Number(formatEther(axiomBal)) * 0.00000107).toFixed(2) + ')');
console.log('Tick range:', tickLower, '→', tickUpper);

// Get current sqrtPrice
const poolIdBytes = keccak256(encodeAbiParameters(
  parseAbiParameters('address, address, uint24, int24, address'),
  [poolKey.currency0, poolKey.currency1, poolKey.fee, poolKey.tickSpacing, poolKey.hooks]
));
const [sqrtPriceX96, currentTick] = await pub.readContract({ address: SV, abi: SV_ABI, functionName: 'getSlot0', args: [poolIdBytes] });
console.log('Current tick:', currentTick);

// Tick to sqrtPrice math
function tickToSqrtPriceX96(tick) {
  const absTick = Math.abs(tick);
  let ratio = (absTick & 0x1) !== 0 ? 0xfffcb933bd6fad37aa2d162d1a594001n : (1n << 128n);
  if ((absTick & 0x2) !== 0) ratio = (ratio * 0xfff97272373d413259a46990580e213an) >> 128n;
  if ((absTick & 0x4) !== 0) ratio = (ratio * 0xfff2e50f5f656932ef12357cf3c7fdccn) >> 128n;
  if ((absTick & 0x8) !== 0) ratio = (ratio * 0xffe5caca7e10e4e61c3624eaa0941cd0n) >> 128n;
  if ((absTick & 0x10) !== 0) ratio = (ratio * 0xffcb9843d60f6159c9db58835c926644n) >> 128n;
  if ((absTick & 0x20) !== 0) ratio = (ratio * 0xff973b41fa98c081472e6896dfb254c0n) >> 128n;
  if ((absTick & 0x40) !== 0) ratio = (ratio * 0xff2ea16466c96a3843ec78b326b52861n) >> 128n;
  if ((absTick & 0x80) !== 0) ratio = (ratio * 0xfe5dee046a99a2a811c461f1969c3053n) >> 128n;
  if ((absTick & 0x100) !== 0) ratio = (ratio * 0xfcbe86c7900a88aedcffc83b479aa3a4n) >> 128n;
  if ((absTick & 0x200) !== 0) ratio = (ratio * 0xf987a7253ac413176f2b074cf7815e54n) >> 128n;
  if ((absTick & 0x400) !== 0) ratio = (ratio * 0xf3392b0822b70005940c7a398e4b70f3n) >> 128n;
  if ((absTick & 0x800) !== 0) ratio = (ratio * 0xe7159475a2c29b7443b29c7fa6e889d9n) >> 128n;
  if ((absTick & 0x1000) !== 0) ratio = (ratio * 0xd097f3bdfd2022b8845ad8f792aa5825n) >> 128n;
  if ((absTick & 0x2000) !== 0) ratio = (ratio * 0xa9f746462d870fdf8a65dc1f90e061e5n) >> 128n;
  if ((absTick & 0x4000) !== 0) ratio = (ratio * 0x70d869a156d2a1b890bb3df62baf32f7n) >> 128n;
  if ((absTick & 0x8000) !== 0) ratio = (ratio * 0x31be135f97d08fd981231505542fcfa6n) >> 128n;
  if ((absTick & 0x10000) !== 0) ratio = (ratio * 0x9aa508b5b7a84e1c677de54f3e99bc9n) >> 128n;
  if ((absTick & 0x20000) !== 0) ratio = (ratio * 0x5d6af8dedb81196699c329225ee604n) >> 128n;
  if (tick > 0) ratio = ((1n << 256n) - 1n) / ratio;
  return (ratio >> 32n) + (ratio % (1n << 32n) === 0n ? 0n : 1n);
}

function getLiquidityForAmounts(sqrtP, sqrtA, sqrtB, amt0, amt1) {
  if (sqrtA > sqrtB) [sqrtA, sqrtB] = [sqrtB, sqrtA];
  if (sqrtP <= sqrtA) {
    return (amt0 * sqrtA * sqrtB) / ((sqrtB - sqrtA) * (1n << 96n));
  } else if (sqrtP < sqrtB) {
    const l0 = (amt0 * sqrtP * sqrtB) / ((sqrtB - sqrtP) * (1n << 96n));
    const l1 = (amt1 * (1n << 96n)) / (sqrtB - sqrtA);
    return l0 < l1 ? l0 : l1;
  } else {
    return (amt1 * (1n << 96n)) / (sqrtB - sqrtA);
  }
}

const sqrtPriceLower = tickToSqrtPriceX96(tickLower);
const sqrtPriceUpper = tickToSqrtPriceX96(tickUpper);
const liquidity = getLiquidityForAmounts(sqrtPriceX96, sqrtPriceLower, sqrtPriceUpper, wethBal, axiomBal);

console.log('\nLiquidity to add:', liquidity.toString());

if (liquidity <= 0n) {
  console.log('Zero liquidity — cannot add');
  process.exit(1);
}

// Build INCREASE_LIQUIDITY(0x00) + SETTLE_PAIR(0x0d)
const pad32 = (v) => v.replace('0x', '').padStart(64, '0');
const actionsHex = '0x000d';

const increaseParams = '0x' +
  pad32('0x' + BigInt(tokenId).toString(16)) +
  pad32('0x' + liquidity.toString(16)) +
  pad32('0x' + wethBal.toString(16)) +
  pad32('0x' + axiomBal.toString(16)) +
  (5 * 32).toString(16).padStart(64, '0') +
  '0'.padStart(64, '0');

const settleParams = '0x' +
  pad32(poolKey.currency0) +
  pad32(poolKey.currency1);

const unlockData = encodeAbiParameters(
  parseAbiParameters('bytes, bytes[]'),
  [actionsHex, [increaseParams, settleParams]]
);

const deadline = BigInt(Math.floor(Date.now() / 1000) + 1800);

console.log('\n🔄 Adding all tokens to position #' + tokenId + '...');
const hash = await wallet.writeContract({
  address: PM,
  abi: PM_ABI,
  functionName: 'modifyLiquidities',
  args: [unlockData, deadline],
});
console.log('TX:', hash);

const receipt = await pub.waitForTransactionReceipt({ hash });
console.log(receipt.status === 'success' ? '✅ Liquidity added!' : '❌ Reverted!');
console.log('Gas:', receipt.gasUsed.toString());
console.log('https://basescan.org/tx/' + hash);
