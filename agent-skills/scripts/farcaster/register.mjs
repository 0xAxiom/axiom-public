#!/usr/bin/env node
/**
 * register.mjs — Register a Farcaster account onchain
 * 
 * Uses the Farcaster Bundler contract on OP Mainnet to register an FID
 * and add an Ed25519 signing key in a single transaction.
 */

import * as ed from '@noble/ed25519';
import {
  ID_GATEWAY_ADDRESS,
  ID_REGISTRY_ADDRESS,
  ViemLocalEip712Signer,
  idGatewayABI,
  idRegistryABI,
  NobleEd25519Signer,
  BUNDLER_ADDRESS,
  bundlerABI,
  KEY_GATEWAY_ADDRESS,
  keyGatewayABI,
} from '@farcaster/hub-nodejs';
import { bytesToHex, createPublicClient, createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { optimism } from 'viem/chains';
import { readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

// Load private key
const envFile = readFileSync(join(homedir(), '.axiom', 'wallet.env'), 'utf-8');
const keyMatch = envFile.match(/NET_PRIVATE_KEY=([^\s]+)/);
let privateKey = keyMatch[1];
if (!privateKey.startsWith('0x')) privateKey = `0x${privateKey}`;

const FARCASTER_RECOVERY_PROXY = '0x00000000FcB080a4D6c39a9354dA9EB9bC104cd7';

const publicClient = createPublicClient({
  chain: optimism,
  transport: http(),
});

const walletClient = createWalletClient({
  chain: optimism,
  transport: http(),
  account: privateKeyToAccount(privateKey),
});

const account = privateKeyToAccount(privateKey);
const accountSigner = new ViemLocalEip712Signer(account);

const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);

console.log('🔮 Farcaster Account Registration');
console.log('═══════════════════════════════════');
console.log(`Wallet: ${account.address}`);

// Step 1: Check if already registered
const existingFid = await publicClient.readContract({
  address: ID_REGISTRY_ADDRESS,
  abi: idRegistryABI,
  functionName: 'idOf',
  args: [account.address],
});

if (existingFid > 0n) {
  console.log(`\n✅ Already registered! FID: ${existingFid}`);
  process.exit(0);
}

// Step 2: Get registration price
const price = await publicClient.readContract({
  address: BUNDLER_ADDRESS,
  abi: bundlerABI,
  functionName: 'price',
  args: [0n],
});
console.log(`\n💰 Registration price: ${Number(price) / 1e18} ETH`);

// Step 3: Collect Register signature
console.log('\n📝 Generating Register signature...');
let nonce = await publicClient.readContract({
  address: ID_REGISTRY_ADDRESS,
  abi: idRegistryABI,
  functionName: 'nonces',
  args: [account.address],
});

const registerSignatureResult = await accountSigner.signRegister({
  to: account.address,
  recovery: FARCASTER_RECOVERY_PROXY,
  nonce,
  deadline,
});

if (registerSignatureResult.isErr()) {
  throw new Error('Failed to generate register signature');
}
const registerSignature = registerSignatureResult.value;
console.log('✅ Register signature generated');

// Step 4: Create Ed25519 account keypair
console.log('\n🔑 Creating Ed25519 signing keypair...');
const privateKeyBytes = ed.utils.randomSecretKey();
const signingKey = new NobleEd25519Signer(privateKeyBytes);

const signerKeyResult = await signingKey.getSignerKey();
if (signerKeyResult.isErr()) {
  throw new Error('Failed to get signer key');
}
const accountPubKey = signerKeyResult.value;
console.log(`✅ Public key: ${bytesToHex(accountPubKey).slice(0, 20)}...`);

// Step 5: Create Signed Key Request (self-signed, same account is app + user)
console.log('\n📋 Creating Signed Key Request...');

// We need an app FID — register one first for our account to act as the app
// Actually, for self-registration, we use the same account as both app and user
// We need to register an app FID first
console.log('   Registering app FID...');
const appPrice = await publicClient.readContract({
  address: ID_GATEWAY_ADDRESS,
  abi: idGatewayABI,
  functionName: 'price',
  args: [0n],
});

const { request: appRequest } = await publicClient.simulateContract({
  account: account,
  address: ID_GATEWAY_ADDRESS,
  abi: idGatewayABI,
  functionName: 'register',
  args: [FARCASTER_RECOVERY_PROXY, 0n],
  value: appPrice,
});
const appTxHash = await walletClient.writeContract(appRequest);
console.log(`   App registration tx: ${appTxHash}`);

await publicClient.waitForTransactionReceipt({ hash: appTxHash, confirmations: 2 });

const APP_FID = await publicClient.readContract({
  address: ID_REGISTRY_ADDRESS,
  abi: idRegistryABI,
  functionName: 'idOf',
  args: [account.address],
});
console.log(`   ✅ App FID: ${APP_FID}`);

// Now we have an FID, generate Signed Key Request metadata
const signedKeyRequestMetadata = await accountSigner.getSignedKeyRequestMetadata({
  requestFid: APP_FID,
  key: accountPubKey,
  deadline,
});

if (signedKeyRequestMetadata.isErr()) {
  throw new Error('Failed to generate signed key request metadata');
}
const metadata = bytesToHex(signedKeyRequestMetadata.value);

// Step 6: Collect Add signature
console.log('\n🔐 Generating Add signature...');
nonce = await publicClient.readContract({
  address: KEY_GATEWAY_ADDRESS,
  abi: keyGatewayABI,
  functionName: 'nonces',
  args: [account.address],
});

const addSignatureResult = await accountSigner.signAdd({
  owner: account.address,
  keyType: 1,
  key: accountPubKey,
  metadataType: 1,
  metadata,
  nonce,
  deadline,
});

if (addSignatureResult.isErr()) {
  throw new Error('Failed to generate add signature');
}
const addSignature = addSignatureResult.value;
console.log('✅ Add signature generated');

// Step 7: Add key via Key Gateway (since we already have an FID from step 5)
console.log('\n🚀 Adding signing key onchain...');
const { request: keyRequest } = await publicClient.simulateContract({
  account: account,
  address: KEY_GATEWAY_ADDRESS,
  abi: keyGatewayABI,
  functionName: 'add',
  args: [1, bytesToHex(accountPubKey), 1, metadata],
});
const keyTxHash = await walletClient.writeContract(keyRequest);
console.log(`   Key add tx: ${keyTxHash}`);
await publicClient.waitForTransactionReceipt({ hash: keyTxHash, confirmations: 2 });
console.log('   ✅ Signing key added');

// Save credentials
const creds = {
  timestamp: new Date().toISOString(),
  fid: APP_FID.toString(),
  address: account.address,
  signingKeyPublic: bytesToHex(accountPubKey),
  signingKeyPrivate: bytesToHex(privateKeyBytes),
  appRegistrationTx: appTxHash,
  keyAddTx: keyTxHash,
};

writeFileSync(join(homedir(), '.axiom', 'farcaster-credentials.json'), JSON.stringify(creds, null, 2));

console.log(`
══════════════════════════════════════════════
  🔮 FARCASTER REGISTRATION COMPLETE
══════════════════════════════════════════════

  FID:           ${APP_FID}
  Wallet:        ${account.address}
  Signing Key:   ${bytesToHex(accountPubKey).slice(0, 20)}...
  
  App Reg Tx:    https://optimistic.etherscan.io/tx/${appTxHash}
  Key Add Tx:    https://optimistic.etherscan.io/tx/${keyTxHash}

  Credentials saved to: ~/.axiom/farcaster-credentials.json

  📋 Next steps:
     • Set username to "axiombot" via Fname server
     • Set profile (bio, pfp) via Hub
     • Start posting via Hub API
══════════════════════════════════════════════
`);
