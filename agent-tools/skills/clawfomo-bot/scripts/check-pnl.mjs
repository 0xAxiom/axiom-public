#!/usr/bin/env node
/**
 * ClawFomo P&L Tracker
 * Checks balance, round status, and cumulative performance.
 * Outputs a summary for cron consumption.
 */

import { createPublicClient, http, formatUnits } from 'viem';
import { base } from 'viem/chains';
import { readFileSync, writeFileSync, existsSync } from 'fs';

const CLAWFOMO = '0x859e5cb97e1cf357643a6633d5bec6d45e44cfd4';
const CLAWD = '0x9f86dB9fc6f7c9408e8Fda3Ff8ce4e78ac7a6b07';
const MY_WALLET = '0x523Eff3dB03938eaa31a5a6FBd41E3B9d23edde5';
const STATE_FILE = '/tmp/clawfomo-pnl-state.json';

const FOMO_ABI = [
  { name: 'getRoundInfo', type: 'function', inputs: [], outputs: [
    { name: 'round', type: 'uint256' },
    { name: 'potSize', type: 'uint256' },
    { name: 'endTime', type: 'uint256' },
    { name: 'lastBuyerAddr', type: 'address' },
    { name: 'keys', type: 'uint256' },
    { name: 'keyPrice', type: 'uint256' },
    { name: 'isActive', type: 'bool' }
  ]},
  { name: 'pendingDividends', type: 'function', inputs: [{type:'address'}], outputs: [{type:'uint256'}] },
];

const ERC20_ABI = [
  { name: 'balanceOf', type: 'function', inputs: [{type:'address'}], outputs: [{type:'uint256'}] },
];

const client = createPublicClient({
  chain: base,
  transport: http(process.env.BASE_RPC_URL || 'https://mainnet.base.org'),
});

function loadState() {
  if (existsSync(STATE_FILE)) {
    return JSON.parse(readFileSync(STATE_FILE, 'utf-8'));
  }
  return {
    startBalance: null,
    startTime: null,
    checks: [],
    roundResults: [],
    lastRound: null,
  };
}

function saveState(state) {
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

async function main() {
  const state = loadState();

  const [roundInfo, balance, pendingDivs] = await Promise.all([
    client.readContract({ address: CLAWFOMO, abi: FOMO_ABI, functionName: 'getRoundInfo' }),
    client.readContract({ address: CLAWD, abi: ERC20_ABI, functionName: 'balanceOf', args: [MY_WALLET] }),
    client.readContract({ address: CLAWFOMO, abi: FOMO_ABI, functionName: 'pendingDividends', args: [MY_WALLET] }).catch(() => 0n),
  ]);

  const [round, pot, endTime, lastBuyer, keysSold, currentPrice, isActive] = roundInfo;
  const now = BigInt(Math.floor(Date.now() / 1000));
  const timeLeft = endTime > now ? Number(endTime - now) : 0;
  const balNum = parseFloat(formatUnits(balance, 18));
  const divNum = parseFloat(formatUnits(pendingDivs || 0n, 18));
  const isLeader = lastBuyer.toLowerCase() === MY_WALLET.toLowerCase();

  // Initialize start balance on first run
  if (!state.startBalance) {
    state.startBalance = balNum;
    state.startTime = new Date().toISOString();
  }

  // Track round transitions
  const currentRound = Number(round);
  if (state.lastRound && currentRound !== state.lastRound) {
    // Round changed — record it
    state.roundResults.push({
      round: state.lastRound,
      balanceAfter: balNum,
      time: new Date().toISOString(),
    });
  }
  state.lastRound = currentRound;

  // Record this check
  const check = {
    time: new Date().toISOString(),
    round: currentRound,
    balance: balNum,
    pendingDivs: divNum,
    pot: parseFloat(formatUnits(pot, 18)),
    isLeader,
    timeLeft,
    keysSold: Number(keysSold),
  };
  state.checks.push(check);

  // Keep last 100 checks
  if (state.checks.length > 100) {
    state.checks = state.checks.slice(-100);
  }

  saveState(state);

  // Calculate P&L
  const totalValue = balNum + divNum;
  const pnl = totalValue - state.startBalance;
  const pnlPct = ((pnl / state.startBalance) * 100).toFixed(2);
  const hoursRunning = ((Date.now() - new Date(state.startTime).getTime()) / 3600000).toFixed(1);

  // Build summary
  const lines = [];
  lines.push(`🦞 ClawFomo P&L Check`);
  lines.push(`R#${currentRound} | ${isActive ? (timeLeft > 0 ? `${timeLeft}s left` : 'ENDED') : 'inactive'}`);
  lines.push(`Pot: ${formatUnits(pot, 18)} CLAWD | Keys: ${keysSold}`);
  lines.push(`Leader: ${isLeader ? '✅ US' : lastBuyer.slice(0, 10) + '...'}`);
  lines.push(`Balance: ${balNum.toFixed(0)} CLAWD`);
  lines.push(`Pending Divs: ${divNum.toFixed(0)} CLAWD`);
  lines.push(`Total Value: ${totalValue.toFixed(0)} CLAWD`);
  lines.push(`P&L: ${pnl >= 0 ? '+' : ''}${pnl.toFixed(0)} CLAWD (${pnlPct}%)`);
  lines.push(`Running: ${hoursRunning}h since ${state.startTime.split('T')[0]}`);

  // Alerts
  const alerts = [];
  if (pnl < -200000) alerts.push('🚨 HEAVY LOSSES — consider pausing bot');
  if (pnl < -100000) alerts.push('⚠️ Significant drawdown');
  if (divNum > 50000) alerts.push('💰 Large pending dividends — consider claiming');
  if (!isActive) alerts.push('⏸️ Game not active');

  // Check if bot process is running
  const botPid = await checkBotRunning();
  if (!botPid) alerts.push('🔴 BOT NOT RUNNING');

  if (alerts.length) {
    lines.push('');
    lines.push('ALERTS:');
    alerts.forEach(a => lines.push(`  ${a}`));
  }

  console.log(lines.join('\n'));
}

async function checkBotRunning() {
  try {
    const { execSync } = await import('child_process');
    const result = execSync('pgrep -f "play.mjs"', { encoding: 'utf-8' }).trim();
    return result || null;
  } catch {
    return null;
  }
}

main().catch(e => {
  console.error('ClawFomo P&L check failed:', e.message);
  process.exit(1);
});
