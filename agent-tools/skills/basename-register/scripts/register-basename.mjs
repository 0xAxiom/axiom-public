#!/usr/bin/env node
/**
 * Basename Registration Script
 * Registers .base.eth names for AI agent wallets
 * 
 * Usage:
 *   node register-basename.mjs --check myname       # Check availability
 *   node register-basename.mjs myname               # Register for 1 year
 *   node register-basename.mjs myname --years 2     # Register for 2 years
 *   node register-basename.mjs --set-primary myname # Set as primary name
 * 
 * Environment:
 *   NET_PRIVATE_KEY - Your wallet private key (0x prefixed)
 */

import { createWalletClient, createPublicClient, http, parseEther } from 'viem';
import { base } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';

// Contract addresses on Base Mainnet
// NOTE: Use the Upgradeable Registrar Controller with the Upgradeable L2 Resolver!
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
    name: 'setReverseRecord',
    type: 'function',
    inputs: [
      { name: 'name', type: 'string' },
      { name: 'signatureExpiry', type: 'uint256' },
      { name: 'coinTypes', type: 'uint256[]' },
      { name: 'signature', type: 'bytes' }
    ],
    outputs: [],
    stateMutability: 'nonpayable'
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
    console.log('       register-basename.mjs --set-primary <name>');
    console.log('');
    console.log('Examples:');
    console.log('  register-basename.mjs --check myname      Check availability');
    console.log('  register-basename.mjs myname              Register for 1 year');
    console.log('  register-basename.mjs myname --years 2    Register for 2 years');
    console.log('  register-basename.mjs --set-primary myname Set as primary name');
    process.exit(1);
  }

  const checkOnly = args.includes('--check');
  const setPrimary = args.includes('--set-primary');
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

  // Handle --set-primary mode
  if (setPrimary) {
    const privateKey = process.env.NET_PRIVATE_KEY;
    if (!privateKey) {
      console.error('❌ NET_PRIVATE_KEY environment variable required');
      process.exit(1);
    }

    const account = privateKeyToAccount(privateKey);
    console.log(`Setting ${name}.base.eth as primary name for ${account.address}...`);

    const walletClient = createWalletClient({
      account,
      chain: base,
      transport: http('https://mainnet.base.org')
    });

    try {
      const hash = await walletClient.writeContract({
        address: REGISTRAR,
        abi: ABI,
        functionName: 'setReverseRecord',
        args: [name, 0n, [], '0x']
      });

      console.log(`\nTransaction: ${hash}`);
      console.log('Waiting for confirmation...');

      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      
      if (receipt.status === 'reverted') {
        console.error('\n❌ Transaction reverted!');
        console.log('Check: https://basescan.org/tx/' + hash);
        process.exit(1);
      }

      console.log(`\n✅ Primary name set! Block: ${receipt.blockNumber}`);
      console.log(`\nYour address now resolves to: ${name}.base.eth`);
      console.log(`Verify: https://basescan.org/address/${account.address}`);
    } catch (error) {
      console.error('\n❌ Failed:', error.shortMessage || error.message);
      process.exit(1);
    }
    return;
  }

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
        reverseRecord: true,
        coinTypes: [],
        signatureExpiry: 0n,
        signature: '0x'
      }],
      value: paymentAmount,
      gas: 500000n
    });

    console.log(`\nTransaction: ${hash}`);
    console.log('Waiting for confirmation...');

    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    
    if (receipt.status === 'reverted') {
      console.error('\n❌ Transaction reverted on-chain!');
      console.log(`Block: ${receipt.blockNumber}`);
      console.log(`Gas used: ${receipt.gasUsed}`);
      console.log('Check: https://basescan.org/tx/' + hash);
      process.exit(1);
    }
    
    console.log(`\n✅ Registered! Block: ${receipt.blockNumber}`);
    console.log(`\nView: https://www.base.org/name/${name}`);
    console.log(`Profile: https://www.base.org/name/${name}`);
    console.log(`\nYou can now receive ETH at: ${name}.base.eth`);
    
    console.log(`\n💡 To set as your primary name (reverse record), run:`);
    console.log(`   node register-basename.mjs --set-primary ${name}`);
  } catch (error) {
    console.error('\n❌ Registration failed:', error.shortMessage || error.message);
    process.exit(1);
  }
}

main().catch(console.error);
