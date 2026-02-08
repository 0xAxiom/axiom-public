#!/usr/bin/env node
/**
 * list-pitches.mjs — View submitted pitches from PitchRegistry
 *
 * Usage:
 *   node scripts/list-pitches.mjs                    # all pitches
 *   node scripts/list-pitches.mjs --agent-id 42      # by agent
 *   node scripts/list-pitches.mjs --pitch-id 7       # specific pitch
 */

import { decodeAbiParameters, parseAbiParameters } from 'viem';
import {
  CONFIG, PITCH_REGISTRY_ABI,
  getPublicClient, formatUSDC, parseArgs, STATUS_LABELS,
} from './shared.mjs';

// ─── Decode Pitch Data ───────────────────────────────────────────────

function decodePitchData(rawBytes) {
  try {
    const [agentId, projectName, description, contracts, revenueUSDC, revenueSource, teamSize, askAmountUSDC, milestonesData] =
      decodeAbiParameters(
        parseAbiParameters('uint256 agentId, string projectName, string description, address[] contracts, uint256 revenueUSDC, address revenueSource, uint8 teamSize, uint256 askAmountUSDC, bytes milestonesData'),
        rawBytes,
      );

    let milestones = [];
    try {
      const [decoded] = decodeAbiParameters(
        parseAbiParameters('(string description, uint256 amount, string deadline)[]'),
        milestonesData,
      );
      milestones = decoded.map(m => ({
        description: m.description,
        amount: formatUSDC(m.amount),
        deadline: m.deadline,
      }));
    } catch {}

    return {
      agentId: Number(agentId),
      projectName,
      description,
      contracts,
      revenueUSDC: formatUSDC(revenueUSDC),
      revenueSource,
      teamSize,
      askAmountUSDC: formatUSDC(askAmountUSDC),
      milestones,
    };
  } catch (err) {
    return { raw: rawBytes.slice(0, 66) + '...', decodeError: err.message };
  }
}

// ─── Display ─────────────────────────────────────────────────────────

function displayPitch(pitch, decoded) {
  const status = STATUS_LABELS[pitch.status] || `Unknown(${pitch.status})`;
  const date = new Date(Number(pitch.submittedAt) * 1000).toISOString().split('T')[0];

  console.log(`\n┌─────────────────────────────────────────`);
  console.log(`│ Pitch #${pitch.pitchId}`);
  console.log(`├─────────────────────────────────────────`);

  if (decoded.projectName) {
    console.log(`│ Project:     ${decoded.projectName}`);
    console.log(`│ Description: ${decoded.description?.slice(0, 80) || '(none)'}${decoded.description?.length > 80 ? '...' : ''}`);
    console.log(`│ Agent ID:    #${decoded.agentId}`);
    console.log(`│ Team Size:   ${decoded.teamSize}`);
    console.log(`│ Ask:         ${decoded.askAmountUSDC} USDC`);
    if (decoded.revenueUSDC && decoded.revenueUSDC !== '0.0') {
      console.log(`│ Revenue:     ${decoded.revenueUSDC} USDC (30d)`);
    }
    if (decoded.contracts?.length > 0) {
      console.log(`│ Contracts:   ${decoded.contracts.join(', ')}`);
    }
    if (decoded.milestones.length > 0) {
      console.log(`│ Milestones:`);
      decoded.milestones.forEach((m, i) => {
        console.log(`│   ${i + 1}. ${m.description} — ${m.amount} USDC by ${m.deadline}`);
      });
    }
  } else {
    console.log(`│ (Could not decode pitch data)`);
  }

  console.log(`│`);
  console.log(`│ Status:    ${status}`);
  console.log(`│ Score:     ${pitch.score > 0 ? `${pitch.score}/100` : '(unscored)'}`);
  if (pitch.ddNotes) console.log(`│ DD Notes:  ${pitch.ddNotes}`);
  console.log(`│ Submitter: ${pitch.submitter}`);
  console.log(`│ Date:      ${date}`);
  console.log(`│ Ask (raw): ${formatUSDC(pitch.askAmountUSDC)} USDC`);
  console.log(`└─────────────────────────────────────────`);
}

// ─── Fetch Pitches ───────────────────────────────────────────────────

async function fetchPitch(client, registryAddr, pitchId) {
  const pitch = await client.readContract({
    address: registryAddr,
    abi: PITCH_REGISTRY_ABI,
    functionName: 'getPitch',
    args: [BigInt(pitchId)],
  });
  return pitch;
}

async function fetchPitchesByAgent(client, registryAddr, agentId) {
  const pitchIds = await client.readContract({
    address: registryAddr,
    abi: PITCH_REGISTRY_ABI,
    functionName: 'getPitchesByAgent',
    args: [BigInt(agentId)],
  });
  return pitchIds;
}

async function fetchPitchCount(client, registryAddr) {
  return await client.readContract({
    address: registryAddr,
    abi: PITCH_REGISTRY_ABI,
    functionName: 'pitchCount',
  });
}

// ─── Main ────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs();
  const client = getPublicClient();
  const registryAddr = args.registry || CONFIG.pitchRegistry;

  if (!registryAddr) {
    console.log('╔══════════════════════════════════════╗');
    console.log('║   Axiom Ventures — Pitch Viewer      ║');
    console.log('╚══════════════════════════════════════╝');
    console.log('\n⚠️  No PitchRegistry deployed yet.');
    console.log('   Set PITCH_REGISTRY env var or pass --registry 0x...');
    console.log('\n   Once deployed, pitches will be queryable on-chain.');
    console.log('   For now, submitted pitches are tracked off-chain by the DD team.');
    process.exit(0);
  }

  console.log('╔══════════════════════════════════════╗');
  console.log('║   Axiom Ventures — Pitch Viewer      ║');
  console.log('╚══════════════════════════════════════╝');
  console.log(`\n📋 Registry: ${registryAddr}`);

  // Single pitch
  if (args['pitch-id']) {
    const pitchId = args['pitch-id'];
    console.log(`\n🔍 Fetching pitch #${pitchId}...`);
    const pitch = await fetchPitch(client, registryAddr, pitchId);
    const decoded = decodePitchData(pitch.pitchData);
    displayPitch(pitch, decoded);
    return;
  }

  // By agent
  if (args['agent-id']) {
    const agentId = args['agent-id'];
    console.log(`\n🔍 Fetching pitches for agent #${agentId}...`);
    const pitchIds = await fetchPitchesByAgent(client, registryAddr, agentId);

    if (pitchIds.length === 0) {
      console.log(`\n   No pitches found for agent #${agentId}`);
      return;
    }

    console.log(`\n   Found ${pitchIds.length} pitch(es)`);
    for (const id of pitchIds) {
      const pitch = await fetchPitch(client, registryAddr, Number(id));
      const decoded = decodePitchData(pitch.pitchData);
      displayPitch(pitch, decoded);
    }
    return;
  }

  // All pitches
  const count = await fetchPitchCount(client, registryAddr);
  console.log(`\n📊 Total pitches: ${count}`);

  const limit = Number(args.limit || 20);
  const start = Math.max(1, Number(count) - limit + 1);

  for (let i = start; i <= Number(count); i++) {
    try {
      const pitch = await fetchPitch(client, registryAddr, i);
      const decoded = decodePitchData(pitch.pitchData);
      displayPitch(pitch, decoded);
    } catch (err) {
      console.log(`\n   ⚠️  Could not fetch pitch #${i}: ${err.shortMessage || err.message}`);
    }
  }
}

main().catch(err => {
  console.error('\n❌ Fatal:', err.shortMessage || err.message);
  process.exit(1);
});
