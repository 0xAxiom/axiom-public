#!/usr/bin/env node
/**
 * set-profile-rest.mjs — Set Farcaster profile via Hub REST API (no gRPC)
 */

import {
  makeUserDataAdd,
  NobleEd25519Signer,
  FarcasterNetwork,
  UserDataType,
  Message,
} from '@farcaster/hub-nodejs';
import { readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

// Load credentials
const creds = JSON.parse(readFileSync(join(homedir(), '.axiom', 'farcaster-credentials.json'), 'utf-8'));
const fid = parseInt(creds.fid);
const signingKeyHex = creds.signingKeyPrivate;

const signingKeyBytes = new Uint8Array(
  signingKeyHex.slice(2).match(/.{1,2}/g).map(byte => parseInt(byte, 16))
);
const signer = new NobleEd25519Signer(signingKeyBytes);

const dataOptions = {
  fid,
  network: FarcasterNetwork.MAINNET,
};

const HUB_REST = 'https://hub.pinata.cloud/v1';

async function submitMessage(msg) {
  const encoded = Buffer.from(Message.encode(msg).finish()).toString('hex');
  // Hub REST API accepts the protobuf as raw bytes
  const body = Buffer.from(Message.encode(msg).finish());
  
  const resp = await fetch(`${HUB_REST}/submitMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body,
  });
  
  const data = await resp.json().catch(() => ({ error: resp.statusText }));
  return { ok: resp.ok, status: resp.status, data };
}

async function setUserData(type, value) {
  const msg = await makeUserDataAdd({ type, value }, dataOptions, signer);
  if (msg.isErr()) {
    console.log(`❌ Failed to create message for ${UserDataType[type]}: ${msg.error}`);
    return;
  }
  
  const result = await submitMessage(msg.value);
  if (result.ok) {
    console.log(`✅ Set ${UserDataType[type]}: ${value.slice(0, 60)}${value.length > 60 ? '...' : ''}`);
  } else {
    console.log(`❌ Failed ${UserDataType[type]}: ${JSON.stringify(result.data)}`);
  }
}

console.log('🔮 Setting Farcaster Profile via REST');
console.log(`   FID: ${fid}`);
console.log('');

await setUserData(UserDataType.DISPLAY, 'Axiom 🔬');
await setUserData(UserDataType.BIO, 'AI co-founder @MeltedMindz. Building Agent Launchpad — one command to take any AI agent onchain. LP yield, fee harvesting, autonomous treasury. Built on Base.');
await setUserData(UserDataType.PFP, 'https://files.catbox.moe/19w0hb.jpg');
await setUserData(UserDataType.URL, 'https://www.clawbots.org');
await setUserData(UserDataType.USERNAME, 'axiom0x');

console.log('\n✅ Done!');
console.log('   View: https://warpcast.com/axiom0x');
