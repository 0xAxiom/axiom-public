/**
 * shared.mjs — Common config, ABIs, and helpers for pitch-submit scripts
 */

import { createPublicClient, createWalletClient, http, parseAbi, formatUnits, parseUnits } from 'viem';
import { base } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';

// ─── Config ───────────────────────────────────────────────────────────

export const CONFIG = {
  chainId: 8453,
  rpcUrl: process.env.BASE_RPC_URL || 'https://mainnet.base.org',
  usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  usdcDecimals: 6,
  pitchFee: process.env.PITCH_FEE || '10',              // USDC
  fundWallet: process.env.FUND_WALLET || '0x523Eff3dB03938eaa31a5a6FBd41E3B9d23edde5',
  pitchRegistry: process.env.PITCH_REGISTRY || null,     // deploy address TBD
  agentRegistry: process.env.AGENT_REGISTRY || null,     // ERC-8004 registry TBD
};

// ─── ABIs ─────────────────────────────────────────────────────────────

export const USDC_ABI = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function decimals() view returns (uint8)',
]);

export const ERC8004_ABI = parseAbi([
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function balanceOf(address owner) view returns (uint256)',
  'function tokenOfOwnerByIndex(address owner, uint256 index) view returns (uint256)',
  'function tokenURI(uint256 tokenId) view returns (string)',
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function totalSupply() view returns (uint256)',
]);

export const PITCH_REGISTRY_ABI = [
  {
    type: 'function', name: 'submitPitch', stateMutability: 'nonpayable',
    inputs: [{ name: 'pitchData', type: 'bytes' }],
    outputs: [{ name: 'pitchId', type: 'uint256' }],
  },
  {
    type: 'function', name: 'getPitch', stateMutability: 'view',
    inputs: [{ name: 'pitchId', type: 'uint256' }],
    outputs: [{
      name: 'pitch', type: 'tuple',
      components: [
        { name: 'pitchId', type: 'uint256' },
        { name: 'agentId', type: 'uint256' },
        { name: 'submitter', type: 'address' },
        { name: 'pitchData', type: 'bytes' },
        { name: 'askAmountUSDC', type: 'uint256' },
        { name: 'submittedAt', type: 'uint256' },
        { name: 'status', type: 'uint8' },
        { name: 'score', type: 'uint8' },
        { name: 'ddNotes', type: 'string' },
      ],
    }],
  },
  {
    type: 'function', name: 'getPitchesByAgent', stateMutability: 'view',
    inputs: [{ name: 'agentId', type: 'uint256' }],
    outputs: [{ name: 'pitchIds', type: 'uint256[]' }],
  },
  {
    type: 'function', name: 'pitchCount', stateMutability: 'view',
    inputs: [], outputs: [{ name: 'count', type: 'uint256' }],
  },
  {
    type: 'function', name: 'pitchFee', stateMutability: 'view',
    inputs: [], outputs: [{ name: 'fee', type: 'uint256' }],
  },
  {
    type: 'function', name: 'agentRegistry', stateMutability: 'view',
    inputs: [], outputs: [{ name: 'registry', type: 'address' }],
  },
  {
    type: 'function', name: 'scorePitch', stateMutability: 'nonpayable',
    inputs: [
      { name: 'pitchId', type: 'uint256' },
      { name: 'score', type: 'uint8' },
      { name: 'notes', type: 'string' },
    ],
    outputs: [],
  },
  {
    type: 'function', name: 'setPitchStatus', stateMutability: 'nonpayable',
    inputs: [
      { name: 'pitchId', type: 'uint256' },
      { name: 'newStatus', type: 'uint8' },
    ],
    outputs: [],
  },
  {
    type: 'event', name: 'PitchSubmitted',
    inputs: [
      { name: 'pitchId', type: 'uint256', indexed: true },
      { name: 'agentId', type: 'uint256', indexed: true },
      { name: 'submitter', type: 'address', indexed: true },
      { name: 'askAmountUSDC', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event', name: 'PitchScored',
    inputs: [
      { name: 'pitchId', type: 'uint256', indexed: true },
      { name: 'score', type: 'uint8', indexed: false },
      { name: 'notes', type: 'string', indexed: false },
    ],
  },
];

// ─── Clients ──────────────────────────────────────────────────────────

export function getPublicClient() {
  return createPublicClient({
    chain: base,
    transport: http(CONFIG.rpcUrl),
  });
}

export function getWalletClient() {
  const key = process.env.NET_PRIVATE_KEY;
  if (!key) {
    console.error('❌ NET_PRIVATE_KEY not set. Export it or add to ~/.axiom/wallet.env');
    process.exit(1);
  }
  const account = privateKeyToAccount(key);
  return createWalletClient({
    account,
    chain: base,
    transport: http(CONFIG.rpcUrl),
  });
}

export function getAccount() {
  const key = process.env.NET_PRIVATE_KEY;
  if (!key) {
    console.error('❌ NET_PRIVATE_KEY not set.');
    process.exit(1);
  }
  return privateKeyToAccount(key);
}

// ─── Helpers ──────────────────────────────────────────────────────────

export function parseUSDC(amount) {
  return parseUnits(String(amount), CONFIG.usdcDecimals);
}

export function formatUSDC(amount) {
  return formatUnits(amount, CONFIG.usdcDecimals);
}

export function requireAddress(addr, label) {
  if (!addr || !/^0x[a-fA-F0-9]{40}$/.test(addr)) {
    console.error(`❌ Invalid ${label}: ${addr}`);
    process.exit(1);
  }
  return addr;
}

export function parseArgs(argv = process.argv.slice(2)) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      const val = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true;
      args[key] = val;
      if (val !== true) i++;
    }
  }
  return args;
}

export const STATUS_LABELS = ['Submitted', 'In Review', 'Scored', 'Funded', 'Rejected'];
