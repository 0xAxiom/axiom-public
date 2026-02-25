#!/usr/bin/env node
import { createWalletClient, createPublicClient, http, formatUnits, parseUnits } from 'viem';
import { base } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import fs from 'fs';

const PRIVATE_KEY = process.env.NET_PRIVATE_KEY;
const AXIOM_ADDRESS = '0xf3ce5ddaab6c133f9875a4a46c55cf0b58111b07';
const DISPERSE_ADDRESS = '0xD152f549545093347A162Dce210e7293f1452150';

const account = privateKeyToAccount(PRIVATE_KEY.startsWith('0x') ? PRIVATE_KEY : `0x${PRIVATE_KEY}`);
const client = createWalletClient({
  account,
  chain: base,
  transport: http()
});
const publicClient = createPublicClient({
  chain: base,
  transport: http()
});

// Get AXIOM balance
const axiomBalance = await publicClient.readContract({
  address: AXIOM_ADDRESS,
  abi: [{
    "inputs": [{"name": "account", "type": "address"}],
    "name": "balanceOf",
    "outputs": [{"name": "", "type": "uint256"}],
    "stateMutability": "view",
    "type": "function"
  }],
  functionName: 'balanceOf',
  args: [account.address]
});

console.log(`\n💰 AXIOM Balance: ${formatUnits(axiomBalance, 18)}`);

if (axiomBalance === 0n) {
  console.log('No AXIOM to airdrop');
  process.exit(0);
}

// Load holder data
const holderData = JSON.parse(fs.readFileSync(process.env.HOME + '/clawd/data/bankr-club-holders.json', 'utf-8'));
const { holders, totalNfts } = holderData;

console.log(`\n📊 Pro Rata Airdrop`);
console.log(`Total AXIOM: ${formatUnits(axiomBalance, 18)}`);
console.log(`Total NFTs: ${totalNfts}`);
console.log(`Total Holders: ${Object.keys(holders).length}`);

const perNftAmount = Number(formatUnits(axiomBalance, 18)) / totalNfts;
console.log(`Per NFT: ${perNftAmount.toFixed(6)} AXIOM`);

// Build disperse arrays
const addresses = [];
const amounts = [];
let totalDistributed = 0n;

for (const [address, nftCount] of Object.entries(holders)) {
  const holderAmount = (Number(axiomBalance) * nftCount) / totalNfts;
  const amountBigInt = BigInt(Math.floor(holderAmount)); // Round down to avoid overflow
  
  addresses.push(address);
  amounts.push(amountBigInt);
  totalDistributed += amountBigInt;
}

console.log(`\nTotal to distribute: ${formatUnits(totalDistributed, 18)} AXIOM`);
console.log(`Dust remaining: ${formatUnits(axiomBalance - totalDistributed, 18)} AXIOM`);

// Approve AXIOM to Disperse
console.log('\nApproving AXIOM to Disperse...');
const approveTx = await client.writeContract({
  address: AXIOM_ADDRESS,
  abi: [{
    "inputs": [
      {"name": "spender", "type": "address"},
      {"name": "amount", "type": "uint256"}
    ],
    "name": "approve",
    "outputs": [{"name": "", "type": "bool"}],
    "stateMutability": "nonpayable",
    "type": "function"
  }],
  functionName: 'approve',
  args: [DISPERSE_ADDRESS, axiomBalance]
});
console.log(`✅ Approve TX: ${approveTx}`);

await new Promise(resolve => setTimeout(resolve, 3000));

// Disperse in batches of 150
const BATCH_SIZE = 150;
const batches = [];
for (let i = 0; i < addresses.length; i += BATCH_SIZE) {
  batches.push({
    addresses: addresses.slice(i, i + BATCH_SIZE),
    amounts: amounts.slice(i, i + BATCH_SIZE)
  });
}

console.log(`\n📦 Dispersing in ${batches.length} batches...`);

const txHashes = [];
for (let i = 0; i < batches.length; i++) {
  const batch = batches[i];
  console.log(`\nBatch ${i + 1}/${batches.length}: ${batch.addresses.length} recipients`);
  
  const tx = await client.writeContract({
    address: DISPERSE_ADDRESS,
    abi: [{
      "inputs": [
        {"name": "token", "type": "address"},
        {"name": "recipients", "type": "address[]"},
        {"name": "values", "type": "uint256[]"}
      ],
      "name": "disperseToken",
      "outputs": [],
      "stateMutability": "nonpayable",
      "type": "function"
    }],
    functionName: 'disperseToken',
    args: [AXIOM_ADDRESS, batch.addresses, batch.amounts]
  });
  
  console.log(`✅ TX: ${tx}`);
  txHashes.push(tx);
  
  // Wait between batches
  if (i < batches.length - 1) {
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
}

console.log(`\n✅ Airdrop Complete!`);
console.log(`Distributed: ${formatUnits(totalDistributed, 18)} AXIOM`);
console.log(`Recipients: ${addresses.length}`);
console.log(`\nTX Hashes:`);
txHashes.forEach((tx, i) => console.log(`  Batch ${i + 1}: ${tx}`));

// Get top 5 recipients
const sortedHolders = Object.entries(holders)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 5);

console.log(`\n🏆 Top 5 Recipients:`);
sortedHolders.forEach(([addr, nftCount], i) => {
  const amount = (Number(axiomBalance) * nftCount) / totalNfts;
  console.log(`  ${i + 1}. ${addr}: ${nftCount} NFTs → ${formatUnits(BigInt(Math.floor(amount)), 18)} AXIOM`);
});

// Write summary
const summary = {
  totalDistributed: formatUnits(totalDistributed, 18),
  perNftAmount: perNftAmount.toFixed(6),
  totalRecipients: addresses.length,
  txHashes,
  topRecipients: sortedHolders.map(([addr, nftCount]) => ({
    address: addr,
    nftCount,
    axiomAmount: formatUnits(BigInt(Math.floor((Number(axiomBalance) * nftCount) / totalNfts)), 18)
  }))
};

fs.writeFileSync('/tmp/airdrop-summary.json', JSON.stringify(summary, null, 2));
console.log(`\n📄 Summary written to /tmp/airdrop-summary.json`);
