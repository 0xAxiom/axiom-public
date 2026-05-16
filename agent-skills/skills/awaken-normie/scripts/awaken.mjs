#!/usr/bin/env node
// Awaken a Normie: register it as an ERC-8004 agent via the Adapter8004 proxy.
// Usage:
//   node awaken.mjs <tokenId>                          # build + show calldata, dry-run
//   node awaken.mjs <tokenId> --send                   # broadcast the register tx
//   node awaken.mjs <tokenId> --send --chain sepolia   # other chain
//   node awaken.mjs --verify <agentId>                 # verify a binding already on-chain

import { ethers } from "ethers";
import {
  CHAINS, TOKEN_STANDARD, ADAPTER_ABI, REGISTRY_ABI, ERC721_ABI,
  getProvider, getSigner, loadEnv, normiesAgentURI,
} from "./lib.mjs";

const NORMIES_API = "https://api.normies.art";

async function getJson(url) {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${url} -> ${res.status} ${text.slice(0, 200)}`);
  }
  return res.json();
}

async function indexerBinding(tokenId) {
  try {
    const j = await getJson(`${NORMIES_API}/agents/binding/${tokenId}`);
    return j.binding ?? null;
  } catch (e) {
    return { _error: e.message };
  }
}

async function waitForIndexer(tokenId, expectAgentId, timeoutMs = 90000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const b = await indexerBinding(tokenId);
    if (b && !b._error && b.agentId && b.agentId.toString() === expectAgentId.toString()) return b;
    await new Promise(r => setTimeout(r, 4000));
  }
  return null;
}

async function liveInfo(tokenId) {
  try { return await getJson(`${NORMIES_API}/agents/info/${tokenId}`); }
  catch (e) { return { _error: e.message }; }
}

loadEnv();

const args = process.argv.slice(2);
const chain = (() => { const i = args.indexOf("--chain"); return i >= 0 ? args[i+1] : "mainnet"; })();
const send = args.includes("--send");
const verifyMode = args.includes("--verify");
const positional = args.filter(a => !a.startsWith("--") && args[args.indexOf(a)-1] !== "--chain");

const c = CHAINS[chain];
if (!c) throw new Error(`unknown chain: ${chain}`);
const provider = getProvider(chain);
const adapter = new ethers.Contract(c.adapter, ADAPTER_ABI, provider);
const registry = new ethers.Contract(c.registry, REGISTRY_ABI, provider);

function fmt(v) { return typeof v === "bigint" ? v.toString() : v; }

async function verifyBinding(agentId) {
  console.log(`\n=== Verify agentId=${agentId} on ${chain} ===`);
  const binding = await adapter.bindingOf(agentId);
  // tuple → fields by name
  const std = Number(binding.standard ?? binding[0]);
  const tokenContract = binding.tokenContract ?? binding[1];
  const tokenId = (binding.tokenId ?? binding[2]).toString();
  console.log(`bindingOf:        standard=${std} tokenContract=${tokenContract} tokenId=${tokenId}`);
  const ownerOfAgent = await registry.ownerOf(agentId);
  console.log(`registry.ownerOf: ${ownerOfAgent}  (should be adapter ${c.adapter})`);
  const uri = await registry.tokenURI(agentId);
  console.log(`tokenURI:         ${uri}`);
  const wallet = await registry.getAgentWallet(agentId);
  console.log(`getAgentWallet:   ${wallet}`);
  const bindingMeta = await registry.getMetadata(agentId, "agent-binding");
  console.log(`metadata[agent-binding]: ${bindingMeta} (${ethers.dataLength(bindingMeta)} bytes)`);
  if (std === 0) {
    const nft = new ethers.Contract(tokenContract, ERC721_ABI, provider);
    const holder = await nft.ownerOf(tokenId);
    const isCtrl = await adapter.isController(agentId, holder);
    console.log(`NFT ownerOf:      ${holder}`);
    console.log(`isController(holder, agentId): ${isCtrl}`);
  }
}

async function awaken(tokenId) {
  console.log(`\n=== Awaken Normie tokenId=${tokenId} on ${chain} ===`);
  const signer = getSigner(chain);
  console.log(`signer: ${signer.address}`);

  // 1. Confirm we hold the NFT
  const nft = new ethers.Contract(c.normies, ERC721_ABI, provider);
  let holder;
  try { holder = await nft.ownerOf(tokenId); }
  catch (e) { throw new Error(`ownerOf(${tokenId}) failed: ${e.shortMessage || e.message}`); }
  console.log(`Normie holder: ${holder}`);
  if (holder.toLowerCase() !== signer.address.toLowerCase()) {
    throw new Error(`signer does not own Normie #${tokenId} (holder=${holder})`);
  }

  // 1b. Informational: any prior binding (a prior owner could have registered this token).
  if (chain === "mainnet") {
    const prior = await indexerBinding(tokenId);
    if (prior && !prior._error) {
      console.log(`prior binding (indexer): agentId=${prior.agentId} registeredBy=${prior.registeredBy}`);
      console.log(`(adapter allows multiple agentIds per NFT — we'll mint a fresh one under our wallet)`);
    } else {
      console.log(`prior binding: none`);
    }
  }

  // 2. Build register() calldata
  const agentURI = normiesAgentURI(tokenId);
  console.log(`agentURI: ${agentURI}`);
  const adapterWrite = adapter.connect(signer);
  const data = adapter.interface.encodeFunctionData("register", [
    TOKEN_STANDARD.ERC721,
    c.normies,
    tokenId,
    agentURI,
  ]);
  console.log(`calldata: ${data}`);
  console.log(`to:       ${c.adapter}`);

  // 3. Gas estimate + simulation
  const txReq = { to: c.adapter, data, value: 0n };
  let gas;
  try {
    gas = await provider.estimateGas({ ...txReq, from: signer.address });
    console.log(`estimateGas: ${gas.toString()}`);
  } catch (e) {
    throw new Error(`estimateGas reverted: ${e.shortMessage || e.message}`);
  }
  const fee = await provider.getFeeData();
  console.log(`maxFeePerGas=${fee.maxFeePerGas} maxPriorityFeePerGas=${fee.maxPriorityFeePerGas} gasPrice=${fee.gasPrice}`);
  const worstCost = gas * (fee.maxFeePerGas || fee.gasPrice || 0n);
  console.log(`worst-case cost: ${ethers.formatEther(worstCost)} ETH`);
  const balance = await provider.getBalance(signer.address);
  console.log(`signer balance:  ${ethers.formatEther(balance)} ETH`);

  // 4. Static-call to recover the agentId we'd receive
  try {
    const predicted = await adapterWrite.register.staticCall(
      TOKEN_STANDARD.ERC721, c.normies, tokenId, agentURI
    );
    console.log(`predicted agentId: ${predicted.toString()}`);
  } catch (e) {
    console.log(`staticCall failed: ${e.shortMessage || e.message}`);
  }

  if (!send) {
    console.log(`\n(dry-run — pass --send to broadcast)`);
    return;
  }

  // 5. Broadcast
  console.log(`\nBroadcasting register tx...`);
  const tx = await adapterWrite.register(TOKEN_STANDARD.ERC721, c.normies, tokenId, agentURI, {
    gasLimit: (gas * 120n) / 100n,
  });
  console.log(`tx hash: ${tx.hash}`);
  console.log(`explorer: ${c.explorer}/tx/${tx.hash}`);
  const rcpt = await tx.wait();
  console.log(`mined block=${rcpt.blockNumber} status=${rcpt.status} gasUsed=${rcpt.gasUsed}`);

  // 6. Extract agentId from logs (registry IdentityRegistered event or adapter event)
  let agentId;
  for (const log of rcpt.logs) {
    try {
      const parsed = adapter.interface.parseLog(log);
      if (parsed && parsed.name === "AgentBound") {
        agentId = parsed.args.agentId.toString();
        console.log(`AgentBound: agentId=${agentId}`);
      }
    } catch {}
  }
  if (!agentId) {
    // Fallback: re-do staticCall against the post-state to read back
    console.log(`(no AgentRegistered event surfaced — checking registry directly)`);
  }
  if (agentId) await verifyBinding(agentId);

  if (chain === "mainnet" && agentId) {
    console.log(`\nWaiting for Normies indexer to pick up AgentBound...`);
    const b = await waitForIndexer(tokenId, agentId);
    if (b) {
      console.log(`indexer confirmed: agentId=${b.agentId} tx=${b.txHash}`);
      const info = await liveInfo(tokenId);
      if (info && !info._error) {
        console.log(`\n=== Live persona ===`);
        console.log(`name:         ${info.name}`);
        console.log(`type:         ${info.type}`);
        console.log(`tagline:      ${info.tagline}`);
        console.log(`greeting:     ${info.greeting}`);
        console.log(`canvas:       level=${info.canvas?.level} actionPoints=${info.canvas?.actionPoints} customized=${info.canvas?.customized}`);
      } else {
        console.log(`live persona fetch failed: ${info._error}`);
      }
    } else {
      console.log(`(indexer did not confirm within timeout — check ${NORMIES_API}/agents/binding/${tokenId} manually)`);
    }
  }
}

(async () => {
  if (verifyMode) {
    const id = positional[0];
    if (!id) { console.error("Usage: --verify <agentId>"); process.exit(2); }
    await verifyBinding(id);
    return;
  }
  const tokenId = positional[0];
  if (!tokenId) { console.error("Usage: awaken.mjs <tokenId> [--send] [--chain mainnet|base|sepolia]"); process.exit(2); }
  await awaken(tokenId);
})().catch(e => { console.error(e); process.exit(1); });
