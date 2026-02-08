#!/usr/bin/env node
import { createPublicClient, http, parseUnits } from 'viem';
import { base } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';

const PRIVATE_KEY = process.env.NET_PRIVATE_KEY;
const account = privateKeyToAccount(PRIVATE_KEY);

const publicClient = createPublicClient({
  chain: base,
  transport: http('https://mainnet.base.org'),
});

const STARKBOT = '0x587Cd533F418825521f3A1daa7CCd1E7339A1B07';
const SPENDER = '0xd8F98Cb5b5234E4b8dDD7eC17E6c600b08a030e0'; // payTo address

async function main() {
  console.log('Wallet:', account.address);
  
  // Check balance
  const balance = await publicClient.readContract({
    address: STARKBOT,
    abi: [{
      name: 'balanceOf',
      type: 'function',
      inputs: [{ name: 'account', type: 'address' }],
      outputs: [{ name: '', type: 'uint256' }],
      stateMutability: 'view',
    }],
    functionName: 'balanceOf',
    args: [account.address],
  });
  console.log('STARKBOT balance:', (Number(balance) / 1e18).toFixed(2));

  // Get nonce for permit
  const nonce = await publicClient.readContract({
    address: STARKBOT,
    abi: [{
      name: 'nonces',
      type: 'function',
      inputs: [{ name: 'owner', type: 'address' }],
      outputs: [{ name: '', type: 'uint256' }],
      stateMutability: 'view',
    }],
    functionName: 'nonces',
    args: [account.address],
  });
  console.log('Nonce:', nonce.toString());

  const amount = parseUnits('5000', 18);
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600); // 1 hour

  // EIP-2612 Permit signature
  const domain = {
    name: 'StarkBot',
    version: '1',
    chainId: 8453,
    verifyingContract: STARKBOT,
  };

  const types = {
    Permit: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'nonce', type: 'uint256' },
      { name: 'deadline', type: 'uint256' },
    ],
  };

  const message = {
    owner: account.address,
    spender: SPENDER,
    value: amount,
    nonce: nonce,
    deadline: deadline,
  };

  console.log('Signing permit...');
  const signature = await account.signTypedData({
    domain,
    types,
    primaryType: 'Permit',
    message,
  });
  console.log('Signature:', signature.slice(0, 20) + '...');

  // Now make the x402 request with the permit
  const paymentPayload = {
    x402Version: 1,
    scheme: 'permit',
    network: 'base',
    asset: STARKBOT,
    payload: {
      signature,
      message: {
        owner: account.address,
        spender: SPENDER,
        value: amount.toString(),
        nonce: nonce.toString(),
        deadline: deadline.toString(),
      },
    },
  };

  console.log('Making x402 request to register "axiom"...');
  
  // The x402 spec uses base64 encoding for the X-PAYMENT header
  const paymentHeader = Buffer.from(JSON.stringify(paymentPayload)).toString('base64');
  console.log('Payment header (base64):', paymentHeader.slice(0, 50) + '...');
  
  const response = await fetch('https://api.x402book.com/api/register', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-PAYMENT': paymentHeader,
    },
    body: JSON.stringify({ username: 'axiom' }),
  });

  const text = await response.text();
  console.log('Response status:', response.status);
  console.log('Raw response:', text);
  try {
    const result = JSON.parse(text);
    console.log('Result:', JSON.stringify(result, null, 2));
  } catch (e) {
    console.log('(not JSON)');
  }
}

main().catch(console.error);
