#!/usr/bin/env node
/**
 * basename-registrar.mjs — Register basenames for agents using a protocol smart account
 * 
 * Uses ONE CDP smart account (protocol-owned) + paymaster to register basenames
 * for any agent. Gas is fully sponsored — agents pay nothing.
 * 
 * The protocol smart account is created once and reused for all registrations.
 * The basename owner is set to the AGENT's address, not the protocol account.
 */

import { CdpClient } from "@coinbase/cdp-sdk";
import { createPublicClient, http, encodeFunctionData, parseEther, formatEther } from "viem";
import { base } from "viem/chains";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";

// Basename contracts (Base mainnet)
const BASENAME_REGISTRAR = "0xa7d2607c6BD39Ae9521e514026CBB078405Ab322"; // Upgradeable Registrar Controller
const BASENAME_RESOLVER = "0x426fA03fB86E510d0Dd9F70335Cf102a98b10875"; // Upgradeable L2 Resolver
const ONE_YEAR = 31557600n;

const REGISTRAR_ABI = [
  {
    name: "register",
    type: "function",
    stateMutability: "payable",
    inputs: [{
      name: "request",
      type: "tuple",
      components: [
        { name: "name", type: "string" },
        { name: "owner", type: "address" },
        { name: "duration", type: "uint256" },
        { name: "resolver", type: "address" },
        { name: "data", type: "bytes[]" },
        { name: "reverseRecord", type: "bool" },
        { name: "coinTypes", type: "uint256[]" },
        { name: "signatureExpiry", type: "uint256" },
        { name: "signature", type: "bytes" },
      ],
    }],
    outputs: [],
  },
  {
    name: "registerPrice",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "name", type: "string" },
      { name: "duration", type: "uint256" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "available",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "name", type: "string" }],
    outputs: [{ name: "", type: "bool" }],
  },
];

// ═══════════════════════════════════════════════════════════════
// State — Protocol Smart Account
// ═══════════════════════════════════════════════════════════════

const STATE_FILE = join(homedir(), '.agent-launchpad', 'protocol-account.json');

function loadProtocolAccount() {
  try {
    if (existsSync(STATE_FILE)) {
      return JSON.parse(readFileSync(STATE_FILE, 'utf-8'));
    }
  } catch {}
  return null;
}

function saveProtocolAccount(data) {
  const dir = join(homedir(), '.agent-launchpad');
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(STATE_FILE, JSON.stringify(data, null, 2));
}

// ═══════════════════════════════════════════════════════════════
// Initialize CDP + Protocol Account
// ═══════════════════════════════════════════════════════════════

export async function initProtocol(env) {
  const cdpOpts = {
    apiKeyId: env.CDP_API_KEY_ID,
    apiKeySecret: env.CDP_API_KEY_SECRET,
  };
  if (env.CDP_WALLET_SECRET) cdpOpts.walletSecret = env.CDP_WALLET_SECRET;
  
  const cdp = new CdpClient(cdpOpts);
  const publicClient = createPublicClient({ chain: base, transport: http() });

  // Get or create protocol SMART account (needed for sendUserOperation + paymaster)
  let saved = loadProtocolAccount();
  let ownerAccount, smartAccount;
  
  if (!saved || !saved.smartAccountAddress) {
    console.log('🔧 Creating protocol smart account...');
    ownerAccount = await cdp.evm.createAccount({ network: "base" });
    smartAccount = await cdp.evm.createSmartAccount({ owner: ownerAccount });
    saved = { 
      ownerAddress: ownerAccount.address, 
      smartAccountAddress: smartAccount.address, 
      network: "base" 
    };
    saveProtocolAccount(saved);
    console.log(`✅ Protocol smart account: ${smartAccount.address} (owner: ${ownerAccount.address})`);
  } else {
    // Restore account objects from saved addresses
    ownerAccount = await cdp.evm.getAccount({ address: saved.ownerAddress });
    smartAccount = await cdp.evm.getSmartAccount({ address: saved.smartAccountAddress, owner: ownerAccount });
  }

  return { cdp, publicClient, protocolAddress: saved.smartAccountAddress, smartAccount };
}

// ═══════════════════════════════════════════════════════════════
// Register Basename
// ═══════════════════════════════════════════════════════════════

export async function registerBasename({ cdp, publicClient, protocolAddress, smartAccount, name, ownerAddress, paymasterUrl }) {
  // Check availability
  const isAvailable = await publicClient.readContract({
    address: BASENAME_REGISTRAR,
    abi: REGISTRAR_ABI,
    functionName: "available",
    args: [name],
  });

  if (!isAvailable) {
    return { success: false, error: `${name}.base.eth is taken` };
  }

  // Get price
  const price = await publicClient.readContract({
    address: BASENAME_REGISTRAR,
    abi: REGISTRAR_ABI,
    functionName: "registerPrice",
    args: [name, ONE_YEAR],
  });
  const value = (price * 110n) / 100n; // 10% buffer

  // Build register calldata — owner is the AGENT's address
  const registerData = encodeFunctionData({
    abi: REGISTRAR_ABI,
    functionName: "register",
    args: [{
      name,
      owner: ownerAddress,        // Agent owns the basename
      duration: ONE_YEAR,
      resolver: BASENAME_RESOLVER,
      data: [],
      reverseRecord: false,       // Don't set reverse for protocol account
      coinTypes: [],
      signatureExpiry: 0n,
      signature: "0x",
    }],
  });

  // Send via CDP smart account with paymaster (gasless)
  try {
    const txResult = await cdp.evm.sendUserOperation({
      smartAccount,
      calls: [{
        to: BASENAME_REGISTRAR,
        data: registerData,
        value,
      }],
      network: "base",
      paymasterUrl,
    });

    const txHash = txResult.userOpHash || txResult.transactionHash;

    // Wait for confirmation
    const receipt = await publicClient.waitForTransactionReceipt({
      hash: txHash,
      confirmations: 1,
    });

    if (receipt.status === "success") {
      return {
        success: true,
        basename: `${name}.base.eth`,
        owner: ownerAddress,
        txHash,
        cost: formatEther(price),
      };
    } else {
      return { success: false, error: "Transaction reverted" };
    }
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// ═══════════════════════════════════════════════════════════════
// Generate Name Candidates
// ═══════════════════════════════════════════════════════════════

export function generateCandidates(name) {
  const clean = name.toLowerCase().replace(/[^a-z0-9]/g, '');
  const short = clean.slice(0, 8);
  return [
    clean,                          // scoutai
    short,                          // scoutai
    `${clean}agent`,               // scoutaiagent
    `${short}0x`,                  // scoutai0x
    `${clean}${Math.floor(Math.random() * 999)}`, // scoutai742
  ].filter((v, i, a) => a.indexOf(v) === i); // dedupe
}

// ═══════════════════════════════════════════════════════════════
// Find and Register (with fallbacks)
// ═══════════════════════════════════════════════════════════════

export async function findAndRegister({ cdp, publicClient, protocolAddress, smartAccount, name, ownerAddress, paymasterUrl }) {
  const candidates = generateCandidates(name);

  for (const candidate of candidates) {
    const result = await registerBasename({
      cdp, publicClient, protocolAddress, smartAccount,
      name: candidate,
      ownerAddress,
      paymasterUrl,
    });

    if (result.success) return result;
    if (result.error && !result.error.includes('taken')) {
      return result; // Real error, not just name taken
    }
  }

  return { success: false, error: 'All name candidates taken' };
}
