#!/usr/bin/env node
import { createWalletClient, createPublicClient, http, parseUnits, formatUnits } from 'viem';
import { base } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';

const PRIVATE_KEY = process.env.NET_PRIVATE_KEY;
const WETH_ADDRESS = '0x4200000000000000000000000000000000000006';
const USDC_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const SWAP_ROUTER_02 = '0x2626664c2603336E57B271c5C0b26F421741e481';
const TREASURY = '0x9A2A75fE7FA8EE6552Cf871e5eC2156B958f581A';

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

// Get WETH balance
const wethBalance = await publicClient.readContract({
  address: WETH_ADDRESS,
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

console.log(`WETH Balance: ${formatUnits(wethBalance, 18)}`);

if (wethBalance === 0n) {
  console.log('No WETH to swap');
  process.exit(0);
}

// Calculate minimum USDC output with 2% slippage
const ethPrice = 1970.37;
const wethAmount = Number(formatUnits(wethBalance, 18));
const expectedUsd = wethAmount * ethPrice;
const minUsd = expectedUsd * 0.98;
const minUsdc = BigInt(Math.floor(minUsd * 1e6));

console.log(`Expected USD: $${expectedUsd.toFixed(2)}`);
console.log(`Min USDC (2% slippage): ${formatUnits(minUsdc, 6)}`);

// Approve WETH to SwapRouter02
console.log('\nApproving WETH...');
const approveTx = await client.writeContract({
  address: WETH_ADDRESS,
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
  args: [SWAP_ROUTER_02, wethBalance]
});
console.log(`✅ Approve TX: ${approveTx}`);

// Wait for approval
await new Promise(resolve => setTimeout(resolve, 3000));

// Swap WETH to USDC (to my address first)
console.log('\nSwapping WETH to USDC...');
const swapAbi = [{
  "inputs": [{
    "components": [
      {"name": "tokenIn", "type": "address"},
      {"name": "tokenOut", "type": "address"},
      {"name": "fee", "type": "uint24"},
      {"name": "recipient", "type": "address"},
      {"name": "amountIn", "type": "uint256"},
      {"name": "amountOutMinimum", "type": "uint256"},
      {"name": "sqrtPriceLimitX96", "type": "uint160"}
    ],
    "name": "params",
    "type": "tuple"
  }],
  "name": "exactInputSingle",
  "outputs": [{"name": "amountOut", "type": "uint256"}],
  "stateMutability": "payable",
  "type": "function"
}];

const usdcBefore = await publicClient.readContract({
  address: USDC_ADDRESS,
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

const swapTx = await client.writeContract({
  address: SWAP_ROUTER_02,
  abi: swapAbi,
  functionName: 'exactInputSingle',
  args: [{
    tokenIn: WETH_ADDRESS,
    tokenOut: USDC_ADDRESS,
    fee: 500,
    recipient: account.address,  // Swap to my address first
    amountIn: wethBalance,
    amountOutMinimum: minUsdc,
    sqrtPriceLimitX96: 0n
  }]
});

console.log(`✅ Swap TX: ${swapTx}`);

// Wait and get USDC received
await new Promise(resolve => setTimeout(resolve, 3000));
const usdcAfter = await publicClient.readContract({
  address: USDC_ADDRESS,
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

const usdcReceived = usdcAfter - usdcBefore;
console.log(`Received ${formatUnits(usdcReceived, 6)} USDC`);

// Transfer USDC to treasury
console.log('\nTransferring USDC to treasury...');
const transferTx = await client.writeContract({
  address: USDC_ADDRESS,
  abi: [{
    "inputs": [
      {"name": "to", "type": "address"},
      {"name": "amount", "type": "uint256"}
    ],
    "name": "transfer",
    "outputs": [{"name": "", "type": "bool"}],
    "stateMutability": "nonpayable",
    "type": "function"
  }],
  functionName: 'transfer',
  args: [TREASURY, usdcReceived]
});

console.log(`✅ Transfer TX: ${transferTx}`);
console.log(`\nSwapped ${formatUnits(wethBalance, 18)} WETH → ${formatUnits(usdcReceived, 6)} USDC → Treasury ${TREASURY}`);
