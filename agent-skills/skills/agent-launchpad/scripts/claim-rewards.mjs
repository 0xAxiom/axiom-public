#!/usr/bin/env node
/**
 * claim-rewards.mjs — Claim Clanker V4 LP rewards using the official SDK
 * 
 * Usage:
 *   node claim-rewards.mjs --token 0x... [--check-only]
 */

import { Clanker } from 'clanker-sdk/v4';
import { createPublicClient, createWalletClient, http, formatEther } from 'viem';
import { base } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

// Parse args
const args = process.argv.slice(2);
const tokenIdx = args.indexOf('--token');
const tokenAddress = tokenIdx !== -1 ? args[tokenIdx + 1] : null;
const checkOnly = args.includes('--check-only');

if (!tokenAddress) {
  console.log('Usage: node claim-rewards.mjs --token 0x... [--check-only]');
  process.exit(1);
}

// Load private key
const envFile = readFileSync(join(homedir(), '.axiom', 'wallet.env'), 'utf-8');
const keyMatch = envFile.match(/NET_PRIVATE_KEY=["']?([^\s"']+)["']?/);
let privateKey = keyMatch[1];
if (!privateKey.startsWith('0x')) privateKey = `0x${privateKey}`;

const account = privateKeyToAccount(privateKey);
const publicClient = createPublicClient({ chain: base, transport: http() });
const walletClient = createWalletClient({ account, chain: base, transport: http() });

const clanker = new Clanker({ publicClient, wallet: walletClient });

console.log(`🔮 Clanker Reward Claimer`);
console.log(`   Token: ${tokenAddress}`);
console.log(`   Wallet: ${account.address}\n`);

// Check available rewards
try {
  const rewards = await clanker.availableRewards({
    tokenAddress,
    recipient: account.address,
  });
  
  console.log('💰 Available Rewards:');
  console.log(`   ${JSON.stringify(rewards, (k, v) => typeof v === 'bigint' ? formatEther(v) + ' ETH' : v, 2)}`);
  
  if (checkOnly) {
    console.log('\n(check-only mode, not claiming)');
    process.exit(0);
  }

  // Claim
  console.log('\n🚀 Claiming rewards...');
  const result = await clanker.claimRewards({
    tokenAddress,
    recipient: account.address,
  });
  
  console.log(`✅ Claimed! Tx: ${result.transactionHash || JSON.stringify(result)}`);
} catch (error) {
  console.log(`❌ Error: ${error.message}`);
}
