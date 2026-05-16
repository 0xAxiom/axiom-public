import { ethers } from "ethers";
import fs from "node:fs";

export const CHAINS = {
  mainnet: {
    chainId: 1,
    rpc: () => process.env.MAINNET_RPC_URL || `https://mainnet.infura.io/v3/${process.env.INFURA_API_KEY}`,
    adapter: "0xde152AfB7db5373F34876E1499fbD893A82dD336",
    registry: "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432",
    normies: "0x9eb6e2025b64f340691e424b7fe7022ffde12438",
    explorer: "https://etherscan.io",
  },
  base: {
    chainId: 8453,
    rpc: () => process.env.BASE_RPC_URL,
    adapter: "0x270d25D2c59A8bcA1B0f40ad95fF7806c0025c27",
    registry: "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432",
    explorer: "https://basescan.org",
  },
  sepolia: {
    chainId: 11155111,
    rpc: () => process.env.SEPOLIA_RPC_URL || `https://sepolia.infura.io/v3/${process.env.INFURA_API_KEY}`,
    adapter: "0x7621630cB63a73a194f45A3E6801B8C6A7eC2f92",
    registry: "0x8004A818BFB912233c491871b3d84c89A494BD9e",
    explorer: "https://sepolia.etherscan.io",
  },
};

export const TOKEN_STANDARD = { ERC721: 0, ERC1155: 1, ERC6909: 2 };

export const ADAPTER_ABI = [
  "function register(uint8 standard, address tokenContract, uint256 tokenId, string agentURI) external returns (uint256 agentId)",
  "function bindingOf(uint256 agentId) view returns (tuple(uint8 standard, address tokenContract, uint256 tokenId))",
  "function isController(uint256 agentId, address account) view returns (bool)",
  "function setAgentURI(uint256 agentId, string newURI) external",
  "function setMetadata(uint256 agentId, string metadataKey, bytes metadataValue) external",
  "function setAgentWallet(uint256 agentId, address newWallet, uint256 deadline, bytes signature) external",
  "function unsetAgentWallet(uint256 agentId) external",
  "function identityRegistry() view returns (address)",
  "function tokenURI(uint256 agentId) view returns (string)",
  "function getAgentWallet(uint256 agentId) view returns (address)",
  "function getMetadata(uint256 agentId, string metadataKey) view returns (bytes)",
  "function registrationHash(address tokenContract, uint256 tokenId) view returns (bytes32)",
  "function BINDING_METADATA_KEY() view returns (string)",
  "event AgentBound(uint256 indexed agentId, uint8 indexed standard, address indexed tokenContract, uint256 tokenId, address registeredBy)",
];

export const REGISTRY_ABI = [
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function tokenURI(uint256 tokenId) view returns (string)",
  "function getAgentWallet(uint256 agentId) view returns (address)",
  "function getMetadata(uint256 agentId, string metadataKey) view returns (bytes)",
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "event Registered(uint256 indexed agentId, string agentURI, address indexed owner)",
];

export const ERC721_ABI = [
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function tokenURI(uint256 tokenId) view returns (string)",
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
];

export function normiesAgentURI(tokenId) {
  return `https://api.normies.art/agents/metadata/${tokenId}`;
}

export function loadEnv() {
  if (process.env.AXIOM_WALLET_ADDRESS && process.env.NET_PRIVATE_KEY) return;
  const path = `${process.env.HOME}/.axiom/wallet.env`;
  if (!fs.existsSync(path)) return;
  const text = fs.readFileSync(path, "utf8");
  for (const line of text.split("\n")) {
    const m = line.match(/^export ([A-Z_]+)=(.+)$/);
    if (!m) continue;
    let v = m[2].trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    if (v.startsWith("$")) v = process.env[v.slice(1)] ?? v;
    if (!process.env[m[1]]) process.env[m[1]] = v;
  }
}

export function getProvider(chain = "mainnet") {
  loadEnv();
  const c = CHAINS[chain];
  const url = typeof c.rpc === "function" ? c.rpc() : c.rpc;
  if (!url) throw new Error(`No RPC configured for ${chain}`);
  return new ethers.JsonRpcProvider(url, c.chainId);
}

export function getSigner(chain = "mainnet") {
  loadEnv();
  const pk = process.env.NET_PRIVATE_KEY;
  if (!pk) throw new Error("NET_PRIVATE_KEY not set");
  return new ethers.Wallet(pk, getProvider(chain));
}
