#!/usr/bin/env node
/**
 * V4 Position Quick Health Check
 * Scout's tool for independently verifying position status.
 * 
 * Usage: node v4-quick-health-check.mjs [tokenId]
 * Default: checks position #1078751
 * 
 * What it does:
 * 1. Reads position info from PositionManager
 * 2. Decodes tick range (int24 from packed uint256)
 * 3. Gets current pool tick from StateView
 * 4. Reports: in-range, liquidity, price estimate
 */

import { createPublicClient, http, keccak256, encodeAbiParameters, parseAbiParameters } from 'viem';
import { base } from 'viem/chains';

const TOKEN_ID = BigInt(process.argv[2] || '1078751');

const POSITION_MANAGER = '0x7c5f5a4bbd8fd63184577525326123b519429bdc';
const STATE_VIEW = '0xa3c0c9b65bad0b08107aa264b0f3db444b867a71';

const client = createPublicClient({
  chain: base,
  transport: http(process.env.BASE_RPC_URL || 'https://mainnet.base.org'),
});

const toInt24 = (val) => val > 0x7FFFFF ? val - 0x1000000 : val;

async function check() {
  console.log(`\n🔍 Checking position #${TOKEN_ID}...\n`);

  // Step 1: Owner check
  let owner;
  try {
    owner = await client.readContract({
      address: POSITION_MANAGER,
      abi: [{ name: 'ownerOf', type: 'function', inputs: [{ type: 'uint256' }], outputs: [{ type: 'address' }], stateMutability: 'view' }],
      functionName: 'ownerOf',
      args: [TOKEN_ID],
    });
    console.log(`👤 Owner: ${owner}`);
  } catch (e) {
    console.log('❌ Position not found (burned or never existed)');
    process.exit(1);
  }

  // Step 2: Pool and position info
  const [poolKey, posInfo] = await client.readContract({
    address: POSITION_MANAGER,
    abi: [{
      name: 'getPoolAndPositionInfo',
      type: 'function',
      inputs: [{ type: 'uint256' }],
      outputs: [
        { type: 'tuple', components: [
          { name: 'currency0', type: 'address' },
          { name: 'currency1', type: 'address' },
          { name: 'fee', type: 'uint24' },
          { name: 'tickSpacing', type: 'int24' },
          { name: 'hooks', type: 'address' },
        ]},
        { type: 'uint256' },
      ],
      stateMutability: 'view',
    }],
    functionName: 'getPoolAndPositionInfo',
    args: [TOKEN_ID],
  });

  // Step 3: Decode ticks from packed posInfo
  const tickLowerRaw = Number((posInfo >> 8n) & 0xFFFFFFn);
  const tickUpperRaw = Number((posInfo >> 32n) & 0xFFFFFFn);
  const tickLower = toInt24(tickLowerRaw);
  const tickUpper = toInt24(tickUpperRaw);

  console.log(`\n📊 Pool: ${poolKey.currency0} / ${poolKey.currency1}`);
  console.log(`   Fee: 0x${poolKey.fee.toString(16)} ${poolKey.fee === 0x800000 ? '(DYNAMIC — Clanker pool)' : `(${poolKey.fee / 10000}%)`}`);
  console.log(`   Hooks: ${poolKey.hooks}`);
  console.log(`\n📐 Tick Range: [${tickLower}, ${tickUpper}]`);

  // Step 4: Compute poolId and get current tick
  const poolId = keccak256(encodeAbiParameters(
    parseAbiParameters('address, address, uint24, int24, address'),
    [poolKey.currency0, poolKey.currency1, poolKey.fee, poolKey.tickSpacing, poolKey.hooks]
  ));

  const slot0 = await client.readContract({
    address: STATE_VIEW,
    abi: [{
      name: 'getSlot0',
      type: 'function',
      inputs: [{ type: 'bytes32' }],
      outputs: [
        { type: 'uint160', name: 'sqrtPriceX96' },
        { type: 'int24', name: 'tick' },
        { type: 'uint24', name: 'protocolFee' },
        { type: 'uint24', name: 'lpFee' },
      ],
      stateMutability: 'view',
    }],
    functionName: 'getSlot0',
    args: [poolId],
  });

  const currentTick = Number(slot0[1]);
  const inRange = tickLower <= currentTick && currentTick < tickUpper;

  console.log(`   Current Tick: ${currentTick}`);
  console.log(`\n${inRange ? '✅ IN RANGE — Earning fees!' : '⚠️  OUT OF RANGE — Not earning fees'}`);

  // Step 5: Liquidity
  const liquidity = await client.readContract({
    address: POSITION_MANAGER,
    abi: [{ name: 'getPositionLiquidity', type: 'function', inputs: [{ type: 'uint256' }], outputs: [{ type: 'uint128' }], stateMutability: 'view' }],
    functionName: 'getPositionLiquidity',
    args: [TOKEN_ID],
  });
  console.log(`💧 Liquidity: ${liquidity.toString()}${liquidity === 0n ? ' (withdrawn!)' : ''}`);

  // Step 6: Price estimate
  const Q96 = 2n ** 96n;
  const sqrtPrice = Number(slot0[0]) / Number(Q96);
  const price = sqrtPrice ** 2;
  console.log(`\n💰 Price (token0/token1): ${price.toExponential(4)}`);
  // In WETH/AXIOM pools, price = AXIOM per WETH. Invert for AXIOM price.
  const axiomPriceEth = 1 / price;
  const ethUsd = 2500; // rough estimate
  console.log(`   AXIOM price: ~${(axiomPriceEth * ethUsd).toFixed(6)} USD (~${axiomPriceEth.toExponential(4)} ETH)`);
  console.log();
}

check().catch(e => { console.error('Error:', e.message); process.exit(1); });
