#!/usr/bin/env node
import { createPublicClient, createWalletClient, http } from 'viem';
import { base } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import fs from 'fs';

const DISPERSE_ADDRESS = '0xD152f549545093347A162Dce210e7293f1452150';
const AXIOM_TOKEN = '0xf3ce5ddaab6c133f9875a4a46c55cf0b58111b07';
const RPC_URL = 'https://mainnet.base.org';

const DISPERSE_ABI = [
  {
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'recipients', type: 'address[]' },
      { name: 'values', type: 'uint256[]' }
    ],
    name: 'disperseToken',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function'
  }
];

async function main() {
  const privateKey = process.env.NET_PRIVATE_KEY;
  if (!privateKey) {
    throw new Error('NET_PRIVATE_KEY not set');
  }

  const account = privateKeyToAccount(privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`);
  
  const publicClient = createPublicClient({
    chain: base,
    transport: http(RPC_URL)
  });

  const walletClient = createWalletClient({
    account,
    chain: base,
    transport: http(RPC_URL)
  });

  console.log('🪂 Sending batch 5 only\n');

  const batches = JSON.parse(fs.readFileSync('/tmp/airdrop_batches.json', 'utf8'));
  const batch = batches[4]; // batch 5 (0-indexed)
  
  console.log(`Recipients: ${batch.addresses.length}`);
  
  const txHash = await walletClient.writeContract({
    address: DISPERSE_ADDRESS,
    abi: DISPERSE_ABI,
    functionName: 'disperseToken',
    args: [AXIOM_TOKEN, batch.addresses, batch.amounts.map(a => BigInt(a))],
    gas: 8000000n
  });
  
  console.log(`TX: ${txHash}`);
  
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  console.log(`✅ Confirmed in block ${receipt.blockNumber}`);
  console.log(`\nBasescan: https://basescan.org/tx/${txHash}`);
}

main().catch(console.error);
