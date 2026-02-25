#!/usr/bin/env node
import { ethers } from 'ethers';
import fs from 'fs';

const DISPERSE_ABI = [
  'function disperseToken(address token, address[] recipients, uint256[] values)'
];

const TOKEN = '0xf3ce5ddaab6c133f9875a4a46c55cf0b58111b07';
const DISPERSE = '0xD152f549545093347A162Dce210e7293f1452150';
const RPC = 'https://mainnet.base.org';

const batchNum = process.argv[2];
if (!batchNum) {
  console.error('Usage: node disperse-airdrop.mjs <batch_num>');
  process.exit(1);
}

const privateKey = process.env.NET_PRIVATE_KEY;
if (!privateKey) {
  console.error('NET_PRIVATE_KEY not set');
  process.exit(1);
}

const provider = new ethers.JsonRpcProvider(RPC);
const wallet = new ethers.Wallet(privateKey, provider);
const disperse = new ethers.Contract(DISPERSE, DISPERSE_ABI, wallet);

const addresses = JSON.parse(fs.readFileSync(`/tmp/airdrop_batch_${batchNum}_addresses.json`, 'utf8'));
const amounts = JSON.parse(fs.readFileSync(`/tmp/airdrop_batch_${batchNum}_amounts.json`, 'utf8'));

console.log(`Batch ${batchNum}: ${addresses.length} recipients`);
console.log('Sending transaction...');

try {
  const tx = await disperse.disperseToken(TOKEN, addresses, amounts, {
    gasLimit: 2000000
  });
  console.log(`TX: ${tx.hash}`);
  
  const receipt = await tx.wait();
  console.log(`✅ Confirmed in block ${receipt.blockNumber}`);
} catch (error) {
  console.error('Error:', error.message);
  process.exit(1);
}
