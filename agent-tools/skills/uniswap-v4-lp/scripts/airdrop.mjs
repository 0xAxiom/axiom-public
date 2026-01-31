#!/usr/bin/env node
/**
 * Airdrop — Batch ERC-20 token distribution via disperse.app
 *
 * Uses the Disperse contract to send tokens to many wallets in batched txs.
 * Contract: 0xD152f549545093347A162Dce210e7293f1452150 (same address on all chains)
 *
 * Usage:
 *   # Dry run — split entire balance equally among CSV wallets
 *   node airdrop.mjs --csv ./wallets.csv --dry-run
 *
 *   # Airdrop 100 tokens per wallet
 *   node airdrop.mjs --csv ./wallets.csv --amount-per-wallet 100 --dry-run
 *
 *   # Airdrop with custom token and batch size
 *   node airdrop.mjs --csv ./wallets.csv --amount-per-wallet 50 --token 0xABC... --batch-size 25
 *
 *   # Execute for real (will prompt for confirmation)
 *   node airdrop.mjs --csv ./wallets.csv --amount-per-wallet 100
 */

import { createPublicClient, createWalletClient, http, formatUnits, parseUnits, maxUint256, getAddress } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base } from 'viem/chains';
import * as dotenv from 'dotenv';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import { createInterface } from 'readline';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

// ─── Config ──────────────────────────────────────────────────────────────────

dotenv.config({ path: resolve(process.env.HOME, '.axiom/wallet.env') });

const DISPERSE_ADDRESS = '0xD152f549545093347A162Dce210e7293f1452150';
const DEFAULT_TOKEN = '0xf3Ce5dDAAb6C133F9875a4a46C55cf0b58111B07'; // AXIOM
const DEFAULT_CSV = resolve(process.env.HOME, 'clawd/bankr-top100-wallets.csv');
const BASE_RPC = 'https://mainnet.base.org';

// ─── ABIs ────────────────────────────────────────────────────────────────────

const ERC20_ABI = [
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'decimals',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint8' }],
  },
  {
    name: 'symbol',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'string' }],
  },
  {
    name: 'allowance',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'approve',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
];

const DISPERSE_ABI = [
  {
    name: 'disperseToken',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'recipients', type: 'address[]' },
      { name: 'values', type: 'uint256[]' },
    ],
    outputs: [],
  },
];

// ─── CLI Args ────────────────────────────────────────────────────────────────

const argv = yargs(hideBin(process.argv))
  .option('csv', {
    type: 'string',
    default: DEFAULT_CSV,
    description: 'Path to CSV file (rank,username,wallet_address)',
  })
  .option('token', {
    type: 'string',
    default: DEFAULT_TOKEN,
    description: 'Token contract address',
  })
  .option('amount-per-wallet', {
    type: 'string',
    description: 'Amount per wallet in human-readable units (e.g. "100"). If omitted, splits entire balance equally.',
  })
  .option('batch-size', {
    type: 'number',
    default: 50,
    description: 'Max wallets per transaction (gas safety)',
  })
  .option('dry-run', {
    type: 'boolean',
    default: false,
    description: 'Simulate without sending transactions',
  })
  .option('rpc', {
    type: 'string',
    default: BASE_RPC,
    description: 'Base RPC URL',
  })
  .help()
  .alias('h', 'help')
  .parseSync();

// ─── Helpers ─────────────────────────────────────────────────────────────────

function log(msg) {
  console.log(`[airdrop] ${msg}`);
}

function warn(msg) {
  console.log(`[airdrop] ⚠️  ${msg}`);
}

function fatal(msg) {
  console.error(`[airdrop] ❌ ${msg}`);
  process.exit(1);
}

function ask(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase());
    });
  });
}

function parseCSV(filePath) {
  const raw = readFileSync(filePath, 'utf-8');
  const lines = raw.trim().split('\n');
  const header = lines[0].toLowerCase();

  if (!header.includes('wallet_address') && !header.includes('address')) {
    fatal(`CSV must have a 'wallet_address' or 'address' column. Got header: ${lines[0]}`);
  }

  const wallets = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map((c) => c.trim());
    if (cols.length < 3) continue;

    const addr = cols[2]; // wallet_address is 3rd column
    try {
      const checksummed = getAddress(addr);
      wallets.push({
        rank: cols[0],
        username: cols[1],
        address: checksummed,
      });
    } catch (e) {
      warn(`Row ${i + 1}: Invalid address "${addr}" (${cols[1]}) — skipping`);
    }
  }

  return wallets;
}

function chunk(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  // Validate private key
  const pk = process.env.NET_PRIVATE_KEY;
  if (!pk) fatal('NET_PRIVATE_KEY not found in ~/.axiom/wallet.env');

  const account = privateKeyToAccount(pk.startsWith('0x') ? pk : `0x${pk}`);
  log(`Wallet: ${account.address}`);

  // Create clients
  const publicClient = createPublicClient({
    chain: base,
    transport: http(argv.rpc),
  });

  const walletClient = createWalletClient({
    account,
    chain: base,
    transport: http(argv.rpc),
  });

  // Verify Disperse contract exists
  const disperseCode = await publicClient.getCode({ address: DISPERSE_ADDRESS });
  if (!disperseCode || disperseCode === '0x') {
    fatal(`Disperse contract not found at ${DISPERSE_ADDRESS} on Base. Aborting.`);
  }
  log(`✅ Disperse contract verified at ${DISPERSE_ADDRESS}`);

  // Token info
  const tokenAddress = getAddress(argv.token);
  const [decimals, symbol, balance] = await Promise.all([
    publicClient.readContract({ address: tokenAddress, abi: ERC20_ABI, functionName: 'decimals' }),
    publicClient.readContract({ address: tokenAddress, abi: ERC20_ABI, functionName: 'symbol' }),
    publicClient.readContract({ address: tokenAddress, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address] }),
  ]);

  log(`Token: ${symbol} (${tokenAddress})`);
  log(`Decimals: ${decimals}`);
  log(`Your balance: ${formatUnits(balance, decimals)} ${symbol}`);

  // Parse recipients
  log(`Loading CSV: ${argv.csv}`);
  const wallets = parseCSV(argv.csv);
  if (wallets.length === 0) fatal('No valid wallets found in CSV');
  log(`Found ${wallets.length} valid recipient wallets`);

  // Check for duplicate addresses
  const uniqueAddrs = new Set(wallets.map((w) => w.address));
  if (uniqueAddrs.size !== wallets.length) {
    warn(`${wallets.length - uniqueAddrs.size} duplicate addresses detected — they will each receive tokens`);
  }

  // Calculate amounts
  let amountPerWallet;
  if (argv.amountPerWallet) {
    amountPerWallet = parseUnits(argv.amountPerWallet, decimals);
    log(`Amount per wallet: ${argv.amountPerWallet} ${symbol}`);
  } else {
    // Split entire balance equally
    amountPerWallet = balance / BigInt(wallets.length);
    log(`Splitting entire balance equally: ${formatUnits(amountPerWallet, decimals)} ${symbol} per wallet`);
  }

  if (amountPerWallet === 0n) fatal('Amount per wallet is 0. Nothing to send.');

  const totalNeeded = amountPerWallet * BigInt(wallets.length);
  log(`Total to distribute: ${formatUnits(totalNeeded, decimals)} ${symbol}`);

  if (totalNeeded > balance) {
    fatal(
      `Insufficient balance! Need ${formatUnits(totalNeeded, decimals)} but only have ${formatUnits(balance, decimals)} ${symbol}`
    );
  }

  // ETH balance for gas
  const ethBalance = await publicClient.getBalance({ address: account.address });
  log(`ETH balance (for gas): ${formatUnits(ethBalance, 18)} ETH`);
  if (ethBalance < parseUnits('0.001', 18)) {
    warn('Very low ETH balance — transactions may fail due to gas');
  }

  // Batch plan
  const batches = chunk(wallets, argv.batchSize);
  log(`\nBatch plan: ${batches.length} transactions of up to ${argv.batchSize} wallets each`);
  for (let i = 0; i < batches.length; i++) {
    const batchTotal = amountPerWallet * BigInt(batches[i].length);
    log(`  Batch ${i + 1}: ${batches[i].length} wallets → ${formatUnits(batchTotal, decimals)} ${symbol}`);
  }

  // ─── Summary ───────────────────────────────────────────────────────────────
  console.log('\n' + '═'.repeat(60));
  console.log('  AIRDROP SUMMARY');
  console.log('═'.repeat(60));
  console.log(`  Token:            ${symbol} (${tokenAddress})`);
  console.log(`  Recipients:       ${wallets.length} wallets`);
  console.log(`  Per wallet:       ${formatUnits(amountPerWallet, decimals)} ${symbol}`);
  console.log(`  Total:            ${formatUnits(totalNeeded, decimals)} ${symbol}`);
  console.log(`  Batches:          ${batches.length} txs (max ${argv.batchSize}/batch)`);
  console.log(`  Disperse:         ${DISPERSE_ADDRESS}`);
  console.log(`  Mode:             ${argv.dryRun ? '🧪 DRY RUN (no real txs)' : '🔴 LIVE'}`);
  console.log('═'.repeat(60) + '\n');

  // ─── Dry Run ───────────────────────────────────────────────────────────────
  if (argv.dryRun) {
    log('🧪 DRY RUN — simulating transactions...\n');

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      const recipients = batch.map((w) => w.address);
      const values = batch.map(() => amountPerWallet);

      try {
        await publicClient.simulateContract({
          account: account.address,
          address: DISPERSE_ADDRESS,
          abi: DISPERSE_ABI,
          functionName: 'disperseToken',
          args: [tokenAddress, recipients, values],
        });
        log(`  ✅ Batch ${i + 1}/${batches.length}: simulation passed (${batch.length} wallets)`);
      } catch (err) {
        // Simulation may fail due to allowance — that's expected in dry run
        if (err.message?.includes('allowance') || err.message?.includes('insufficient') || err.message?.includes('ERC20')) {
          log(`  ⚠️  Batch ${i + 1}/${batches.length}: simulation reverted (likely needs approval) — expected in dry run`);
        } else {
          warn(`  Batch ${i + 1}/${batches.length}: simulation failed — ${err.shortMessage || err.message}`);
        }
      }
    }

    console.log('\n' + '─'.repeat(60));
    log('🧪 Dry run complete. No tokens were sent.');
    log(`To execute for real, remove the --dry-run flag.`);
    return;
  }

  // ─── Live Execution ────────────────────────────────────────────────────────
  const confirm = await ask('⚠️  This will send REAL tokens. Type "yes" to confirm: ');
  if (confirm !== 'yes') {
    log('Aborted by user.');
    return;
  }

  // Step 1: Check & set approval
  log('\nStep 1: Checking token approval...');
  const currentAllowance = await publicClient.readContract({
    address: tokenAddress,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: [account.address, DISPERSE_ADDRESS],
  });

  if (currentAllowance < totalNeeded) {
    log(`Current allowance: ${formatUnits(currentAllowance, decimals)} — need ${formatUnits(totalNeeded, decimals)}`);
    log('Approving Disperse contract for max uint256...');

    const approveHash = await walletClient.writeContract({
      address: tokenAddress,
      abi: ERC20_ABI,
      functionName: 'approve',
      args: [DISPERSE_ADDRESS, maxUint256],
    });

    log(`Approval tx: ${approveHash}`);
    log('Waiting for confirmation...');
    const approveReceipt = await publicClient.waitForTransactionReceipt({ hash: approveHash });

    if (approveReceipt.status !== 'success') {
      fatal('Approval transaction failed!');
    }
    log(`✅ Approval confirmed (block ${approveReceipt.blockNumber})`);
  } else {
    log('✅ Sufficient allowance already set');
  }

  // Step 2: Send batches
  log('\nStep 2: Sending airdrop batches...\n');
  const results = [];
  let totalGasUsed = 0n;

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    const recipients = batch.map((w) => w.address);
    const values = batch.map(() => amountPerWallet);
    const batchTotal = amountPerWallet * BigInt(batch.length);

    log(`Batch ${i + 1}/${batches.length}: ${batch.length} wallets — ${formatUnits(batchTotal, decimals)} ${symbol}`);

    try {
      // Execute directly (simulation can timeout on public RPCs with large batches)
      const txHash = await walletClient.writeContract({
        address: DISPERSE_ADDRESS,
        abi: DISPERSE_ABI,
        functionName: 'disperseToken',
        args: [tokenAddress, recipients, values],
      });
      log(`  📤 Tx sent: ${txHash}`);

      // Wait for receipt
      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

      if (receipt.status !== 'success') {
        warn(`  ❌ Batch ${i + 1} REVERTED! Hash: ${txHash}`);
        results.push({ batch: i + 1, status: 'reverted', hash: txHash, gasUsed: receipt.gasUsed });
      } else {
        log(`  ✅ Confirmed in block ${receipt.blockNumber} (gas: ${receipt.gasUsed})`);
        results.push({ batch: i + 1, status: 'success', hash: txHash, gasUsed: receipt.gasUsed });
      }

      totalGasUsed += receipt.gasUsed;

      // Small delay between batches to avoid nonce issues
      if (i < batches.length - 1) {
        log('  ⏳ Waiting 2s before next batch...');
        await new Promise((r) => setTimeout(r, 2000));
      }
    } catch (err) {
      warn(`  ❌ Batch ${i + 1} FAILED: ${err.shortMessage || err.message}`);
      results.push({ batch: i + 1, status: 'failed', error: err.shortMessage || err.message });

      const retry = await ask(`  Batch ${i + 1} failed. Continue with remaining batches? (yes/no): `);
      if (retry !== 'yes') {
        log('Aborting remaining batches.');
        break;
      }
    }
  }

  // ─── Final Summary ─────────────────────────────────────────────────────────
  const successful = results.filter((r) => r.status === 'success');
  const failed = results.filter((r) => r.status !== 'success');
  const walletsCompleted = successful.reduce((sum, r) => {
    const batchIdx = r.batch - 1;
    return sum + batches[batchIdx].length;
  }, 0);
  const tokensCompleted = amountPerWallet * BigInt(walletsCompleted);

  console.log('\n' + '═'.repeat(60));
  console.log('  AIRDROP COMPLETE');
  console.log('═'.repeat(60));
  console.log(`  Successful batches: ${successful.length}/${results.length}`);
  console.log(`  Failed batches:     ${failed.length}`);
  console.log(`  Wallets airdropped: ${walletsCompleted}/${wallets.length}`);
  console.log(`  Tokens sent:        ${formatUnits(tokensCompleted, decimals)} ${symbol}`);
  console.log(`  Total gas used:     ${totalGasUsed.toString()}`);
  console.log('');
  console.log('  Transaction hashes:');
  for (const r of results) {
    const icon = r.status === 'success' ? '✅' : '❌';
    const detail = r.hash ? `https://basescan.org/tx/${r.hash}` : r.error;
    console.log(`    ${icon} Batch ${r.batch}: ${detail}`);
  }
  console.log('═'.repeat(60));

  if (failed.length > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  fatal(err.message);
});
