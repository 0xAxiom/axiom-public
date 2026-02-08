#!/usr/bin/env node
/**
 * set-username.mjs — Register an Fname (username) for a Farcaster FID
 */

import {
  makeUserNameProofClaim,
  ViemLocalEip712Signer,
  ID_REGISTRY_ADDRESS,
  idRegistryABI,
} from '@farcaster/hub-nodejs';
import { bytesToHex, createPublicClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { optimism } from 'viem/chains';
import { readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const USERNAME = process.argv[2] || 'axiombot';

// Load private key
const envFile = readFileSync(join(homedir(), '.axiom', 'wallet.env'), 'utf-8');
const keyMatch = envFile.match(/NET_PRIVATE_KEY=([^\s]+)/);
let privateKey = keyMatch[1];
if (!privateKey.startsWith('0x')) privateKey = `0x${privateKey}`;

const account = privateKeyToAccount(privateKey);
const accountSigner = new ViemLocalEip712Signer(account);

const publicClient = createPublicClient({
  chain: optimism,
  transport: http(),
});

// Get FID
const fid = await publicClient.readContract({
  address: ID_REGISTRY_ADDRESS,
  abi: idRegistryABI,
  functionName: 'idOf',
  args: [account.address],
});

console.log(`Setting username "${USERNAME}" for FID ${fid}...`);

const timestamp = Math.floor(Date.now() / 1000);

const claim = makeUserNameProofClaim({
  name: USERNAME,
  owner: account.address,
  timestamp,
});

const signatureResult = await accountSigner.signUserNameProofClaim(claim);
if (signatureResult.isErr()) {
  throw new Error('Failed to sign username proof claim');
}
const signature = bytesToHex(signatureResult.value);

// Register via Fname server
const body = {
  name: USERNAME,
  from: 0,
  to: Number(fid),
  fid: Number(fid),
  owner: account.address,
  timestamp,
  signature,
};

console.log('Registering with Fname server...');
const resp = await fetch('https://fnames.farcaster.xyz/transfers', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

const data = await resp.json();
if (resp.ok) {
  console.log(`✅ Username "${USERNAME}" registered!`);
  console.log(`   Profile: https://farcaster.xyz/${USERNAME}`);
} else {
  console.log(`❌ Error:`, JSON.stringify(data));
}
