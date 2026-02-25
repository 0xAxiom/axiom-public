#!/usr/bin/env node
import { createPublicClient, createWalletClient, http, parseUnits } from 'viem';
import { base } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';

const TREASURY = '0x9A2A75fE7FA8EE6552Cf871e5eC2156B958f581A';
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const BNKR = '0x22af33fe49fd1fa80c7149773dde5890d3c76f3b';
const RPC_URL = 'https://mainnet.base.org';

const ERC20_ABI = [
  {
    inputs: [{ name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }],
    name: 'transfer',
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'nonpayable',
    type: 'function'
  },
  {
    inputs: [{ name: 'account', type: 'address' }],
    name: 'balanceOf',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
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

  console.log('💰 Sending to Treasury\n');

  // Check balances
  const usdcBal = await publicClient.readContract({
    address: USDC,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [account.address]
  });

  const bnkrBal = await publicClient.readContract({
    address: BNKR,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [account.address]
  });

  console.log(`USDC balance: ${Number(usdcBal) / 1e6} USDC`);
  console.log(`BNKR balance: ${Number(bnkrBal) / 1e18} BNKR\n`);

  // Send USDC
  if (usdcBal > 0n) {
    console.log(`Sending ${Number(usdcBal) / 1e6} USDC to treasury...`);
    const usdcTx = await walletClient.writeContract({
      address: USDC,
      abi: ERC20_ABI,
      functionName: 'transfer',
      args: [TREASURY, usdcBal],
      gas: 100000n
    });
    console.log(`USDC TX: ${usdcTx}`);
    const usdcReceipt = await publicClient.waitForTransactionReceipt({ hash: usdcTx });
    console.log(`✅ Block ${usdcReceipt.blockNumber}\n`);
  }

  // Send BNKR
  if (bnkrBal > 0n) {
    console.log(`Sending ${Number(bnkrBal) / 1e18} BNKR to treasury...`);
    const bnkrTx = await walletClient.writeContract({
      address: BNKR,
      abi: ERC20_ABI,
      functionName: 'transfer',
      args: [TREASURY, bnkrBal],
      gas: 100000n
    });
    console.log(`BNKR TX: ${bnkrTx}`);
    const bnkrReceipt = await publicClient.waitForTransactionReceipt({ hash: bnkrTx });
    console.log(`✅ Block ${bnkrReceipt.blockNumber}\n`);
  }

  console.log('✅ Treasury transfers complete!');
}

main().catch(console.error);
