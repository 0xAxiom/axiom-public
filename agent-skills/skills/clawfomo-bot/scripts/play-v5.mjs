#!/usr/bin/env node
/**
 * ClawFomo V5 — "Smart Vulture"
 * 
 * Synthesized from Scout (game theory) + Analyst (on-chain data):
 * 
 * 1. 1 KEY PER BID — cheapest path to last-buyer, same win probability
 * 2. OPPONENT PROFILING — dodge the whale, exploit tourists
 * 3. DIVIDEND-AWARE EV — factor in earned dividends when calculating round profitability
 * 4. ADAPTIVE PATIENCE — wait for quiet moments, enter when others give up
 * 5. NO ARBITRARY CAPS — pure EV math controls all decisions
 * 6. ROUND SELECTION — skip crowded/whale rounds, target 2-4 player sweet spot
 */

import { createPublicClient, createWalletClient, http, formatUnits, parseAbi } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base } from 'viem/chains';
import { readFileSync, writeFileSync, existsSync } from 'fs';

// ─── Addresses ──────────────────────────────────────────────────────────────

const CLAWFOMO = '0x859e5cb97e1cf357643a6633d5bec6d45e44cfd4';
const CLAWD_TOKEN = '0x9f86dB9fc6f7c9408e8Fda3Ff8ce4e78ac7a6b07';
const MY_ADDR = '0x523Eff3dB03938eaa31a5a6FBd41E3B9d23edde5';

// Known dangerous opponents (from on-chain analysis)
const KNOWN_WHALES = new Set([
  '0x865a80b1',  // The Whale — aggressive high-gas bidder
]);

const STATE_FILE = '/tmp/clawfomo-v5-state.json';

// ─── Config ─────────────────────────────────────────────────────────────────

const C = {
  keysPerBid: 1,
  minPotCostRatio: 4,        // Pot must be 4x our cost minimum  
  snipeWindowSec: 120,        // Anti-snipe threshold
  minTimerSec: 5,             // TX needs time to land
  minQuietSec: 30,            // Seconds of quiet before first entry
  pollIntervalMs: 5000,       // 5s polling (avoid RPC rate limits)
  bidCooldownMs: 6000,        // Min 6s between our bids
  maxOpponents: 4,            // Skip if more than 4 active bidders
  dryRun: false,
};

// Parse CLI
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv;
  if (a[i] === '--dry-run') C.dryRun = true;
  if (a[i] === '--ratio') C.minPotCostRatio = Number(a[++i]);
  if (a[i] === '--quiet') C.minQuietSec = Number(a[++i]);
  if (a[i] === '--poll') C.pollIntervalMs = Number(a[++i]);
}

// ─── ABI ────────────────────────────────────────────────────────────────────

const ABI = parseAbi([
  'function getRoundInfo() view returns (uint256 round, uint256 potSize, uint256 endTime, address lastBuyerAddr, uint256 keys, uint256 keyPrice, bool isActive)',
  'function calculateCost(uint256 numKeys) view returns (uint256)',
  'function buyKeys(uint256 numKeys)',
  'function WINNER_BPS() view returns (uint256)',
  'function totalUnclaimedDividends(address player) view returns (uint256)',
  'function claimAllDividends() returns (uint256)',
  'function getPlayer(uint256 round, address addr) view returns (uint256 keys, uint256 spent, uint256 dividends)',
]);

const ERC20 = parseAbi([
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function balanceOf(address account) view returns (uint256)',
]);

// ─── State ──────────────────────────────────────────────────────────────────

function loadState() {
  try { return JSON.parse(readFileSync(STATE_FILE, 'utf-8')); } catch {}
  return {
    startBalance: null, startTime: null,
    totalSpent: 0, totalWon: 0, totalDivsClaimed: 0,
    roundsPlayed: 0, roundsWon: 0, roundsLost: 0, roundsSkipped: 0,
    opponents: {},
    history: [],
  };
}
function saveState(s) { writeFileSync(STATE_FILE, JSON.stringify(s, null, 2)); }

// ─── Round Tracker ──────────────────────────────────────────────────────────

class RoundTracker {
  constructor() {
    this.bidders = new Map();     // address -> { count, lastTime, totalKeys }
    this.lastActivityTime = 0;
    this.lastKeysSold = 0n;
    this.lastLeader = '';
    this.ourBids = 0;
    this.ourSpent = 0n;
    this.hasWhale = false;
  }

  reset() {
    this.bidders.clear();
    this.lastActivityTime = 0;
    this.lastKeysSold = 0n;
    this.lastLeader = '';
    this.ourBids = 0;
    this.ourSpent = 0n;
    this.hasWhale = false;
  }

  onNewKeys(keysSold, leader) {
    const diff = keysSold - this.lastKeysSold;
    if (diff > 0n && keysSold !== this.lastKeysSold) {
      const addr = leader.toLowerCase();
      if (addr !== MY_ADDR.toLowerCase()) {
        const existing = this.bidders.get(addr) || { count: 0, lastTime: 0 };
        existing.count++;
        existing.lastTime = Date.now();
        this.bidders.set(addr, existing);
        this.lastActivityTime = Date.now();

        // Check if this is a known whale
        if (KNOWN_WHALES.has(addr.slice(0, 10).toLowerCase())) {
          this.hasWhale = true;
        }
      }
    }
    this.lastKeysSold = keysSold;
    this.lastLeader = leader.toLowerCase();
  }

  get uniqueOpponents() { return this.bidders.size; }
  get quietMs() { return this.lastActivityTime ? Date.now() - this.lastActivityTime : Infinity; }
  get quietSec() { return this.quietMs === Infinity ? 999 : Math.floor(this.quietMs / 1000); }
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const pk = process.env.NET_PRIVATE_KEY;
  if (!pk) { console.error('NET_PRIVATE_KEY not set'); process.exit(1); }

  const account = privateKeyToAccount(pk.startsWith('0x') ? pk : `0x${pk}`);
  const rpc = process.env.BASE_RPC_URL || 'https://mainnet.base.org';
  const pub = createPublicClient({ chain: base, transport: http(rpc, { retryCount: 3, retryDelay: 2000, timeout: 15000 }) });
  const wall = createWalletClient({ account, chain: base, transport: http(rpc, { retryCount: 3, retryDelay: 2000, timeout: 15000 }) });

  const state = loadState();
  const rt = new RoundTracker();

  // Init
  const [balance, winnerBps] = await Promise.all([
    pub.readContract({ address: CLAWD_TOKEN, abi: ERC20, functionName: 'balanceOf', args: [account.address] }),
    pub.readContract({ address: CLAWFOMO, abi: ABI, functionName: 'WINNER_BPS' }),
  ]);

  if (!state.startBalance) {
    state.startBalance = parseFloat(formatUnits(balance, 18));
    state.startTime = new Date().toISOString();
    saveState(state);
  }

  const lifePnl = (state.totalWon + state.totalDivsClaimed - state.totalSpent).toFixed(0);

  console.log('🦅 ClawFomo V5 — Smart Vulture');
  console.log('═'.repeat(60));
  console.log(`Wallet:   ${account.address}`);
  console.log(`Balance:  ${Number(formatUnits(balance, 18)).toFixed(0)} CLAWD`);
  console.log(`Mode:     ${C.dryRun ? '🔮 DRY RUN' : '🔴 LIVE'}`);
  console.log(`Strategy: 1 key | ${C.minPotCostRatio}x ratio | ${C.minQuietSec}s quiet | dodge whales`);
  console.log(`Lifetime: ${state.roundsWon}W/${state.roundsLost}L | P&L: ${lifePnl} CLAWD`);
  console.log('═'.repeat(60));

  // Ensure max approval
  const allowance = await pub.readContract({
    address: CLAWD_TOKEN, abi: ERC20, functionName: 'allowance', args: [account.address, CLAWFOMO]
  });
  if (allowance < balance && !C.dryRun) {
    console.log('📝 Approving...');
    const h = await wall.writeContract({ address: CLAWD_TOKEN, abi: ERC20, functionName: 'approve', args: [CLAWFOMO, 2n ** 256n - 1n] });
    await pub.waitForTransactionReceipt({ hash: h });
    console.log('✅ Approved');
  }

  // ─── Game Loop ────────────────────────────────────────────────────────

  let currentRound = 0n;
  let lastBidTime = 0;

  console.log('\n🦅 Scanning...\n');

  while (true) {
    try {
      // Single multicall-style read
      const roundInfo = await pub.readContract({ address: CLAWFOMO, abi: ABI, functionName: 'getRoundInfo' });
      const [round, pot, endTime, lastBuyer, keysSold, keyPrice, isActive] = roundInfo;

      const now = BigInt(Math.floor(Date.now() / 1000));
      const timeLeft = (endTime > now && endTime < now + 86400n) ? Number(endTime - now) : 0;
      const weAreLeader = lastBuyer.toLowerCase() === MY_ADDR.toLowerCase();

      // ── Track activity ──
      rt.onNewKeys(keysSold, lastBuyer);

      // ── New round ──
      if (round !== currentRound) {
        if (currentRound > 0n && rt.ourBids > 0) {
          // Score previous round
          if (weAreLeader) {
            // We were leader when round changed — but need to check if we actually won
            // (the new round means old one ended)
          }
          const wasWinner = rt.lastLeader === MY_ADDR.toLowerCase();
          if (wasWinner) {
            const winAmt = parseFloat(formatUnits((pot * winnerBps) / 10000n, 18));
            state.totalWon += winAmt;
            state.roundsWon++;
            console.log(`\n🎉 WON R#${currentRound}! +${winAmt.toFixed(0)} CLAWD (spent ${formatUnits(rt.ourSpent, 18)})`);
          } else if (rt.ourBids > 0) {
            state.roundsLost++;
            console.log(`\n❌ LOST R#${currentRound} — spent ${formatUnits(rt.ourSpent, 18)} CLAWD (${rt.ourBids} bids)`);
          }
          state.roundsPlayed++;

          // Check for claimable dividends every round
          try {
            const divs = await pub.readContract({
              address: CLAWFOMO, abi: ABI, functionName: 'totalUnclaimedDividends', args: [account.address]
            });
            const divsNum = parseFloat(formatUnits(divs, 18));
            if (divsNum > 5000 && !C.dryRun) {
              console.log(`💰 Claiming ${divsNum.toFixed(0)} CLAWD in dividends...`);
              const h = await wall.writeContract({ address: CLAWFOMO, abi: ABI, functionName: 'claimAllDividends' });
              await pub.waitForTransactionReceipt({ hash: h });
              state.totalDivsClaimed += divsNum;
              console.log('✅ Dividends claimed!');
            }
          } catch {}

          // P&L report
          const pnl = state.totalWon + state.totalDivsClaimed - state.totalSpent;
          const wr = state.roundsPlayed > 0 ? ((state.roundsWon / state.roundsPlayed) * 100).toFixed(0) : 0;
          console.log(`📊 ${state.roundsWon}W/${state.roundsLost}L (${wr}%) | P&L: ${pnl > 0 ? '+' : ''}${pnl.toFixed(0)} | Divs: +${state.totalDivsClaimed.toFixed(0)}\n`);

          state.history.push({
            round: Number(currentRound),
            won: wasWinner,
            spent: parseFloat(formatUnits(rt.ourSpent, 18)),
            bids: rt.ourBids,
            opponents: rt.uniqueOpponents,
            hadWhale: rt.hasWhale,
            time: new Date().toISOString(),
          });
          if (state.history.length > 100) state.history = state.history.slice(-100);
          saveState(state);
        } else if (currentRound > 0n) {
          state.roundsSkipped++;
        }

        currentRound = round;
        rt.reset();
        console.log(`📋 R#${round} started`);
      }

      // ── Skip inactive ──
      if (!isActive || timeLeft === 0) {
        process.stdout.write(`\r⏳ R#${round} — inactive    `);
        await sleep(C.pollIntervalMs);
        continue;
      }

      // ── Get cost for 1 key ──
      const cost = await pub.readContract({
        address: CLAWFOMO, abi: ABI, functionName: 'calculateCost', args: [1n]
      });

      const potNum = parseFloat(formatUnits(pot, 18));
      const costNum = parseFloat(formatUnits(cost, 18));
      const ratio = potNum / costNum;
      const inWindow = timeLeft <= C.snipeWindowSec;

      // Status line
      const emoji = weAreLeader ? '👑' : (inWindow ? '🎯' : '👀');
      const whaleTag = rt.hasWhale ? ' 🐋' : '';
      process.stdout.write(
        `\r${emoji} R#${round} | ` +
        `Pot: ${potNum.toFixed(0)} | T: ${timeLeft}s | ` +
        `1k: ${costNum.toFixed(0)} | ` +
        `${ratio.toFixed(1)}x | ` +
        `Q: ${rt.quietSec}s | ` +
        `Opp: ${rt.uniqueOpponents}${whaleTag} | ` +
        `Bids: ${rt.ourBids}    `
      );

      // ── Decision Engine ──────────────────────────────────────────────

      // SKIP: already winning — wait for someone to outbid us
      if (weAreLeader) { await sleep(C.pollIntervalMs); continue; }

      // SKIP: not in snipe window yet
      if (!inWindow) { await sleep(C.pollIntervalMs); continue; }

      // SKIP: too late for TX to land
      if (timeLeft < C.minTimerSec) { await sleep(C.pollIntervalMs); continue; }

      // SKIP: pot:cost ratio too low
      if (ratio < C.minPotCostRatio) { await sleep(C.pollIntervalMs); continue; }

      // SKIP: whale detected — they'll outspend us
      if (rt.hasWhale) { await sleep(C.pollIntervalMs); continue; }

      // SKIP: too many opponents — bidding war likely
      if (rt.uniqueOpponents > C.maxOpponents) { await sleep(C.pollIntervalMs); continue; }

      // SKIP: round not quiet enough for first entry
      if (rt.ourBids === 0 && rt.quietSec < C.minQuietSec) { await sleep(C.pollIntervalMs); continue; }

      // SKIP: cooldown between bids
      if (Date.now() - lastBidTime < C.bidCooldownMs) { await sleep(C.pollIntervalMs); continue; }

      // ── EV CHECK (dividend-aware) ──
      // After our bid: ~65% of cost goes to pot, pot grows
      const projPot = pot + (cost * 65n / 100n);
      const projWin = parseFloat(formatUnits((projPot * winnerBps) / 10000n, 18));

      // Estimate dividends we've already earned + will earn from our bid
      // Each key we hold earns from 25% of post-burn of every subsequent buy
      // Rough estimate: our keys / total keys * 22.5% of average bid * expected remaining bids
      const ourKeys = BigInt(rt.ourBids); // 1 key per bid
      const totalKeys = keysSold + 1n; // after our buy
      const divEstimate = rt.ourBids > 0
        ? parseFloat(formatUnits(ourKeys, 0)) / parseFloat(formatUnits(totalKeys, 0)) * costNum * 0.225 * 2 // expect ~2 more bids
        : 0;

      const totalRoundCost = parseFloat(formatUnits(rt.ourSpent + cost, 18));
      const netEv = projWin + divEstimate - totalRoundCost;

      if (netEv <= 0) { await sleep(C.pollIntervalMs); continue; }

      // ═══ BID ═══
      console.log(`\n\n🦅 STRIKE! R#${round}`);
      console.log(`   Cost: ${costNum.toFixed(0)} (1 key) | Pot: ${potNum.toFixed(0)} (${ratio.toFixed(1)}x)`);
      console.log(`   Win: ${projWin.toFixed(0)} | Divs est: ${divEstimate.toFixed(0)} | Net EV: +${netEv.toFixed(0)}`);
      console.log(`   T: ${timeLeft}s | Q: ${rt.quietSec}s | Opp: ${rt.uniqueOpponents} | Our bids: ${rt.ourBids}`);

      if (C.dryRun) {
        console.log('   🔮 DRY RUN');
        rt.ourBids++;
      } else {
        try {
          // Frontrun protection: re-check cost
          const finalCost = await pub.readContract({ address: CLAWFOMO, abi: ABI, functionName: 'calculateCost', args: [1n] });
          if (finalCost > cost * 3n / 2n) {
            console.log(`   ⚠️ Cost spiked ${costNum.toFixed(0)} → ${formatUnits(finalCost, 18)} — skip`);
            await sleep(C.pollIntervalMs);
            continue;
          }

          const hash = await wall.writeContract({ address: CLAWFOMO, abi: ABI, functionName: 'buyKeys', args: [1n] });
          console.log(`   🔨 ${hash}`);
          await pub.waitForTransactionReceipt({ hash });
          console.log('   ✅ Confirmed');

          rt.ourSpent += cost;
          rt.ourBids++;
          lastBidTime = Date.now();
          state.totalSpent += costNum;
          saveState(state);

          console.log(`   Round: ${formatUnits(rt.ourSpent, 18)} spent (${rt.ourBids} bids)`);
        } catch (err) {
          console.log(`   ❌ ${err.message.slice(0, 120)}`);
        }
      }
      console.log('');

    } catch (err) {
      // Suppress RPC noise
      if (!err.message?.includes('429') && !err.message?.includes('fetch')) {
        console.error(`\n⚠️ ${err.message?.slice(0, 100)}`);
      }
    }

    await sleep(C.pollIntervalMs);
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

main().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
