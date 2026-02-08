import { createWalletClient, createPublicClient, http, parseAbi, formatUnits } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base } from 'viem/chains';
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.env.HOME, '.axiom/wallet.env') });

const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const POSTERA_API = 'https://postera.dev';

async function main() {
  const pk = process.env.NET_PRIVATE_KEY;
  if (!pk) {
    console.error('NET_PRIVATE_KEY not set');
    process.exit(1);
  }
  
  const account = privateKeyToAccount(pk);
  console.log('Wallet:', account.address);
  
  const publicClient = createPublicClient({ chain: base, transport: http('https://mainnet.base.org') });
  const walletClient = createWalletClient({ account, chain: base, transport: http('https://mainnet.base.org') });
  
  // Step 1: Get challenge
  console.log('\n1. Getting challenge...');
  const challengeRes = await fetch(`${POSTERA_API}/api/agents/challenge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      handle: 'axiom',
      walletAddress: account.address
    }),
    redirect: 'follow'
  });
  
  const challengeData = await challengeRes.json();
  console.log('Nonce:', challengeData.nonce);
  console.log('Message:', challengeData.message);
  
  // Step 2: Sign message
  console.log('\n2. Signing message...');
  const signature = await account.signMessage({ message: challengeData.message });
  console.log('Signature:', signature.slice(0, 20) + '...');
  
  // Step 3: Try verify (expect 402)
  console.log('\n3. Attempting verify...');
  const verifyRes = await fetch(`${POSTERA_API}/api/agents/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      handle: 'axiom',
      walletAddress: account.address,
      signature,
      nonce: challengeData.nonce
    }),
    redirect: 'follow'
  });
  
  if (verifyRes.status === 402) {
    const paymentData = await verifyRes.json();
    console.log('402 Payment Required');
    const req = paymentData.paymentRequirements[0];
    console.log('Amount:', req.amount, 'USDC');
    const recipient = req.recipient.trim();
    console.log('Recipient:', recipient);
    
    // Step 4: Pay $1 USDC
    console.log('\n4. Sending $1 USDC...');
    const amount = BigInt(Math.round(parseFloat(req.amount) * 1e6));
    
    const hash = await walletClient.writeContract({
      address: USDC,
      abi: parseAbi(['function transfer(address to, uint256 amount) returns (bool)']),
      functionName: 'transfer',
      args: [recipient, amount]
    });
    console.log('TX:', hash);
    
    await publicClient.waitForTransactionReceipt({ hash });
    console.log('Payment confirmed!');
    
    // Step 5: Get NEW challenge (nonce is cleared after first verify attempt)
    console.log('\n5. Getting new challenge...');
    const newChallengeRes = await fetch(`${POSTERA_API}/api/agents/challenge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        handle: 'axiom',
        walletAddress: account.address
      }),
      redirect: 'follow'
    });
    const newChallengeData = await newChallengeRes.json();
    
    // Step 6: Sign new message
    const newSignature = await account.signMessage({ message: newChallengeData.message });
    
    // Step 7: Retry with payment proof
    console.log('\n6. Retrying with payment proof...');
    const retryRes = await fetch(`${POSTERA_API}/api/agents/verify`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'X-Payment-Response': hash
      },
      body: JSON.stringify({
        handle: 'axiom',
        walletAddress: account.address,
        signature: newSignature,
        nonce: newChallengeData.nonce
      }),
      redirect: 'follow'
    });
    
    const result = await retryRes.json();
    console.log('Status:', retryRes.status);
    console.log('Result:', JSON.stringify(result, null, 2));
    
    if (result.token) {
      console.log('\n✅ REGISTERED!');
      console.log('JWT Token:', result.token.slice(0, 50) + '...');
      console.log('\nSave this token to ~/.config/postera/credentials.json');
    }
  } else {
    const data = await verifyRes.json();
    console.log('Status:', verifyRes.status);
    console.log('Response:', JSON.stringify(data, null, 2));
  }
}

main().catch(console.error);
