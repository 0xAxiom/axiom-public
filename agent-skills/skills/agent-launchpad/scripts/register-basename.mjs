#!/usr/bin/env node
/**
 * Basename Registration Script for Agent Launchpad
 * Registers .base.eth names for CDP EOA accounts after token launch
 * 
 * Usage:
 *   node register-basename.mjs --name myname                    # Use CDP credentials
 *   node register-basename.mjs --name myname --key 0x123...    # Use explicit private key
 *   node register-basename.mjs --name myname --check           # Check availability only
 * 
 * Environment (if not using --key):
 *   CDP_API_KEY_NAME - CDP API key name
 *   CDP_PRIVATE_KEY - CDP wallet private key
 */

import { createWalletClient, createPublicClient, http, parseEther } from 'viem';
import { base } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import fs from 'fs';
import path from 'path';

// Contract addresses on Base Mainnet
// Using the Upgradeable Registrar Controller with the Upgradeable L2 Resolver
const REGISTRAR = '0xa7d2607c6BD39Ae9521e514026CBB078405Ab322';
const RESOLVER = '0x426fA03fB86E510d0Dd9F70335Cf102a98b10875'; // Upgradeable L2 Resolver

const ABI = [
  {
    name: 'register',
    type: 'function',
    inputs: [{
      name: 'request',
      type: 'tuple',
      components: [
        { name: 'name', type: 'string' },
        { name: 'owner', type: 'address' },
        { name: 'duration', type: 'uint256' },
        { name: 'resolver', type: 'address' },
        { name: 'data', type: 'bytes[]' },
        { name: 'reverseRecord', type: 'bool' },
        { name: 'coinTypes', type: 'uint256[]' },
        { name: 'signatureExpiry', type: 'uint256' },
        { name: 'signature', type: 'bytes' }
      ]
    }],
    outputs: [],
    stateMutability: 'payable'
  },
  {
    name: 'registerPrice',
    type: 'function',
    inputs: [
      { name: 'name', type: 'string' },
      { name: 'duration', type: 'uint256' }
    ],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view'
  },
  {
    name: 'available',
    type: 'function',
    inputs: [{ name: 'name', type: 'string' }],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'view'
  },
  {
    name: 'valid',
    type: 'function',
    inputs: [{ name: 'name', type: 'string' }],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'pure'
  }
];

const SECONDS_PER_YEAR = 31536000n;

function parseArguments() {
  const args = process.argv.slice(2);
  const result = { checkOnly: false };
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case '--name':
        result.name = args[i + 1];
        i++;
        break;
      case '--key':
        result.privateKey = args[i + 1];
        i++;
        break;
      case '--check':
        result.checkOnly = true;
        break;
    }
  }
  
  return result;
}

function getPrivateKey(explicitKey) {
  if (explicitKey) {
    // Ensure 0x prefix
    return explicitKey.startsWith('0x') ? explicitKey : `0x${explicitKey}`;
  }
  
  // Try CDP credentials from environment
  if (process.env.CDP_PRIVATE_KEY) {
    return process.env.CDP_PRIVATE_KEY;
  }
  
  // Try to read from common agent credential files
  const credentialPaths = [
    '~/.cdp/credentials.json',
    './cdp_credentials.json'
  ];
  
  for (const credPath of credentialPaths) {
    try {
      const expandedPath = credPath.replace('~', process.env.HOME);
      if (fs.existsSync(expandedPath)) {
        const creds = JSON.parse(fs.readFileSync(expandedPath, 'utf8'));
        if (creds.privateKey) {
          console.log(`📁 Using private key from: ${credPath}`);
          return creds.privateKey.startsWith('0x') ? creds.privateKey : `0x${creds.privateKey}`;
        }
      }
    } catch (error) {
      // Continue to next path
    }
  }
  
  return null;
}

function showUsage() {
  console.log('Usage: register-basename.mjs --name <basename> [options]');
  console.log('');
  console.log('Options:');
  console.log('  --name <name>      The basename to register (without .base.eth)');
  console.log('  --key <private>    Private key (0x prefixed). If omitted, uses CDP credentials');
  console.log('  --check           Check availability only, do not register');
  console.log('');
  console.log('Examples:');
  console.log('  register-basename.mjs --name mybot --check');
  console.log('  register-basename.mjs --name mybot');
  console.log('  register-basename.mjs --name mybot --key 0x1234...');
  console.log('');
  console.log('Credentials (if --key not provided):');
  console.log('  Environment: CDP_PRIVATE_KEY');
  console.log('  File: ~/.cdp/credentials.json or ./cdp_credentials.json');
}

async function main() {
  const { name, privateKey: explicitKey, checkOnly } = parseArguments();
  
  if (!name) {
    console.error('❌ Error: --name parameter is required');
    console.log('');
    showUsage();
    process.exit(1);
  }
  
  console.log(`🔍 Checking basename: ${name}.base.eth`);
  
  const publicClient = createPublicClient({
    chain: base,
    transport: http('https://mainnet.base.org')
  });
  
  // Validate name format
  try {
    const isValid = await publicClient.readContract({
      address: REGISTRAR,
      abi: ABI,
      functionName: 'valid',
      args: [name]
    });
    
    if (!isValid) {
      console.error(`❌ "${name}" is not a valid basename`);
      console.error('   Requirements: min 3 characters, alphanumeric only');
      process.exit(1);
    }
  } catch (error) {
    console.error('❌ Failed to validate name:', error.message);
    process.exit(1);
  }
  
  // Check availability
  try {
    const isAvailable = await publicClient.readContract({
      address: REGISTRAR,
      abi: ABI,
      functionName: 'available',
      args: [name]
    });
    
    console.log(`Available: ${isAvailable ? '✅ Yes' : '❌ No (already registered)'}`);
    
    if (!isAvailable) {
      console.error(`\n"${name}.base.eth" is already registered.`);
      process.exit(1);
    }
  } catch (error) {
    console.error('❌ Failed to check availability:', error.message);
    process.exit(1);
  }
  
  // Get registration price for 1 year
  const duration = SECONDS_PER_YEAR;
  let price;
  try {
    price = await publicClient.readContract({
      address: REGISTRAR,
      abi: ABI,
      functionName: 'registerPrice',
      args: [name, duration]
    });
    
    console.log(`Duration: 1 year`);
    console.log(`Price: ${(Number(price) / 1e18).toFixed(6)} ETH`);
  } catch (error) {
    console.error('❌ Failed to get price:', error.message);
    process.exit(1);
  }
  
  // If check only, exit here
  if (checkOnly) {
    console.log('\n✅ Name is available! Remove --check to register.');
    process.exit(0);
  }
  
  // Get private key for registration
  const privateKey = getPrivateKey(explicitKey);
  
  if (!privateKey) {
    console.error('\n❌ No private key found');
    console.error('   Provide --key parameter or set CDP_PRIVATE_KEY environment variable');
    console.error('   Or ensure CDP credentials are in ~/.cdp/credentials.json');
    process.exit(1);
  }
  
  let account;
  try {
    account = privateKeyToAccount(privateKey);
  } catch (error) {
    console.error('❌ Invalid private key format');
    process.exit(1);
  }
  
  console.log(`\n💰 Wallet: ${account.address}`);
  
  // Check balance
  const balance = await publicClient.getBalance({ address: account.address });
  console.log(`Balance: ${(Number(balance) / 1e18).toFixed(6)} ETH`);
  
  // Calculate payment with 10% buffer for price fluctuations
  const paymentAmount = price * 110n / 100n;
  console.log(`Required: ${(Number(paymentAmount) / 1e18).toFixed(6)} ETH (with 10% buffer)`);
  
  if (balance < paymentAmount) {
    console.error(`❌ Insufficient balance`);
    console.error(`   Need: ${(Number(paymentAmount) / 1e18).toFixed(6)} ETH`);
    console.error(`   Have: ${(Number(balance) / 1e18).toFixed(6)} ETH`);
    console.error('   Agent needs ETH for gas + registration fee (~0.001 ETH for 5+ letter names)');
    process.exit(1);
  }
  
  // Create wallet client for registration
  const walletClient = createWalletClient({
    account,
    chain: base,
    transport: http('https://mainnet.base.org')
  });
  
  console.log(`\n🚀 Registering ${name}.base.eth...`);
  
  try {
    const hash = await walletClient.writeContract({
      address: REGISTRAR,
      abi: ABI,
      functionName: 'register',
      args: [{
        name,
        owner: account.address,
        duration,
        resolver: RESOLVER,
        data: [],
        reverseRecord: true,  // Set as primary name
        coinTypes: [],        // Empty for no-discount registration
        signatureExpiry: 0n,  // Zero for no-discount registration
        signature: '0x'       // Empty for no-discount registration
      }],
      value: paymentAmount,
      gas: 500000n
    });
    
    console.log(`📝 Transaction: ${hash}`);
    console.log('⏳ Waiting for confirmation...');
    
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    
    if (receipt.status === 'reverted') {
      console.error('\n❌ Transaction reverted on-chain!');
      console.error(`   Check: https://basescan.org/tx/${hash}`);
      process.exit(1);
    }
    
    console.log(`\n✅ Successfully registered: ${name}.base.eth`);
    console.log(`📜 Transaction: ${hash}`);
    console.log(`🧱 Block: ${receipt.blockNumber}`);
    console.log(`⛽ Gas used: ${receipt.gasUsed}`);
    
    console.log(`\n🎯 Your agent now has:`)
    console.log(`   • Basename: ${name}.base.eth`);
    console.log(`   • Address: ${account.address}`);
    console.log(`   • Primary name: ✅ Set (reverse record enabled)`);
    
    console.log(`\n🔗 Links:`);
    console.log(`   Profile: https://www.base.org/name/${name}`);
    console.log(`   Transaction: https://basescan.org/tx/${hash}`);
    
    console.log(`\n🎉 Your agent can now receive ETH at: ${name}.base.eth`);
    
  } catch (error) {
    console.error('\n❌ Registration failed:', error.shortMessage || error.message);
    if (error.cause) {
      console.error('Cause:', error.cause.message);
    }
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('❌ Unexpected error:', error.message);
  process.exit(1);
});