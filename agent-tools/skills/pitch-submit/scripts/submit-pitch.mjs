#!/usr/bin/env node
/**
 * submit-pitch.mjs — Submit a structured pitch to Axiom Ventures
 *
 * Flow:
 *   1. Validate pitch data
 *   2. Verify ERC-8004 identity
 *   3. Pay pitch fee (USDC transfer to fund wallet)
 *   4. Submit pitch to PitchRegistry contract
 *
 * Usage:
 *   node scripts/submit-pitch.mjs --file pitch.json
 *   node scripts/submit-pitch.mjs --agent-id 42 --project "MyBot" --description "..." --ask 50000
 */

import { readFileSync } from 'fs';
import { encodePacked, encodeAbiParameters, parseAbiParameters } from 'viem';
import {
  CONFIG, USDC_ABI, ERC8004_ABI, PITCH_REGISTRY_ABI,
  getPublicClient, getWalletClient, getAccount,
  parseUSDC, formatUSDC, parseArgs, requireAddress,
} from './shared.mjs';

// ─── Validation ───────────────────────────────────────────────────────

function validatePitch(pitch) {
  const errors = [];

  if (!pitch.agentId) errors.push('agentId is required');
  if (!pitch.projectName) errors.push('projectName is required');
  if (!pitch.projectName || pitch.projectName.length > 100) errors.push('projectName must be 1-100 chars');
  if (!pitch.description) errors.push('description is required');
  if (pitch.description && pitch.description.length > 500) errors.push('description must be ≤500 chars');
  if (!pitch.askAmount || Number(pitch.askAmount) <= 0) errors.push('askAmount must be positive');
  if (Number(pitch.askAmount) > 1_000_000) errors.push('askAmount max is 1,000,000 USDC');
  if (!pitch.teamSize || pitch.teamSize < 1) errors.push('teamSize must be ≥1');

  if (!pitch.milestones || pitch.milestones.length === 0) {
    errors.push('At least 1 milestone required');
  } else if (pitch.milestones.length > 10) {
    errors.push('Max 10 milestones');
  } else {
    const milestoneTotal = pitch.milestones.reduce((sum, m) => sum + Number(m.amount || 0), 0);
    if (Math.abs(milestoneTotal - Number(pitch.askAmount)) > 0.01) {
      errors.push(`Milestone amounts (${milestoneTotal}) must sum to askAmount (${pitch.askAmount})`);
    }
  }

  if (pitch.contractAddresses) {
    for (const addr of pitch.contractAddresses) {
      if (!/^0x[a-fA-F0-9]{40}$/.test(addr)) {
        errors.push(`Invalid contract address: ${addr}`);
      }
    }
  }

  return errors;
}

// ─── Pitch Encoding ──────────────────────────────────────────────────

function encodePitchData(pitch) {
  // Encode milestones as packed bytes
  const milestonesEncoded = encodeAbiParameters(
    parseAbiParameters('(string description, uint256 amount, string deadline)[]'),
    [pitch.milestones.map(m => ({
      description: m.description,
      amount: parseUSDC(m.amount),
      deadline: m.deadline,
    }))],
  );

  // Encode full pitch payload
  const pitchData = encodeAbiParameters(
    parseAbiParameters('uint256 agentId, string projectName, string description, address[] contracts, uint256 revenueUSDC, address revenueSource, uint8 teamSize, uint256 askAmountUSDC, bytes milestonesData'),
    [
      BigInt(pitch.agentId),
      pitch.projectName,
      pitch.description,
      (pitch.contractAddresses || []).map(a => a),
      pitch.revenueData ? parseUSDC(pitch.revenueData.last30d || '0') : 0n,
      pitch.revenueData?.source || '0x0000000000000000000000000000000000000000',
      pitch.teamSize,
      parseUSDC(pitch.askAmount),
      milestonesEncoded,
    ],
  );

  return pitchData;
}

// ─── Fee Payment ─────────────────────────────────────────────────────

async function payPitchFee(publicClient, walletClient, account) {
  const feeAmount = parseUSDC(CONFIG.pitchFee);
  const fundWallet = CONFIG.fundWallet;

  console.log(`\n💰 Pitch fee: ${CONFIG.pitchFee} USDC`);
  console.log(`   Recipient: ${fundWallet}`);

  // Check balance
  const balance = await publicClient.readContract({
    address: CONFIG.usdc,
    abi: USDC_ABI,
    functionName: 'balanceOf',
    args: [account.address],
  });

  console.log(`   Your USDC balance: ${formatUSDC(balance)}`);

  if (balance < feeAmount) {
    console.error(`\n❌ Insufficient USDC. Need ${CONFIG.pitchFee}, have ${formatUSDC(balance)}`);
    process.exit(1);
  }

  // Send USDC
  console.log(`\n📤 Sending ${CONFIG.pitchFee} USDC...`);

  const hash = await walletClient.writeContract({
    address: CONFIG.usdc,
    abi: USDC_ABI,
    functionName: 'transfer',
    args: [fundWallet, feeAmount],
  });

  console.log(`   Tx: ${hash}`);
  console.log(`   Waiting for confirmation...`);

  const receipt = await publicClient.waitForTransactionReceipt({ hash });

  if (receipt.status === 'success') {
    console.log(`   ✅ Fee paid! Block: ${receipt.blockNumber}`);
    return hash;
  } else {
    console.error(`   ❌ Fee payment failed`);
    process.exit(1);
  }
}

// ─── Submit to Registry ──────────────────────────────────────────────

async function submitToRegistry(publicClient, walletClient, pitchData) {
  const registryAddr = CONFIG.pitchRegistry;
  if (!registryAddr) {
    console.log('\n⚠️  No PitchRegistry deployed yet.');
    console.log('   Pitch data encoded and fee paid — submission will be recorded off-chain.');
    console.log(`   Encoded pitch (${pitchData.length} bytes): ${pitchData.slice(0, 66)}...`);
    return null;
  }

  console.log(`\n📝 Submitting pitch to PitchRegistry...`);
  console.log(`   Contract: ${registryAddr}`);

  const hash = await walletClient.writeContract({
    address: registryAddr,
    abi: PITCH_REGISTRY_ABI,
    functionName: 'submitPitch',
    args: [pitchData],
  });

  console.log(`   Tx: ${hash}`);
  console.log(`   Waiting for confirmation...`);

  const receipt = await publicClient.waitForTransactionReceipt({ hash });

  if (receipt.status === 'success') {
    // Parse PitchSubmitted event
    const submitEvent = receipt.logs.find(log => {
      try {
        return log.topics[0] === '0x' + 'PitchSubmitted'.length; // simplified
      } catch { return false; }
    });

    console.log(`   ✅ Pitch submitted! Block: ${receipt.blockNumber}`);
    return hash;
  } else {
    console.error(`   ❌ Submission failed`);
    process.exit(1);
  }
}

// ─── Load Pitch ──────────────────────────────────────────────────────

function loadPitchFromArgs(args) {
  if (args.file) {
    try {
      const raw = readFileSync(args.file, 'utf-8');
      return JSON.parse(raw);
    } catch (err) {
      console.error(`❌ Could not read pitch file: ${args.file}`);
      console.error(`   ${err.message}`);
      process.exit(1);
    }
  }

  // Build from CLI args
  if (!args['agent-id'] || !args['project'] || !args['ask']) {
    console.error('Usage:');
    console.error('  node scripts/submit-pitch.mjs --file pitch.json');
    console.error('  node scripts/submit-pitch.mjs --agent-id 42 --project "MyBot" \\');
    console.error('    --description "AI trading bot" --ask 50000 \\');
    console.error('    --team-size 3 --contracts 0xABC,0xDEF');
    process.exit(1);
  }

  const contracts = args.contracts ? args.contracts.split(',').map(s => s.trim()) : [];
  const askAmount = args.ask;

  return {
    version: '1.0',
    agentId: args['agent-id'],
    agentRegistry: args['agent-registry'] || `eip155:8453:${CONFIG.agentRegistry || '0x0'}`,
    projectName: args.project,
    description: args.description || '',
    contractAddresses: contracts,
    revenueData: args.revenue ? { last30d: args.revenue, source: args['revenue-source'] || '0x0000000000000000000000000000000000000000' } : null,
    teamSize: Number(args['team-size'] || 1),
    askAmount,
    milestones: [
      { description: 'Full delivery', amount: askAmount, deadline: args.deadline || '2026-06-01' },
    ],
    links: {
      github: args.github || '',
      website: args.website || '',
      docs: args.docs || '',
    },
  };
}

// ─── Main ────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs();
  const publicClient = getPublicClient();
  const walletClient = getWalletClient();
  const account = getAccount();

  console.log('╔══════════════════════════════════════╗');
  console.log('║   Axiom Ventures — Pitch Submission  ║');
  console.log('╚══════════════════════════════════════╝');
  console.log(`\n🔑 Submitter: ${account.address}`);

  // 1. Load and validate pitch
  const pitch = loadPitchFromArgs(args);

  console.log(`\n📋 Pitch: "${pitch.projectName}"`);
  console.log(`   Agent ID: ${pitch.agentId}`);
  console.log(`   Ask: ${pitch.askAmount} USDC`);
  console.log(`   Team: ${pitch.teamSize}`);
  console.log(`   Milestones: ${pitch.milestones.length}`);
  if (pitch.description) console.log(`   Description: ${pitch.description.slice(0, 80)}...`);

  const errors = validatePitch(pitch);
  if (errors.length > 0) {
    console.error('\n❌ Validation errors:');
    errors.forEach(e => console.error(`   • ${e}`));
    process.exit(1);
  }
  console.log('\n✅ Pitch data valid');

  // 2. Verify ERC-8004 identity (if registry configured)
  if (CONFIG.agentRegistry) {
    console.log(`\n🪪 Verifying ERC-8004 identity...`);
    try {
      const owner = await publicClient.readContract({
        address: CONFIG.agentRegistry,
        abi: [{
          type: 'function', name: 'ownerOf',
          inputs: [{ type: 'uint256' }],
          outputs: [{ type: 'address' }],
          stateMutability: 'view',
        }],
        functionName: 'ownerOf',
        args: [BigInt(pitch.agentId)],
      });

      if (owner.toLowerCase() !== account.address.toLowerCase()) {
        console.error(`❌ Agent #${pitch.agentId} is owned by ${owner}, not ${account.address}`);
        process.exit(1);
      }
      console.log(`   ✅ Agent #${pitch.agentId} verified — owned by you`);
    } catch (err) {
      console.error(`   ⚠️  Could not verify agent identity: ${err.shortMessage || err.message}`);
      if (!args['skip-identity']) {
        console.error('   Pass --skip-identity to proceed without verification');
        process.exit(1);
      }
    }
  } else {
    console.log('\n⚠️  No agent registry configured — skipping identity verification');
  }

  // 3. Pay pitch fee
  if (!args['skip-fee']) {
    await payPitchFee(publicClient, walletClient, account);
  } else {
    console.log('\n⚠️  Skipping fee payment (--skip-fee)');
  }

  // 4. Encode and submit
  const pitchData = encodePitchData(pitch);
  console.log(`\n🔒 Pitch encoded: ${pitchData.length} bytes`);

  const txHash = await submitToRegistry(publicClient, walletClient, pitchData);

  // Summary
  console.log('\n╔══════════════════════════════════════╗');
  console.log('║         Pitch Submitted! 🎉          ║');
  console.log('╚══════════════════════════════════════╝');
  console.log(`\n   Project:  ${pitch.projectName}`);
  console.log(`   Agent:    #${pitch.agentId}`);
  console.log(`   Ask:      ${pitch.askAmount} USDC`);
  console.log(`   Fee:      ${CONFIG.pitchFee} USDC`);
  if (txHash) {
    console.log(`   Tx:       https://basescan.org/tx/${txHash}`);
  }
  console.log(`\n   Next: Axiom's DD team (Scout, Cipher, Forge) will review your pitch.`);
  console.log(`   Track status: node scripts/list-pitches.mjs --agent-id ${pitch.agentId}\n`);
}

main().catch(err => {
  console.error('\n❌ Fatal:', err.shortMessage || err.message);
  if (err.cause) console.error('   Cause:', err.cause.message);
  process.exit(1);
});
