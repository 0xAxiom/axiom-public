#!/usr/bin/env node
/**
 * ClawFomo Strategic Player Bot
 * 
 * Game Theory:
 * - Last-bidder-wins: timer resets when someone buys keys
 * - Anti-snipe: buying within 120s extends timer by 120s
 * - Winner gets 50% of pot
 * - 20% burned, rest seeded to next round
 * 
 * Strategy:
 * - Monitor round state in real-time
 * - Calculate EV (expected value) before each bid
 * - Only bid when EV is positive (winnings > cost)
 * - Snipe near round end to minimize competition window
 * - Respect strict loss limits
 * - Track bid frequency to detect other snipers
 */

import { createPublicClient, createWalletClient, http, formatUnits, parseUnits } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base } from 'viem/chains';

// ─── Configuration ──────────────────────────────────────────────────────────

const CLAWFOMO = '0x859e5cb97e1cf357643a6633d5bec6d45e44cfd4';
const CLAWD_TOKEN = '0x9f86dB9fc6f7c9408e8Fda3Ff8ce4e78ac7a6b07';

const DEFAULTS = {
  maxBidClawd: 5000,          // Max CLAWD to spend per bid
  maxKeysPerBid: 1,            // Keys to buy per bid (1 = minimum exposure)
  minPotMultiple: 2.0,         // Only bid if pot > 2x our cost
  snipeWindowSec: 180,         // Start watching when <3min left
  minTimerSec: 10,             // Don't bid if <10s (likely to miss)
  maxRoundLoss: 20000,         // Max CLAWD loss per round before stopping
  pollIntervalMs: 3000,        // Check every 3 seconds
  maxTotalLoss: 50000,         // Session kill switch
  dryRun: false,
};

// ─── ABI ────────────────────────────────────────────────────────────────────

const ABI = [
  { name: 'getRoundInfo', type: 'function', stateMutability: 'view', inputs: [], outputs: [
    { name: 'round', type: 'uint256' }, { name: 'potSize', type: 'uint256' },
    { name: 'endTime', type: 'uint256' }, { name: 'lastBuyerAddr', type: 'address' },
    { name: 'keys', type: 'uint256' }, { name: 'keyPrice', type: 'uint256' },
    { name: 'isActive', type: 'bool' }
  ]},
  { name: 'calculateCost', type: 'function', stateMutability: 'view',
    inputs: [{ name: 'numKeys', type: 'uint256' }],
    outputs: [{ type: 'uint256' }]
  },
  { name: 'buyKeys', type: 'function', stateMutability: 'nonpayable',
    inputs: [{ name: 'numKeys', type: 'uint256' }], outputs: []
  },
  { name: 'ANTI_SNIPE_THRESHOLD', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { name: 'ANTI_SNIPE_EXTENSION', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { name: 'WINNER_BPS', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { name: 'totalUnclaimedDividends', type: 'function', stateMutability: 'view',
    inputs: [{ name: 'player', type: 'address' }], outputs: [{ type: 'uint256' }]
  },
  { name: 'claimAllDividends', type: 'function', stateMutability: 'nonpayable', inputs: [], outputs: [{ type: 'uint256' }] },
  { name: 'getPlayer', type: 'function', stateMutability: 'view',
    inputs: [{ name: 'round', type: 'uint256' }, { name: 'addr', type: 'address' }],
    outputs: [{ type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }]
  },
  { name: 'totalBurned', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { name: 'MAX_KEYS_PER_BUY', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
];

const ERC20_ABI = [
  { name: 'approve', type: 'function', stateMutability: 'nonpayable',
    inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }],
    outputs: [{ type: 'bool' }]
  },
  { name: 'allowance', type: 'function', stateMutability: 'view',
    inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }],
    outputs: [{ type: 'uint256' }]
  },
  { name: 'balanceOf', type: 'function', stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ type: 'uint256' }]
  },
];

// ─── Parse Args ─────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const config = { ...DEFAULTS };
  
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--dry-run': config.dryRun = true; break;
      case '--max-bid': config.maxBidClawd = Number(args[++i]); break;
      case '--max-keys': config.maxKeysPerBid = Number(args[++i]); break;
      case '--min-pot': config.minPotMultiple = Number(args[++i]); break;
      case '--snipe-window': config.snipeWindowSec = Number(args[++i]); break;
      case '--max-round-loss': config.maxRoundLoss = Number(args[++i]); break;
      case '--max-total-loss': config.maxTotalLoss = Number(args[++i]); break;
      case '--poll': config.pollIntervalMs = Number(args[++i]); break;
      case '--help':
        console.log(`
ClawFomo Player Bot 🦞

Usage: node play.mjs [options]

Options:
  --dry-run              Simulate only (default: false)
  --max-bid <N>          Max CLAWD per bid (default: ${DEFAULTS.maxBidClawd})
  --max-keys <N>         Keys per bid (default: ${DEFAULTS.maxKeysPerBid})
  --min-pot <N>          Min pot/cost ratio (default: ${DEFAULTS.minPotMultiple})
  --snipe-window <sec>   Watch window (default: ${DEFAULTS.snipeWindowSec})
  --max-round-loss <N>   Stop-loss per round (default: ${DEFAULTS.maxRoundLoss})
  --max-total-loss <N>   Session kill switch (default: ${DEFAULTS.maxTotalLoss})
  --poll <ms>            Poll interval (default: ${DEFAULTS.pollIntervalMs})
`);
        process.exit(0);
    }
  }
  return config;
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const config = parseArgs();
  
  // Setup wallet
  const pk = process.env.NET_PRIVATE_KEY;
  if (!pk) { console.error('NET_PRIVATE_KEY not set'); process.exit(1); }
  
  const account = privateKeyToAccount(pk.startsWith('0x') ? pk : `0x${pk}`);
  const rpcUrl = process.env.BASE_RPC_URL || 'https://mainnet.base.org';
  
  const publicClient = createPublicClient({ chain: base, transport: http(rpcUrl) });
  const walletClient = createWalletClient({ account, chain: base, transport: http(rpcUrl) });
  
  console.log('🦞 ClawFomo Player Bot');
  console.log('═'.repeat(50));
  console.log(`Wallet: ${account.address}`);
  console.log(`Mode: ${config.dryRun ? '🔮 DRY RUN' : '🔴 LIVE'}`);
  console.log(`Max bid: ${config.maxBidClawd} CLAWD`);
  console.log(`Min pot multiple: ${config.minPotMultiple}x`);
  console.log(`Snipe window: ${config.snipeWindowSec}s`);
  console.log(`Max round loss: ${config.maxRoundLoss} CLAWD`);
  console.log(`Kill switch: ${config.maxTotalLoss} CLAWD`);
  console.log('═'.repeat(50));
  
  // Check CLAWD balance
  const balance = await publicClient.readContract({
    address: CLAWD_TOKEN, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address]
  });
  console.log(`\n💰 CLAWD Balance: ${formatUnits(balance, 18)}`);
  
  if (balance === 0n) {
    console.log('❌ No CLAWD tokens. Need tokens to play.');
    process.exit(1);
  }
  
  // Check & set approval
  const allowance = await publicClient.readContract({
    address: CLAWD_TOKEN, abi: ERC20_ABI, functionName: 'allowance',
    args: [account.address, CLAWFOMO]
  });
  
  // C1 FIX: Only approve what we need (session limit), not maxUint256
  const sessionLimit = parseUnits(config.maxTotalLoss.toString(), 18);
  if (allowance < sessionLimit && !config.dryRun) {
    console.log(`📝 Approving ${config.maxTotalLoss} CLAWD spending (session limit)...`);
    const hash = await walletClient.writeContract({
      address: CLAWD_TOKEN, abi: ERC20_ABI, functionName: 'approve',
      args: [CLAWFOMO, sessionLimit]
    });
    console.log(`✅ Approved: ${hash}`);
    await publicClient.waitForTransactionReceipt({ hash });
  }
  
  // Get game constants
  const [antiSnipeThreshold, antiSnipeExt, winnerBps, maxKeysContract] = await Promise.all([
    publicClient.readContract({ address: CLAWFOMO, abi: ABI, functionName: 'ANTI_SNIPE_THRESHOLD' }),
    publicClient.readContract({ address: CLAWFOMO, abi: ABI, functionName: 'ANTI_SNIPE_EXTENSION' }),
    publicClient.readContract({ address: CLAWFOMO, abi: ABI, functionName: 'WINNER_BPS' }),
    publicClient.readContract({ address: CLAWFOMO, abi: ABI, functionName: 'MAX_KEYS_PER_BUY' }),
  ]);
  
  console.log(`\n⚡ Game Constants:`);
  console.log(`   Anti-snipe threshold: ${antiSnipeThreshold}s`);
  console.log(`   Anti-snipe extension: ${antiSnipeExt}s`);
  console.log(`   Winner share: ${Number(winnerBps) / 100}%`);
  console.log(`   Max keys/buy: ${maxKeysContract}`);
  
  // ─── Game Loop ──────────────────────────────────────────────────────────
  
  let totalSpent = 0n;
  let roundSpent = 0n;
  let currentRoundId = 0n;
  let bidCount = 0;
  let lastBidTime = 0;
  
  console.log('\n👀 Watching for opportunities...\n');
  
  while (true) {
    try {
      const roundInfo = await publicClient.readContract({
        address: CLAWFOMO, abi: ABI, functionName: 'getRoundInfo'
      });
      
      const [round, pot, endTime, lastBuyer, keysSold, keyPrice, isActive] = roundInfo;
      // H2 FIX: Validate timer with sanity bounds
      const now = BigInt(Math.floor(Date.now() / 1000));
      let timeLeft = 0;
      if (endTime > now && endTime < now + 86400n) { // Max 24h validity
        timeLeft = Number(endTime - now);
      }
      
      // New round detected
      if (round !== currentRoundId) {
        if (currentRoundId > 0n) {
          console.log(`\n🏁 Round #${currentRoundId} ended!`);
          console.log(`   Winner: ${lastBuyer.slice(0, 10)}...`);
          console.log(`   Our spend this round: ${formatUnits(roundSpent, 18)} CLAWD`);
          const isWinner = lastBuyer.toLowerCase() === account.address.toLowerCase();
          if (isWinner) {
            const winnings = (pot * winnerBps) / 10000n;
            console.log(`   🎉 WE WON! +${formatUnits(winnings, 18)} CLAWD`);
          }
        }
        currentRoundId = round;
        roundSpent = 0n;
        console.log(`\n📊 Round #${round} started`);
      }
      
      // Skip if not active
      if (!isActive || timeLeft === 0) {
        process.stdout.write(`\r⏳ Round #${round} — waiting for activity...`);
        await sleep(config.pollIntervalMs);
        continue;
      }
      
      // Calculate cost and EV
      const numKeys = BigInt(config.maxKeysPerBid);
      const cost = await publicClient.readContract({
        address: CLAWFOMO, abi: ABI, functionName: 'calculateCost', args: [numKeys]
      });
      
      const potentialWinnings = (pot * winnerBps) / 10000n;
      const ev = Number(formatUnits(potentialWinnings, 18)) - Number(formatUnits(cost, 18));
      const potMultiple = Number(potentialWinnings) / Number(cost || 1n);
      
      // Status line
      const isInSnipeWindow = timeLeft <= config.snipeWindowSec;
      const statusEmoji = isInSnipeWindow ? '🎯' : '👀';
      process.stdout.write(
        `\r${statusEmoji} R#${round} | ` +
        `Pot: ${Number(formatUnits(pot, 18)).toFixed(0)} | ` +
        `Timer: ${timeLeft}s | ` +
        `Cost: ${Number(formatUnits(cost, 18)).toFixed(0)} | ` +
        `EV: ${ev > 0 ? '+' : ''}${ev.toFixed(0)} | ` +
        `Keys: ${keysSold}    `
      );
      
      // ─── Decision Engine ──────────────────────────────────────────────
      
      // Check kill switches
      if (Number(formatUnits(totalSpent, 18)) >= config.maxTotalLoss) {
        console.log('\n🛑 KILL SWITCH: Max total loss reached. Stopping.');
        break;
      }
      
      if (Number(formatUnits(roundSpent, 18)) >= config.maxRoundLoss) {
        console.log('\n⚠️ Round loss limit reached. Waiting for next round...');
        await sleep(config.pollIntervalMs);
        continue;
      }
      
      // Check if cost exceeds our max bid
      if (Number(formatUnits(cost, 18)) > config.maxBidClawd) {
        await sleep(config.pollIntervalMs);
        continue;
      }
      
      // THE DECISION: Should we bid?
      const shouldBid = (
        isInSnipeWindow &&                           // Only bid in snipe window
        timeLeft > config.minTimerSec &&             // Not too late
        potMultiple >= config.minPotMultiple &&      // Pot is worth it
        ev > 0 &&                                    // Positive EV
        lastBuyer.toLowerCase() !== account.address.toLowerCase() && // We're not already winning
        Date.now() - lastBidTime > 10000             // Rate limit (10s between bids)
      );
      
      if (shouldBid) {
        console.log(`\n\n🎯 BIDDING! Round #${round}`);
        console.log(`   Keys: ${numKeys}`);
        console.log(`   Cost: ${formatUnits(cost, 18)} CLAWD`);
        console.log(`   Pot: ${formatUnits(pot, 18)} CLAWD`);
        console.log(`   Potential win: ${formatUnits(potentialWinnings, 18)} CLAWD`);
        console.log(`   EV: ${ev > 0 ? '+' : ''}${ev.toFixed(2)} CLAWD`);
        console.log(`   Timer: ${timeLeft}s`);
        
        if (config.dryRun) {
          console.log(`   🔮 DRY RUN — would have bid`);
        } else {
          try {
            // H1 FIX: Re-check cost right before bidding (slippage protection)
            const finalCost = await publicClient.readContract({
              address: CLAWFOMO, abi: ABI, functionName: 'calculateCost', args: [numKeys]
            });
            const maxCostWei = parseUnits(config.maxBidClawd.toString(), 18);
            if (finalCost > maxCostWei) {
              console.log(`   ⚠️ Cost increased to ${formatUnits(finalCost, 18)} — exceeds max bid, skipping`);
              await sleep(config.pollIntervalMs);
              continue;
            }
            
            const hash = await walletClient.writeContract({
              address: CLAWFOMO, abi: ABI, functionName: 'buyKeys', args: [numKeys]
            });
            console.log(`   ✅ TX: ${hash}`);
            await publicClient.waitForTransactionReceipt({ hash });
            console.log(`   ✅ Confirmed!`);
            
            totalSpent += cost;
            roundSpent += cost;
            bidCount++;
            lastBidTime = Date.now();
            
            console.log(`   📊 Total spent: ${formatUnits(totalSpent, 18)} CLAWD (${bidCount} bids)`);
          } catch (err) {
            console.log(`   ❌ Bid failed: ${err.message.slice(0, 100)}`);
          }
        }
        console.log('');
      }
      
    } catch (err) {
      console.error(`\n⚠️ Error: ${err.message.slice(0, 100)}`);
    }
    
    await sleep(config.pollIntervalMs);
  }
  
  // Final stats
  console.log('\n═'.repeat(50));
  console.log('📊 Session Summary');
  console.log(`   Bids placed: ${bidCount}`);
  console.log(`   Total spent: ${formatUnits(totalSpent, 18)} CLAWD`);
  console.log('═'.repeat(50));
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
