#!/usr/bin/env node
/**
 * Basename Registration Script
 * Registers .base.eth names for AI agent wallets
 * 
 * Usage:
 *   node register-basename.mjs --check myname       # Check availability
 *   node register-basename.mjs myname               # Register for 1 year
 *   node register-basename.mjs myname --years 2    # Register for 2 years
 * 
 * Environment:
 *   NET_PRIVATE_KEY - Your wallet private key (0x prefixed)
 */

import { createWalletClient, createPublicClient, http, parseEther } from 'viem';
import { base } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';

// Contract addresses on Base Mainnet
// NOTE: Use the Upgradeable Registrar Controller, not the old one!
const REGISTRAR = '0xa7d2607c6BD39Ae9521e514026CBB078405Ab322';
const RESOLVER = '0xC6d566A56A1aFf6508b41f6c90ff131615583BCD';

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
        { name: 'reverseRecord', type: 'bool' }
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

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log('Usage: register-basename.mjs [--check] <name> [--years N]');
    console.log('');
    console.log('Examples:');
    console.log('  register-basename.mjs --check myname    Check availability');
    console.log('  register-basename.mjs myname            Register for 1 year');
    console.log('  register-basename.mjs myname --years 2  Register for 2 years');
    process.exit(1);
  }

  const checkOnly = args.includes('--check');
  const yearsIndex = args.indexOf('--years');
  const years = yearsIndex !== -1 ? parseInt(args[yearsIndex + 1]) : 1;
  const name = args.find(a => !a.startsWith('--') && a !== String(years));

  if (!name) {
    console.error('Error: Name required');
    process.exit(1);
  }

  const publicClient = createPublicClient({
    chain: base,
    transport: http('https://mainnet.base.org')
  });

  // Check validity
  const isValid = await publicClient.readContract({
    address: REGISTRAR,
    abi: ABI,
    functionName: 'valid',
    args: [name]
  });

  if (!isValid) {
    console.error(`❌ "${name}" is not a valid name (min 3 characters, alphanumeric)`);
    process.exit(1);
  }

  // Check availability
  const isAvailable = await publicClient.readContract({
    address: REGISTRAR,
    abi: ABI,
    functionName: 'available',
    args: [name]
  });

  console.log(`Name: ${name}.base.eth`);
  console.log(`Available: ${isAvailable ? '✅ Yes' : '❌ No (already registered)'}`);

  if (!isAvailable) {
    process.exit(1);
  }

  // Get price
  const duration = SECONDS_PER_YEAR * BigInt(years);
  const price = await publicClient.readContract({
    address: REGISTRAR,
    abi: ABI,
    functionName: 'registerPrice',
    args: [name, duration]
  });

  console.log(`Duration: ${years} year(s)`);
  console.log(`Price: ${(Number(price) / 1e18).toFixed(6)} ETH`);

  if (checkOnly) {
    console.log('\nRun without --check to register.');
    process.exit(0);
  }

  // Registration requires private key
  const privateKey = process.env.NET_PRIVATE_KEY;
  if (!privateKey) {
    console.error('\n❌ NET_PRIVATE_KEY environment variable required for registration');
    process.exit(1);
  }

  const account = privateKeyToAccount(privateKey);
  console.log(`\nWallet: ${account.address}`);

  const balance = await publicClient.getBalance({ address: account.address });
  console.log(`Balance: ${(Number(balance) / 1e18).toFixed(6)} ETH`);

  // Pay 50% more to handle price fluctuations
  const paymentAmount = price * 150n / 100n;
  
  if (balance < paymentAmount) {
    console.error(`❌ Insufficient balance. Need ~${(Number(paymentAmount) / 1e18).toFixed(6)} ETH`);
    process.exit(1);
  }

  const walletClient = createWalletClient({
    account,
    chain: base,
    transport: http('https://mainnet.base.org')
  });

  console.log(`\nRegistering ${name}.base.eth...`);
  console.log(`Paying: ${(Number(paymentAmount) / 1e18).toFixed(6)} ETH`);

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
        reverseRecord: true
      }],
      value: paymentAmount,
      gas: 500000n
    });

    console.log(`\nTransaction: ${hash}`);
    console.log('Waiting for confirmation...');

    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    
    console.log(`\n✅ Registered! Block: ${receipt.blockNumber}`);
    console.log(`\nView: https://www.base.org/name/${name}`);
    console.log(`Profile: https://www.base.org/name/${name}`);
    console.log(`\nYou can now receive ETH at: ${name}.base.eth`);
  } catch (error) {
    console.error('\n❌ Registration failed:', error.shortMessage || error.message);
    process.exit(1);
  }
}

main().catch(console.error);
