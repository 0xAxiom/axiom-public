#!/usr/bin/env node
/**
 * ClawFomo V4 — "Vulture" Strategy
 * 
 * Core insight: The game has a 10% burn tax on every bid. It's fundamentally
 * -EV unless you enter when pot >> cost and no one is watching.
 * 
 * Strategy:
 * 1. PATIENCE — skip most rounds, only enter high-EV setups
 * 2. 1 KEY ALWAYS — same win probability as 5, fraction of the cost
 * 3. OPPONENT TRACKING — map addresses to behavior patterns
 * 4. ACTIVITY DETECTION — only enter when round has gone quiet
 * 5. STRICT LIMITS — max 3 bids per round, hard stop
 * 6. POT:COST RATIO — need 5x minimum (was 1.5x, way too loose)
 */

import { createPublicClient, createWalletClient, http, formatUnits } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base } from 'viem/chains';
import { readFileSync, writeFileSync, existsSync } from 'fs';

// ─── Config ─────────────────────────────────────────────────────────────────

const CLAWFOMO = '0x859e5cb97e1cf357643a6633d5bec6d45e44cfd4';
const CLAWD_TOKEN = '0x9f86dB9fc6f7c9408e8Fda3Ff8ce4e78ac7a6b07';
const STATE_FILE = '/tmp/clawfomo-v4-state.json';

const CONFIG = {
  keysPerBid: 1,              // ALWAYS 1 — minimum cost, same win probability
  minPotCostRatio: 5,         // Need pot > 5x our cost to even consider
  snipeWindowSec: 120,        // Anti-snipe threshold
  minTimerSec: 4,             // Don't bid if tx won't land
  maxBidsPerRound: Infinity,   // No cap — cumulative EV controls everything. 1 key = cheap to defend.
  minQuietSec: 45,            // Round must be quiet for 45s+ before we enter
  maxActiveOpponents: 2,      // Skip rounds with 3+ active bidders
  cooldownAfterLoss: 30000,   // 30s cooldown after losing a round
  pollIntervalMs: 5000,       // Check every 5s (avoid RPC rate limits)
  dryRun: false,
};

// Parse CLI args
for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i] === '--dry-run') CONFIG.dryRun = true;
  if (process.argv[i] === '--min-ratio') CONFIG.minPotCostRatio = Number(process.argv[++i]);
  if (process.argv[i] === '--max-bids') CONFIG.maxBidsPerRound = Number(process.argv[++i]);
  if (process.argv[i] === '--quiet') CONFIG.minQuietSec = Number(process.argv[++i]);
}

// ─── ABI ────────────────────────────────────────────────────────────────────

const ABI = [
  { name: 'getRoundInfo', type: 'function', stateMutability: 'view', inputs: [], outputs: [
    { name: 'round', type: 'uint256' }, { name: 'potSize', type: 'uint256' },
    { name: 'endTime', type: 'uint256' }, { name: 'lastBuyerAddr', type: 'address' },
    { name: 'keys', type: 'uint256' }, { name: 'keyPrice', type: 'uint256' },
    { name: 'isActive', type: 'bool' }
  ]},
  { name: 'calculateCost', type: 'function', stateMutability: 'view',
    inputs: [{ name: 'numKeys', type: 'uint256' }], outputs: [{ type: 'uint256' }] },
  { name: 'buyKeys', type: 'function', stateMutability: 'nonpayable',
    inputs: [{ name: 'numKeys', type: 'uint256' }], outputs: [] },
  { name: 'WINNER_BPS', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
];

const ERC20_ABI = [
  { name: 'approve', type: 'function', stateMutability: 'nonpayable',
    inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }] },
  { name: 'allowance', type: 'function', stateMutability: 'view',
    inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { name: 'balanceOf', type: 'function', stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'uint256' }] },
];

// ─── State Management ───────────────────────────────────────────────────────

function loadState() {
  if (existsSync(STATE_FILE)) {
    try { return JSON.parse(readFileSync(STATE_FILE, 'utf-8')); } catch {}
  }
  return {
    startBalance: null,
    startTime: null,
    totalSpent: 0,
    totalWon: 0,
    roundsPlayed: 0,
    roundsWon: 0,
    roundsLost: 0,
    roundsSkipped: 0,
    opponents: {},       // address -> { bids, wins, lastSeen, avgResponseTime }
    roundHistory: [],    // last 50 rounds
  };
}

function saveState(state) {
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

// ─── Opponent Tracker ───────────────────────────────────────────────────────

class OpponentTracker {
  constructor(state) {
    this.opponents = state.opponents || {};
    this.roundActivity = new Map(); // roundId -> { addresses: Set, lastBidTime, bidCount }
  }

  recordBid(roundId, address, timestamp) {
    if (!this.opponents[address]) {
      this.opponents[address] = { bids: 0, wins: 0, lastSeen: 0, rounds: 0 };
    }
    this.opponents[address].bids++;
    this.opponents[address].lastSeen = timestamp;

    if (!this.roundActivity.has(roundId)) {
      this.roundActivity.set(roundId, { addresses: new Set(), lastBidTime: 0, bidCount: 0 });
    }
    const ra = this.roundActivity.get(roundId);
    ra.addresses.add(address.toLowerCase());
    ra.lastBidTime = timestamp;
    ra.bidCount++;
  }

  recordWin(address) {
    if (this.opponents[address]) this.opponents[address].wins++;
  }

  getActiveOpponents(roundId) {
    const ra = this.roundActivity.get(roundId);
    if (!ra) return 0;
    return ra.addresses.size;
  }

  getTimeSinceLastBid(roundId) {
    const ra = this.roundActivity.get(roundId);
    if (!ra || !ra.lastBidTime) return Infinity;
    return Date.now() - ra.lastBidTime;
  }

  isAggressiveOpponent(address) {
    const opp = this.opponents[address.toLowerCase()];
    if (!opp) return false;
    return opp.bids > 10 && opp.wins > 3; // Frequent + successful = dangerous
  }

  cleanupOldRounds(currentRound) {
    for (const [roundId] of this.roundActivity) {
      if (Number(roundId) < currentRound - 5) {
        this.roundActivity.delete(roundId);
      }
    }
  }
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const pk = process.env.NET_PRIVATE_KEY;
  if (!pk) { console.error('NET_PRIVATE_KEY not set'); process.exit(1); }

  const account = privateKeyToAccount(pk.startsWith('0x') ? pk : `0x${pk}`);
  const rpcUrl = process.env.BASE_RPC_URL || 'https://mainnet.base.org';
  const publicClient = createPublicClient({
    chain: base,
    transport: http(rpcUrl, { retryCount: 3, retryDelay: 2000, timeout: 10000 }),
  });
  const walletClient = createWalletClient({
    account, chain: base,
    transport: http(rpcUrl, { retryCount: 3, retryDelay: 2000, timeout: 10000 }),
  });

  const state = loadState();
  const tracker = new OpponentTracker(state);

  // Get balance
  const balance = await publicClient.readContract({
    address: CLAWD_TOKEN, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address]
  });
  const winnerBps = await publicClient.readContract({ address: CLAWFOMO, abi: ABI, functionName: 'WINNER_BPS' });

  if (!state.startBalance) {
    state.startBalance = parseFloat(formatUnits(balance, 18));
    state.startTime = new Date().toISOString();
  }

  console.log('🦅 ClawFomo V4 — Vulture Strategy');
  console.log('═'.repeat(55));
  console.log(`Wallet: ${account.address}`);
  console.log(`Balance: ${formatUnits(balance, 18)} CLAWD`);
  console.log(`Mode: ${CONFIG.dryRun ? '🔮 DRY RUN' : '🔴 LIVE'}`);
  console.log(`Strategy: 1 key | ${CONFIG.minPotCostRatio}x min ratio | ${CONFIG.maxBidsPerRound} max bids | ${CONFIG.minQuietSec}s quiet`);
  console.log(`Lifetime: ${state.roundsWon}W/${state.roundsLost}L | Spent: ${state.totalSpent.toFixed(0)} | Won: ${state.totalWon.toFixed(0)}`);
  console.log('═'.repeat(55));

  // Ensure approval
  const allowance = await publicClient.readContract({
    address: CLAWD_TOKEN, abi: ERC20_ABI, functionName: 'allowance', args: [account.address, CLAWFOMO]
  });
  if (allowance < balance && !CONFIG.dryRun) {
    console.log('📝 Approving CLAWD...');
    const hash = await walletClient.writeContract({
      address: CLAWD_TOKEN, abi: ERC20_ABI, functionName: 'approve',
      args: [CLAWFOMO, 2n ** 256n - 1n] // Max approval — don't waste gas re-approving
    });
    await publicClient.waitForTransactionReceipt({ hash });
    console.log('✅ Approved');
  }

  // ─── Game Loop ──────────────────────────────────────────────────────────

  let currentRoundId = 0n;
  let roundBids = 0;
  let roundSpent = 0n;
  let lastBidTime = 0;
  let lastLeader = '';
  let lastKeysSold = 0n;
  let cooldownUntil = 0;
  let weAreLeader = false;

  console.log('\n🦅 Watching...\n');

  while (true) {
    try {
      const roundInfo = await publicClient.readContract({
        address: CLAWFOMO, abi: ABI, functionName: 'getRoundInfo'
      });

      const [round, pot, endTime, lastBuyer, keysSold, keyPrice, isActive] = roundInfo;
      const now = BigInt(Math.floor(Date.now() / 1000));
      const timeLeft = (endTime > now && endTime < now + 86400n) ? Number(endTime - now) : 0;
      const myAddr = account.address.toLowerCase();
      weAreLeader = lastBuyer.toLowerCase() === myAddr;

      // ── Detect new activity (someone bought keys) ──
      if (round === currentRoundId && keysSold > lastKeysSold) {
        const buyerAddr = lastBuyer.toLowerCase();
        if (buyerAddr !== myAddr) {
          tracker.recordBid(Number(round), buyerAddr, Date.now());
        }
      }
      lastKeysSold = keysSold;
      lastLeader = lastBuyer.toLowerCase();

      // ── New round ──
      if (round !== currentRoundId) {
        if (currentRoundId > 0n) {
          // Score previous round
          if (roundBids > 0) {
            const wasWinner = lastBuyer.toLowerCase() === myAddr;
            if (wasWinner) {
              const winnings = parseFloat(formatUnits((pot * winnerBps) / 10000n, 18));
              state.totalWon += winnings;
              state.roundsWon++;
              console.log(`\n🎉 WON R#${currentRoundId}! +${winnings.toFixed(0)} CLAWD`);
            } else {
              state.roundsLost++;
              cooldownUntil = Date.now() + CONFIG.cooldownAfterLoss;
              console.log(`\n❌ LOST R#${currentRoundId} — spent ${formatUnits(roundSpent, 18)} CLAWD. Cooling down 30s.`);
              tracker.recordWin(lastBuyer);
            }
            state.roundsPlayed++;
            state.roundHistory.push({
              round: Number(currentRoundId),
              spent: parseFloat(formatUnits(roundSpent, 18)),
              won: lastBuyer.toLowerCase() === myAddr,
              bids: roundBids,
              time: new Date().toISOString(),
            });
            if (state.roundHistory.length > 50) state.roundHistory = state.roundHistory.slice(-50);
          } else {
            state.roundsSkipped++;
          }

          // P&L report every 10 rounds
          if (state.roundsPlayed > 0 && state.roundsPlayed % 10 === 0) {
            const pnl = state.totalWon - state.totalSpent;
            const winRate = ((state.roundsWon / state.roundsPlayed) * 100).toFixed(1);
            console.log(`\n📊 P&L Report: ${pnl > 0 ? '+' : ''}${pnl.toFixed(0)} CLAWD | ${state.roundsWon}W/${state.roundsLost}L (${winRate}%) | ${state.roundsSkipped} skipped`);
          }
        }

        currentRoundId = round;
        roundBids = 0;
        roundSpent = 0n;
        tracker.cleanupOldRounds(Number(round));
        saveState(state);
      }

      // ── Skip if inactive ──
      if (!isActive || timeLeft === 0) {
        process.stdout.write(`\r⏳ R#${round} — waiting...`);
        await sleep(CONFIG.pollIntervalMs);
        continue;
      }

      // ── Calculate cost for 1 key ──
      const cost = await publicClient.readContract({
        address: CLAWFOMO, abi: ABI, functionName: 'calculateCost', args: [1n]
      });

      const potNum = parseFloat(formatUnits(pot, 18));
      const costNum = parseFloat(formatUnits(cost, 18));
      const potCostRatio = potNum / costNum;
      const winIfWe = parseFloat(formatUnits((pot * winnerBps) / 10000n, 18));
      const activeOpponents = tracker.getActiveOpponents(Number(round));
      const quietMs = tracker.getTimeSinceLastBid(Number(round));
      const quietSec = quietMs === Infinity ? 999 : Math.floor(quietMs / 1000);
      const inSnipeWindow = timeLeft <= CONFIG.snipeWindowSec;

      // Status
      const emoji = weAreLeader ? '👑' : (inSnipeWindow ? '🎯' : '👀');
      process.stdout.write(
        `\r${emoji} R#${round} | ` +
        `Pot: ${potNum.toFixed(0)} | T: ${timeLeft}s | ` +
        `Cost: ${costNum.toFixed(0)} (1k) | ` +
        `Ratio: ${potCostRatio.toFixed(1)}x | ` +
        `Quiet: ${quietSec}s | ` +
        `Opp: ${activeOpponents} | ` +
        `Bids: ${roundBids}/${CONFIG.maxBidsPerRound}    `
      );

      // ── Decision Engine ──────────────────────────────────────────────

      // Skip conditions
      if (weAreLeader) continue;                                    // Already winning
      if (Date.now() < cooldownUntil) continue;                     // Cooling down
      // No bid cap — EV check below is the real control
      if (!inSnipeWindow) { await sleep(CONFIG.pollIntervalMs); continue; } // Not in window
      if (timeLeft < CONFIG.minTimerSec) continue;                  // Too late
      if (potCostRatio < CONFIG.minPotCostRatio) continue;          // Pot too small vs cost
      if (activeOpponents > CONFIG.maxActiveOpponents) continue;    // Too crowded
      if (quietSec < CONFIG.minQuietSec && roundBids === 0) continue; // Round not quiet enough for first entry
      if (Date.now() - lastBidTime < 8000) continue;               // Rate limit

      // Net EV check: even after our bid, would winning cover ALL our round spending?
      const projectedPot = pot + (cost * 65n / 100n);
      const projectedWin = parseFloat(formatUnits((projectedPot * winnerBps) / 10000n, 18));
      const totalRoundCost = parseFloat(formatUnits(roundSpent + cost, 18));
      const netEv = projectedWin - totalRoundCost;

      if (netEv <= 0) continue; // Not worth it even if we win

      // ── BID! ──────────────────────────────────────────────────────────

      console.log(`\n\n🦅 STRIKE! R#${round}`);
      console.log(`   Cost: ${costNum.toFixed(0)} CLAWD (1 key)`);
      console.log(`   Pot: ${potNum.toFixed(0)} CLAWD (${potCostRatio.toFixed(1)}x ratio)`);
      console.log(`   Win if last: ${winIfWe.toFixed(0)} CLAWD`);
      console.log(`   Net EV: +${netEv.toFixed(0)} CLAWD`);
      console.log(`   Timer: ${timeLeft}s | Quiet: ${quietSec}s | Opponents: ${activeOpponents}`);
      console.log(`   Round bids: ${roundBids}/${CONFIG.maxBidsPerRound}`);

      if (CONFIG.dryRun) {
        console.log('   🔮 DRY RUN — would have bid');
      } else {
        try {
          // Pre-flight: re-check cost for frontrun protection
          const finalCost = await publicClient.readContract({
            address: CLAWFOMO, abi: ABI, functionName: 'calculateCost', args: [1n]
          });
          if (finalCost > cost * 3n / 2n) {
            console.log(`   ⚠️ Cost spiked ${formatUnits(cost, 18)} → ${formatUnits(finalCost, 18)} — frontrun, skipping`);
            await sleep(CONFIG.pollIntervalMs);
            continue;
          }

          const hash = await walletClient.writeContract({
            address: CLAWFOMO, abi: ABI, functionName: 'buyKeys', args: [1n]
          });
          console.log(`   🔨 TX: ${hash}`);
          await publicClient.waitForTransactionReceipt({ hash });
          console.log('   ✅ Confirmed!');

          roundSpent += cost;
          roundBids++;
          lastBidTime = Date.now();
          state.totalSpent += costNum;
          saveState(state);

          console.log(`   📊 Round spend: ${formatUnits(roundSpent, 18)} CLAWD (${roundBids} bids)`);
        } catch (err) {
          console.log(`   ❌ Failed: ${err.message.slice(0, 120)}`);
        }
      }
      console.log('');

    } catch (err) {
      if (!err.message.includes('fetch')) {
        console.error(`\n⚠️ ${err.message.slice(0, 100)}`);
      }
    }

    await sleep(CONFIG.pollIntervalMs);
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
