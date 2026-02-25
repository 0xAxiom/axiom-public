import { ethers } from 'ethers';
import fs from 'fs';

const DISPERSE_ADDRESS = '0xD152f549545093347A162Dce210e7293f1452150';
const TOKEN_ADDRESS = '0xf3ce5ddaab6c133f9875a4a46c55cf0b58111b07';
const RPC_URL = 'https://mainnet.base.org';

const DISPERSE_ABI = [
  'function disperseToken(address token, address[] recipients, uint256[] values) external'
];

async function main() {
  const privateKey = process.env.NET_PRIVATE_KEY;
  if (!privateKey) {
    throw new Error('NET_PRIVATE_KEY not set');
  }

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(privateKey, provider);
  const disperse = new ethers.Contract(DISPERSE_ADDRESS, DISPERSE_ABI, wallet);

  // Load batches
  const batches = JSON.parse(fs.readFileSync('/tmp/airdrop_batches.json', 'utf8'));

  console.log(`Executing ${batches.length} disperse batches...`);

  const txHashes = [];

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    const totalAmount = batch.amounts.reduce((a, b) => BigInt(a) + BigInt(b), 0n);
    
    console.log(`\nBatch ${i + 1}/${batches.length}:`);
    console.log(`  Recipients: ${batch.addresses.length}`);
    console.log(`  Total: ${ethers.formatUnits(totalAmount, 18)} AXIOM`);

    try {
      const tx = await disperse.disperseToken(
        TOKEN_ADDRESS,
        batch.addresses,
        batch.amounts,
        { gasLimit: 8000000 }
      );
      
      console.log(`  TX: ${tx.hash}`);
      txHashes.push(tx.hash);
      
      console.log(`  Waiting for confirmation...`);
      const receipt = await tx.wait();
      console.log(`  ✅ Confirmed in block ${receipt.blockNumber}`);
      
    } catch (error) {
      console.error(`  ❌ Failed: ${error.message}`);
      throw error;
    }
  }

  console.log(`\n✅ All batches complete!`);
  console.log(`TX hashes: ${txHashes.join(', ')}`);
  
  fs.writeFileSync('/tmp/airdrop_txs.json', JSON.stringify(txHashes, null, 2));
}

main().catch(console.error);
