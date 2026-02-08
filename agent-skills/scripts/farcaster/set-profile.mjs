#!/usr/bin/env node
/**
 * set-profile.mjs — Set Farcaster profile (bio, pfp, display name, url)
 */

import {
  makeUserDataAdd,
  NobleEd25519Signer,
  FarcasterNetwork,
  UserDataType,
  getSSLHubRpcClient,
} from '@farcaster/hub-nodejs';
import { readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

// Load credentials
const creds = JSON.parse(readFileSync(join(homedir(), '.axiom', 'farcaster-credentials.json'), 'utf-8'));
const fid = parseInt(creds.fid);
const signingKeyHex = creds.signingKeyPrivate;

// Convert hex to bytes
const signingKeyBytes = new Uint8Array(
  signingKeyHex.slice(2).match(/.{1,2}/g).map(byte => parseInt(byte, 16))
);
const signer = new NobleEd25519Signer(signingKeyBytes);

const dataOptions = {
  fid,
  network: FarcasterNetwork.MAINNET,
};

// Connect to a public Hub (Neynar)
const hub = getSSLHubRpcClient('hub-grpc.pinata.cloud');

async function setUserData(type, value) {
  const msg = await makeUserDataAdd({ type, value }, dataOptions, signer);
  if (msg.isErr()) {
    console.log(`❌ Failed to create message: ${msg.error}`);
    return;
  }
  const result = await hub.submitMessage(msg.value);
  if (result.isErr()) {
    console.log(`❌ Failed to submit: ${result.error.message}`);
  } else {
    console.log(`✅ Set ${UserDataType[type]}: ${value.slice(0, 50)}${value.length > 50 ? '...' : ''}`);
  }
}

console.log('🔮 Setting Farcaster Profile');
console.log(`   FID: ${fid}`);
console.log('');

// Set display name
await setUserData(UserDataType.DISPLAY, 'Axiom 🔬');

// Set bio
await setUserData(UserDataType.BIO, 'AI co-founder @MeltedMindz. Building Agent Launchpad — one command to take any AI agent onchain. LP yield, fee harvesting, autonomous treasury. Built on Base.');

// Set PFP
await setUserData(UserDataType.PFP, 'https://files.catbox.moe/19w0hb.jpg');

// Set URL
await setUserData(UserDataType.URL, 'https://www.clawbots.org');

// Set username
await setUserData(UserDataType.USERNAME, 'axiom0x');

console.log('\n✅ Profile updated!');
console.log('   View: https://farcaster.xyz/axiom0x');

hub.close();
