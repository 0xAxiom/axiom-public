#!/usr/bin/env node
import { createWalletClient, createPublicClient, http, formatUnits } from 'viem';
import { base } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import fs from 'fs';

const PRIVATE_KEY = process.env.NET_PRIVATE_KEY;
const AXIOM_ADDRESS = '0xf3ce5ddaab6c133f9875a4a46c55cf0b58111b07';
const DISPERSE_ADDRESS = '0xD152f549545093347A162Dce210e7293f1452150';

const account = privateKeyToAccount(PRIVATE_KEY.startsWith('0x') ? PRIVATE_KEY : `0x${PRIVATE_KEY}`);
const client = createWalletClient({ account, chain: base, transport: http() });
const publicClient = createPublicClient({ chain: base, transport: http() });

// Load holder data
const holderData = JSON.parse(fs.readFileSync(process.env.HOME + '/clawd/data/bankr-club-holders.json', 'utf-8'));
const { holders, totalNfts } = holderData;

// Get AXIOM balance
const axiomBalance = await publicClient.readContract({
  address: AXIOM_ADDRESS,
  abi: [{ inputs: [{name: 'account', type: 'address'}], name: 'balanceOf', outputs: [{name: '', type: 'uint256'}], stateMutability: 'view', type: 'function' }],
  functionName: 'balanceOf',
  args: [account.address]
});

console.log(`Remaining AXIOM: ${formatUnits(axiomBalance, 18)}`);

// Build arrays for batch 5 (skip first 600, take remaining 134)
const allHolders = Object.entries(holders);
const batch5Holders = allHolders.slice(600); // Start at holder 601

console.log(`Batch 5: ${batch5Holders.length} holders`);

const addresses = [];
const amounts = [];

for (const [address, nftCount] of batch5Holders) {
  const holderAmount = (Number(axiomBalance) * nftCount) / totalNfts;
  const amountBigInt = BigInt(Math.floor(holderAmount));
  
  addresses.push(address);
  amounts.push(amountBigInt);
}

// Approve
console.log('Approving...');
const approveTx = await client.writeContract({
  address: AXIOM_ADDRESS,
  abi: [{ inputs: [{name: 'spender', type: 'address'}, {name: 'amount', type: 'uint256'}], name: 'approve', outputs: [{name: '', type: 'bool'}], stateMutability: 'nonpayable', type: 'function' }],
  functionName: 'approve',
  args: [DISPERSE_ADDRESS, axiomBalance]
});
console.log(`✅ ${approveTx}`);

await new Promise(resolve => setTimeout(resolve, 3000));

// Disperse
console.log(`\nDispersing to ${addresses.length} recipients...`);
const tx = await client.writeContract({
  address: DISPERSE_ADDRESS,
  abi: [{ inputs: [{name: 'token', type: 'address'}, {name: 'recipients', type: 'address[]'}, {name: 'values', type: 'uint256[]'}], name: 'disperseToken', outputs: [], stateMutability: 'nonpayable', type: 'function' }],
  functionName: 'disperseToken',
  args: [AXIOM_ADDRESS, addresses, amounts]
});

console.log(`✅ Batch 5 TX: ${tx}`);
console.log(`\nhttps://basescan.org/tx/${tx}`);
