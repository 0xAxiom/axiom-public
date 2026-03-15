import fs from 'fs';
import { createWalletClient, createPublicClient, http, parseAbi } from 'viem';
import { base } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { execSync } from 'child_process';

const RPC_URL = 'https://mainnet.base.org';
const DISPERSE_ADDRESS = '0xD152f549545093347A162Dce210e7293f1452150';
const AXIOM_ADDRESS = '0xf3ce5ddaab6c133f9875a4a46c55cf0b58111b07';

// Get private key
const pk = execSync('security find-generic-password -a axiom -s openclaw.NET_PRIVATE_KEY -w', { encoding: 'utf8' }).trim();
const account = privateKeyToAccount(`0x${pk.replace(/^0x/, '')}`);

const publicClient = createPublicClient({
  chain: base,
  transport: http(RPC_URL)
});

const walletClient = createWalletClient({
  account,
  chain: base,
  transport: http(RPC_URL)
});

// Load holders data
const data = JSON.parse(fs.readFileSync('/Users/axiom/clawd/data/bankr-club-holders.json', 'utf8'));
const totalAXIOM = BigInt('4147574063804355895406505');
const totalNfts = BigInt(data.totalNfts);

const addresses = [];
const amounts = [];

for (const [address, nftCount] of Object.entries(data.holders)) {
  addresses.push(address);
  const amount = (totalAXIOM * BigInt(nftCount)) / totalNfts;
  amounts.push(amount);
}

console.log(`Preparing airdrop to ${addresses.length} holders...`);

// Disperse ABI
const DISPERSE_ABI = parseAbi([
  'function disperseToken(address token, address[] recipients, uint256[] values)'
]);

// Batch into groups of 100
const BATCH_SIZE = 100;
const txHashes = [];

for (let i = 0; i < addresses.length; i += BATCH_SIZE) {
  const batchAddresses = addresses.slice(i, i + BATCH_SIZE);
  const batchAmounts = amounts.slice(i, i + BATCH_SIZE);
  
  console.log(`\nBatch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(addresses.length / BATCH_SIZE)}: ${batchAddresses.length} addresses`);
  
  try {
    const hash = await walletClient.writeContract({
      address: DISPERSE_ADDRESS,
      abi: DISPERSE_ABI,
      functionName: 'disperseToken',
      args: [AXIOM_ADDRESS, batchAddresses, batchAmounts],
      gas: 10000000n
    });
    
    console.log(`TX submitted: ${hash}`);
    
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    console.log(`✅ Confirmed in block ${receipt.blockNumber}`);
    txHashes.push(hash);
  } catch (error) {
    console.error(`❌ Batch failed:`, error.message);
    process.exit(1);
  }
}

console.log(`\n✅ All batches complete!`);
console.log(`TX hashes: ${txHashes.join(',')}`);
