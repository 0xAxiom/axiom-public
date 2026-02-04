#!/usr/bin/env node
/**
 * ClawFomo Status Checker
 * Shows current round state, pot, timer, and recent activity
 */

import { createPublicClient, http, formatUnits } from 'viem';
import { base } from 'viem/chains';

const CLAWFOMO = '0x859e5cb97e1cf357643a6633d5bec6d45e44cfd4';
const CLAWD = '0x9f86dB9fc6f7c9408e8Fda3Ff8ce4e78ac7a6b07';

const ABI = [
  { name: 'getRoundInfo', type: 'function', inputs: [], outputs: [
    { name: 'round', type: 'uint256' },
    { name: 'potSize', type: 'uint256' },
    { name: 'endTime', type: 'uint256' },
    { name: 'lastBuyerAddr', type: 'address' },
    { name: 'keys', type: 'uint256' },
    { name: 'keyPrice', type: 'uint256' },
    { name: 'isActive', type: 'bool' }
  ]},
  { name: 'ANTI_SNIPE_THRESHOLD', type: 'function', inputs: [], outputs: [{ type: 'uint256' }]},
  { name: 'ANTI_SNIPE_EXTENSION', type: 'function', inputs: [], outputs: [{ type: 'uint256' }]},
  { name: 'WINNER_BPS', type: 'function', inputs: [], outputs: [{ type: 'uint256' }]},
  { name: 'BURN_ON_END_BPS', type: 'function', inputs: [], outputs: [{ type: 'uint256' }]},
];

const client = createPublicClient({
  chain: base,
  transport: http(process.env.BASE_RPC_URL || 'https://mainnet.base.org'),
});

async function main() {
  console.log('🦞 ClawFomo Status\n');
  console.log(`Contract: ${CLAWFOMO}`);
  console.log('═'.repeat(50));

  try {
    const [roundInfo, antiSnipeThreshold, antiSnipeExt, winnerBps, burnBps] = await Promise.all([
      client.readContract({ address: CLAWFOMO, abi: ABI, functionName: 'getRoundInfo' }),
      client.readContract({ address: CLAWFOMO, abi: ABI, functionName: 'ANTI_SNIPE_THRESHOLD' }),
      client.readContract({ address: CLAWFOMO, abi: ABI, functionName: 'ANTI_SNIPE_EXTENSION' }),
      client.readContract({ address: CLAWFOMO, abi: ABI, functionName: 'WINNER_BPS' }),
      client.readContract({ address: CLAWFOMO, abi: ABI, functionName: 'BURN_ON_END_BPS' }),
    ]);

    const [round, pot, endTime, lastBuyer, keysSold, currentPrice, isActive] = roundInfo;
    const now = BigInt(Math.floor(Date.now() / 1000));
    const timeLeft = endTime > now ? Number(endTime - now) : 0;
    
    console.log(`\n📊 Round #${round}`);
    console.log(`   Status: ${isActive ? (timeLeft > 0 ? '🟢 ACTIVE' : '🔴 ENDED') : '⏳ NOT STARTED'}`);
    console.log(`   Pot: ${formatUnits(pot, 18)} CLAWD`);
    console.log(`   Keys Sold: ${keysSold}`);
    console.log(`   Time Left: ${timeLeft > 0 ? `${Math.floor(timeLeft / 60)}m ${timeLeft % 60}s` : 'ENDED'}`);
    console.log(`   Current Leader: ${lastBuyer.slice(0, 10)}...`);
    
    console.log(`\n💰 Economics`);
    console.log(`   Key Price: ${formatUnits(currentPrice, 18)} CLAWD`);
    console.log(`   Winner Gets: ${Number(winnerBps) / 100}% of pot`);
    console.log(`   Burn on End: ${Number(burnBps) / 100}%`);
    
    console.log(`\n⚡ Anti-Snipe Protection`);
    console.log(`   Threshold: ${antiSnipeThreshold}s`);
    console.log(`   Extension: ${antiSnipeExt}s`);
    
    // Calculate EV
    if (timeLeft > 0 && pot > 0n) {
      const winnings = (pot * winnerBps) / 10000n;
      const cost = currentPrice;
      console.log(`\n📈 Quick Math`);
      console.log(`   If you win: +${formatUnits(winnings, 18)} CLAWD`);
      console.log(`   Cost to bid: -${formatUnits(cost, 18)} CLAWD`);
      console.log(`   Breakeven: Need ${((Number(cost) / Number(winnings)) * 100).toFixed(2)}% win rate`);
    }
    
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

main();
