import { createPublicClient, createWalletClient, http, formatEther, encodeAbiParameters, parseAbiParameters, keccak256 } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base } from 'viem/chains';
import { defaultAbiCoder } from '@ethersproject/abi';
import * as dotenv from 'dotenv';
import { resolve } from 'path';
dotenv.config({ path: resolve(process.env.HOME, '.axiom/wallet.env') });

const PM = '0x7c5f5a4bbd8fd63184577525326123b519429bdc';
const SV = '0xa3c0c9b65bad0b08107aa264b0f3db444b867a71';
const PKS = '(address,address,uint24,int24,address)';
const Q96 = BigInt(2) ** BigInt(96);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const pad32 = hex => hex.replace('0x','').padStart(64, '0');
const toInt24 = v => v >= 0x800000 ? v - 0x1000000 : v;

const PM_ABI = [
  { name: 'modifyLiquidities', type: 'function', inputs: [{ name: 'unlockData', type: 'bytes' }, { name: 'deadline', type: 'uint256' }], outputs: [] },
  { name: 'getPoolAndPositionInfo', type: 'function', inputs: [{ type: 'uint256' }], outputs: [{ type: 'tuple', components: [{ name: 'currency0', type: 'address' }, { name: 'currency1', type: 'address' }, { name: 'fee', type: 'uint24' }, { name: 'tickSpacing', type: 'int24' }, { name: 'hooks', type: 'address' }] }, { type: 'uint256' }] },
  { name: 'getPositionLiquidity', type: 'function', inputs: [{ type: 'uint256' }], outputs: [{ type: 'uint128' }] },
];
const SV_ABI = [{ name: 'getSlot0', type: 'function', inputs: [{ type: 'bytes32' }], outputs: [{ type: 'uint160' }, { type: 'int24' }, { type: 'uint24' }, { type: 'uint24' }] }];

function tickToSqrt(tick) { return BigInt(Math.floor(Math.sqrt(Math.pow(1.0001, tick)) * Number(Q96))); }
function getLiq(sqrtP, sqrtA, sqrtB, a0, a1) {
  if (sqrtA > sqrtB) [sqrtA, sqrtB] = [sqrtB, sqrtA];
  const l0 = (a, sA, sB) => (a * ((sA * sB) / Q96)) / (sB - sA);
  const l1 = (a, sA, sB) => (a * Q96) / (sB - sA);
  if (sqrtP <= sqrtA) return l0(a0, sqrtA, sqrtB);
  if (sqrtP < sqrtB) { const r0 = l0(a0, sqrtP, sqrtB); const r1 = l1(a1, sqrtA, sqrtP); return r0 < r1 ? r0 : r1; }
  return l1(a1, sqrtA, sqrtB);
}

async function main() {
  const pk = process.env.NET_PRIVATE_KEY || process.env.PRIVATE_KEY;
  const account = privateKeyToAccount(pk);
  const pub = createPublicClient({ chain: base, transport: http(process.env.BASE_RPC_URL) });
  const wal = createWalletClient({ account, chain: base, transport: http(process.env.BASE_RPC_URL) });

  // The fees were already collected from #1078695 into wallet.
  // Now re-add them. We know the amounts:
  const feesWeth = BigInt('5439806149511452');       // 0.00544 WETH
  const feesToken1 = BigInt('6708856030098742998353979'); // 6.7M AXIOM

  const tokenId = 1078695n;
  const [poolKey, posInfo] = await pub.readContract({ address: PM, abi: PM_ABI, functionName: 'getPoolAndPositionInfo', args: [tokenId] });
  await sleep(1000);
  const liqBefore = await pub.readContract({ address: PM, abi: PM_ABI, functionName: 'getPositionLiquidity', args: [tokenId] });
  await sleep(1000);

  const poolId = keccak256(defaultAbiCoder.encode([PKS], [[poolKey.currency0, poolKey.currency1, poolKey.fee, poolKey.tickSpacing, poolKey.hooks]]));
  const [sqrtPriceX96, currentTick] = await pub.readContract({ address: SV, abi: SV_ABI, functionName: 'getSlot0', args: [poolId] });

  const posInfoBN = BigInt(posInfo);
  const rawA = toInt24(Number((posInfoBN >> 32n) & 0xFFFFFFn));
  const rawB = toInt24(Number((posInfoBN >> 8n) & 0xFFFFFFn));
  const tickLower = Math.min(rawA, rawB);
  const tickUpper = Math.max(rawA, rawB);

  const liquidity = getLiq(sqrtPriceX96, tickToSqrt(tickLower), tickToSqrt(tickUpper), feesWeth, feesToken1);
  console.log('Liquidity to add:', liquidity.toString());
  console.log('Tick:', currentTick, 'Range:', tickLower, '→', tickUpper);

  const amount0Max = feesWeth * 150n / 100n;
  const amount1Max = feesToken1 * 150n / 100n;
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 1800);

  // Try approach: INCREASE(0x00) + CLOSE_CURRENCY(0x11) + CLOSE_CURRENCY(0x11)
  // 3 actions, one CLOSE per currency — each CLOSE takes a single currency address
  console.log('\n🔬 Approach A: 3 actions (INCREASE + CLOSE×2), each CLOSE = 1 address...');
  
  const actionsA = '0x001111';
  const increaseParams = '0x' +
    pad32('0x' + tokenId.toString(16)) +
    pad32('0x' + liquidity.toString(16)) +
    pad32('0x' + amount0Max.toString(16)) +
    pad32('0x' + amount1Max.toString(16)) +
    (5 * 32).toString(16).padStart(64, '0') +
    '0'.padStart(64, '0');

  // Each CLOSE_CURRENCY takes just the currency address
  const close0 = defaultAbiCoder.encode(['address'], [poolKey.currency0]);
  const close1 = defaultAbiCoder.encode(['address'], [poolKey.currency1]);

  const dataA = encodeAbiParameters(
    parseAbiParameters('bytes, bytes[]'),
    [actionsA, [increaseParams, close0, close1]]
  );

  try {
    const hash = await wal.writeContract({
      address: PM, abi: PM_ABI, functionName: 'modifyLiquidities', args: [dataA, deadline],
    });
    console.log('TX:', hash);
    const receipt = await pub.waitForTransactionReceipt({ hash });
    console.log('Status:', receipt.status);
    if (receipt.status === 'success') {
      await sleep(3000);
      const liqAfter = await pub.readContract({ address: PM, abi: PM_ABI, functionName: 'getPositionLiquidity', args: [tokenId] });
      console.log('Before:', liqBefore.toString());
      console.log('After:', liqAfter.toString());
      console.log('Added:', (liqAfter - liqBefore).toString());
      console.log('✅ WORKS!');
      console.log('https://basescan.org/tx/' + hash);
    }
  } catch (err) {
    console.log('❌ A failed:', err.shortMessage || err.message);
    
    // Try approach B: INCREASE + SETTLE(0x0f) + SETTLE(0x0f)
    // SETTLE: (currency, amount=0 for OPEN_DELTA, payerIsUser=true)
    console.log('\n🔬 Approach B: INCREASE + SETTLE×2...');
    const actionsB = '0x000f0f';
    const settle0 = defaultAbiCoder.encode(
      ['address', 'uint256', 'bool'],
      [poolKey.currency0, '0', true]
    );
    const settle1 = defaultAbiCoder.encode(
      ['address', 'uint256', 'bool'],
      [poolKey.currency1, '0', true]
    );
    const dataB = encodeAbiParameters(
      parseAbiParameters('bytes, bytes[]'),
      [actionsB, [increaseParams, settle0, settle1]]
    );
    try {
      const hash2 = await wal.writeContract({
        address: PM, abi: PM_ABI, functionName: 'modifyLiquidities', args: [dataB, deadline],
      });
      console.log('TX:', hash2);
      const receipt2 = await pub.waitForTransactionReceipt({ hash: hash2 });
      console.log('Status:', receipt2.status);
      if (receipt2.status === 'success') {
        await sleep(3000);
        const liqAfter = await pub.readContract({ address: PM, abi: PM_ABI, functionName: 'getPositionLiquidity', args: [tokenId] });
        console.log('Before:', liqBefore.toString());
        console.log('After:', liqAfter.toString());
        console.log('✅ SETTLE WORKS!');
        console.log('https://basescan.org/tx/' + hash2);
      }
    } catch (err2) {
      console.log('❌ B failed:', err2.shortMessage || err2.message);
      
      // Try approach C: INCREASE + SETTLE_PAIR(0x0d)
      // Maybe SETTLE_PAIR works for INCREASE even on hook pools?
      console.log('\n🔬 Approach C: INCREASE + SETTLE_PAIR...');
      const actionsC = '0x000d';
      const settlePair = defaultAbiCoder.encode(
        ['address', 'address'],
        [poolKey.currency0, poolKey.currency1]
      );
      const dataC = encodeAbiParameters(
        parseAbiParameters('bytes, bytes[]'),
        [actionsC, [increaseParams, settlePair]]
      );
      try {
        const hash3 = await wal.writeContract({
          address: PM, abi: PM_ABI, functionName: 'modifyLiquidities', args: [dataC, deadline],
        });
        console.log('TX:', hash3);
        const receipt3 = await pub.waitForTransactionReceipt({ hash: hash3 });
        console.log('Status:', receipt3.status);
        if (receipt3.status === 'success') {
          console.log('✅ SETTLE_PAIR WORKS for INCREASE!');
          console.log('https://basescan.org/tx/' + hash3);
        }
      } catch (err3) {
        console.log('❌ C failed:', err3.shortMessage || err3.message);
      }
    }
  }
}
main().catch(console.error);
