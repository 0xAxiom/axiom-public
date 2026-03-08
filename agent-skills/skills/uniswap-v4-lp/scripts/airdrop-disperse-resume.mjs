#!/usr/bin/env node
import { createWalletClient, createPublicClient, http, parseAbi } from 'viem';
import { base } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import fs from 'fs';

const DISPERSE_ABI = parseAbi([
  'function disperseToken(address token, address[] recipients, uint256[] values)'
]);

const DISPERSE_ADDRESS = '0xD152f549545093347A162Dce210e7293f1452150';
const TOKEN_ADDRESS = '0xf3ce5ddaab6c133f9875a4a46c55cf0b58111b07';

const privateKey = process.env.NET_PRIVATE_KEY;
if (!privateKey) {
  console.error('❌ NET_PRIVATE_KEY not set');
  process.exit(1);
}

const account = privateKeyToAccount(privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`);
const publicClient = createPublicClient({
  chain: base,
  transport: http('https://mainnet.base.org')
});
const client = createWalletClient({
  account,
  chain: base,
  transport: http('https://mainnet.base.org')
});

const txHashes = [];

// Resume from batch 2
for (let i = 2; i < 5; i++) {
  console.log(`\n=== Batch ${i} ===`);
  
  const batchPath = `/tmp/airdrop-batch-${i}.json`;
  if (!fs.existsSync(batchPath)) {
    console.error(`❌ Batch file not found: ${batchPath}`);
    continue;
  }
  
  const batchData = JSON.parse(fs.readFileSync(batchPath, 'utf8'));
  const { addresses, amounts } = batchData;
  
  console.log(`Recipients: ${addresses.length}`);
  const total = amounts.reduce((a, b) => BigInt(a) + BigInt(b), 0n);
  console.log(`Total: ${total.toString()} wei`);
  
  try {
    const hash = await client.writeContract({
      address: DISPERSE_ADDRESS,
      abi: DISPERSE_ABI,
      functionName: 'disperseToken',
      args: [TOKEN_ADDRESS, addresses, amounts.map(BigInt)]
    });
    
    console.log(`✅ TX submitted: ${hash}`);
    
    // Wait for confirmation before proceeding
    console.log('Waiting for confirmation...');
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    console.log(`✅ Confirmed in block ${receipt.blockNumber}`);
    
    txHashes.push(hash);
  } catch (error) {
    console.error(`❌ Batch ${i} failed:`, error.message);
    process.exit(1);
  }
}

console.log('\n═══════════════════════════════════════════════════');
console.log('✅ Remaining batches complete');
console.log('═══════════════════════════════════════════════════');
txHashes.forEach((hash, i) => console.log(`Batch ${i + 2}: ${hash}`));
