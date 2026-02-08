#!/usr/bin/env node
/**
 * verify-identity.mjs — Check if an agent has a valid ERC-8004 identity
 *
 * Usage:
 *   node scripts/verify-identity.mjs --agent-id 42
 *   node scripts/verify-identity.mjs --address 0xYourWallet
 */

import { CONFIG, ERC8004_ABI, getPublicClient, getAccount, parseArgs } from './shared.mjs';

async function verifyByAgentId(client, registryAddr, agentId) {
  console.log(`\n🔍 Checking ERC-8004 agent ID: ${agentId}`);
  console.log(`   Registry: ${registryAddr}\n`);

  try {
    const owner = await client.readContract({
      address: registryAddr,
      abi: ERC8004_ABI,
      functionName: 'ownerOf',
      args: [BigInt(agentId)],
    });

    console.log(`✅ Agent #${agentId} exists`);
    console.log(`   Owner: ${owner}`);

    // Try to get token URI for metadata
    try {
      const uri = await client.readContract({
        address: registryAddr,
        abi: ERC8004_ABI,
        functionName: 'tokenURI',
        args: [BigInt(agentId)],
      });
      console.log(`   Token URI: ${uri}`);
    } catch {
      console.log(`   Token URI: (not available)`);
    }

    return { valid: true, owner, agentId };
  } catch (err) {
    console.log(`❌ Agent #${agentId} not found in registry`);
    console.log(`   ${err.shortMessage || err.message}`);
    return { valid: false, agentId };
  }
}

async function verifyByAddress(client, registryAddr, address) {
  console.log(`\n🔍 Checking ERC-8004 identity for address: ${address}`);
  console.log(`   Registry: ${registryAddr}\n`);

  try {
    const balance = await client.readContract({
      address: registryAddr,
      abi: ERC8004_ABI,
      functionName: 'balanceOf',
      args: [address],
    });

    const count = Number(balance);
    if (count === 0) {
      console.log(`❌ No ERC-8004 identity found for ${address}`);
      console.log(`   Register at the agent registry first.`);
      return { valid: false, address };
    }

    console.log(`✅ Found ${count} agent identity${count > 1 ? 'ies' : ''}`);

    const agentIds = [];
    for (let i = 0; i < count; i++) {
      try {
        const tokenId = await client.readContract({
          address: registryAddr,
          abi: ERC8004_ABI,
          functionName: 'tokenOfOwnerByIndex',
          args: [address, BigInt(i)],
        });
        agentIds.push(Number(tokenId));
        console.log(`   Agent #${tokenId}`);
      } catch {
        // tokenOfOwnerByIndex may not be supported
        break;
      }
    }

    return { valid: true, address, count, agentIds };
  } catch (err) {
    console.log(`❌ Error checking address: ${err.shortMessage || err.message}`);
    return { valid: false, address };
  }
}

async function getRegistryInfo(client, registryAddr) {
  console.log(`\n📋 Registry Info`);
  try {
    const [name, symbol, totalSupply] = await Promise.all([
      client.readContract({ address: registryAddr, abi: ERC8004_ABI, functionName: 'name' }).catch(() => '(unknown)'),
      client.readContract({ address: registryAddr, abi: ERC8004_ABI, functionName: 'symbol' }).catch(() => '(unknown)'),
      client.readContract({ address: registryAddr, abi: ERC8004_ABI, functionName: 'totalSupply' }).catch(() => 0n),
    ]);
    console.log(`   Name: ${name}`);
    console.log(`   Symbol: ${symbol}`);
    console.log(`   Total Agents: ${totalSupply}`);
  } catch {
    console.log(`   (Could not fetch registry info)`);
  }
}

async function main() {
  const args = parseArgs();
  const client = getPublicClient();

  const registryAddr = args['registry'] || CONFIG.agentRegistry;
  if (!registryAddr) {
    console.error('❌ No agent registry address configured.');
    console.error('   Set AGENT_REGISTRY env var or pass --registry 0x...');
    console.error('\n   ERC-8004 is a draft standard — no canonical deployment yet.');
    console.error('   For testing, deploy the reference implementation on Base.');
    process.exit(1);
  }

  await getRegistryInfo(client, registryAddr);

  if (args['agent-id']) {
    const result = await verifyByAgentId(client, registryAddr, args['agent-id']);
    process.exit(result.valid ? 0 : 1);
  }

  if (args['address']) {
    const result = await verifyByAddress(client, registryAddr, args['address']);
    process.exit(result.valid ? 0 : 1);
  }

  // Default: check the wallet from NET_PRIVATE_KEY
  try {
    const account = getAccount();
    console.log(`\n(No --agent-id or --address given, checking your wallet)`);
    const result = await verifyByAddress(client, registryAddr, account.address);
    process.exit(result.valid ? 0 : 1);
  } catch {
    console.error('\nUsage:');
    console.error('  node scripts/verify-identity.mjs --agent-id 42');
    console.error('  node scripts/verify-identity.mjs --address 0xYourWallet');
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
