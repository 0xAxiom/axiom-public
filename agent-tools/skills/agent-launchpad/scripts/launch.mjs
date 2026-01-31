#!/usr/bin/env node
/**
 * launch.mjs — Agent Launchpad
 * 
 * One command to take any AI agent onchain:
 * 1. Create a smart wallet (ERC-4337, gasless via CDP paymaster)
 * 2. Optionally register a Basename (<name>.base.eth)
 * 3. Launch a token via Clanker v4 on Base
 * 
 * Usage:
 *   node launch.mjs --name "MyAgent" --symbol "AGENT" --description "What I do"
 *   node launch.mjs --name "MyAgent" --symbol "AGENT" --description "What I do" --basename
 *   node launch.mjs --name "MyAgent" --symbol "AGENT" --description "What I do" --image "https://..."
 * 
 * Environment:
 *   CDP_API_KEY_ID, CDP_API_KEY_SECRET, CDP_WALLET_SECRET
 */

import { CdpClient } from "@coinbase/cdp-sdk";
import { getTickFromMarketCap, WETH_ADDRESSES, POOL_POSITIONS, PoolPositions, FEE_CONFIGS, FeeConfigs, CLANKERS, clankerConfigFor, ClankerDeployments } from "clanker-sdk";
import { createWalletClient, createPublicClient, http, encodeFunctionData, zeroAddress } from "viem";
import { base } from "viem/chains";
import { readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

// ═══════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════

const MELTEDMINDZ_ADDRESS = "0x0D9945F0a591094927df47DB12ACB1081cE9F0F6"; // Hardware wallet
const BASENAME_REGISTRAR = "0xd3e6775ed9b7dc12b205c8e608dc3767b9e5efda";
const BASENAME_RESOLVER = "0xC6d566A56A1aFf6508b41f6c90ff131615583BCD"; // Base L2 resolver
const ONE_YEAR = 31557600n; // seconds

// Basename registrar ABI (just the register function)
const REGISTRAR_ABI = [
  {
    name: "register",
    type: "function",
    stateMutability: "payable",
    inputs: [
      {
        name: "request",
        type: "tuple",
        components: [
          { name: "name", type: "string" },
          { name: "owner", type: "address" },
          { name: "duration", type: "uint256" },
          { name: "resolver", type: "address" },
          { name: "data", type: "bytes[]" },
          { name: "reverseRecord", type: "bool" },
        ],
      },
    ],
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
];

// ═══════════════════════════════════════════════════════════════
// CLI Argument Parsing
// ═══════════════════════════════════════════════════════════════

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    name: null,
    symbol: null,
    description: "",
    image: "",
    basename: false,
    marketCap: 10, // ETH
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--name":
      case "-n":
        opts.name = args[++i];
        break;
      case "--symbol":
      case "-s":
        opts.symbol = args[++i];
        break;
      case "--description":
      case "-d":
        opts.description = args[++i] || "";
        break;
      case "--image":
      case "-i":
        opts.image = args[++i] || "";
        break;
      case "--basename":
      case "-b":
        opts.basename = true;
        break;
      case "--market-cap":
      case "-m":
        opts.marketCap = parseFloat(args[++i]);
        break;
      case "--help":
      case "-h":
        opts.help = true;
        break;
    }
  }

  return opts;
}

function showHelp() {
  console.log(`
🤖 Agent Launchpad
═══════════════════

Take any AI agent onchain in one command.

Usage:
  node launch.mjs --name "MyAgent" --symbol "AGENT" [options]

Required:
  --name, -n        Token name (e.g., "MyAgent")
  --symbol, -s      Token symbol (e.g., "AGENT")

Optional:
  --description, -d Token description
  --image, -i       Token image URL
  --basename, -b    Register <name>.base.eth (gasless)
  --market-cap, -m  Initial market cap in ETH (default: 10)
  --help, -h        Show this help

Environment Variables:
  CDP_API_KEY_ID      Coinbase Developer Platform API key ID
  CDP_API_KEY_SECRET  CDP API key secret (EC private key PEM)
  CDP_WALLET_SECRET   CDP wallet encryption secret

Example:
  node launch.mjs --name "Axiom" --symbol "AXM" --description "AI research agent" --basename
`);
}

// ═══════════════════════════════════════════════════════════════
// Pretty Output Helpers
// ═══════════════════════════════════════════════════════════════

const truncAddr = (addr) => `${addr.slice(0, 6)}...${addr.slice(-4)}`;

function step(emoji, text) {
  process.stdout.write(`${emoji} ${text.padEnd(36)}`);
}

function done(text) {
  console.log(`✅ ${text}`);
}

function fail(text) {
  console.log(`❌ ${text}`);
}

// ═══════════════════════════════════════════════════════════════
// Step 1: Create Smart Wallet
// ═══════════════════════════════════════════════════════════════

async function createWallet(cdp) {
  step("📦", "Creating smart wallet...");

  // Create an EOA (server-managed key)
  const eoaAccount = await cdp.evm.createAccount();

  // Create an ERC-4337 smart account owned by the EOA
  const smartAccount = await cdp.evm.createSmartAccount({
    owner: eoaAccount,
  });

  done(truncAddr(smartAccount.address));

  return { eoaAccount, smartAccount };
}

// ═══════════════════════════════════════════════════════════════
// Step 2: Register Basename (Optional)
// ═══════════════════════════════════════════════════════════════
// NOTE: This function is WIP/broken - basename registration is temporarily disabled

async function registerBasename(cdp, smartAccount, name) {
  const label = name.toLowerCase().replace(/[^a-z0-9-]/g, "");
  const fullName = `${label}.base.eth`;

  step("🏷️ ", `Registering ${fullName}...`);

  try {
    // Build the registration calldata
    const registerData = encodeFunctionData({
      abi: REGISTRAR_ABI,
      functionName: "register",
      args: [
        {
          name: label,
          owner: smartAccount.address,
          duration: ONE_YEAR,
          resolver: BASENAME_RESOLVER,
          data: [],
          reverseRecord: true,
        },
      ],
    });

    // Get the registration price
    const publicClient = createPublicClient({
      chain: base,
      transport: http(),
    });

    let price;
    try {
      price = await publicClient.readContract({
        address: BASENAME_REGISTRAR,
        abi: REGISTRAR_ABI,
        functionName: "registerPrice",
        args: [label, ONE_YEAR],
      });
    } catch {
      // Default to ~0.001 ETH if price check fails
      price = 1000000000000000n; // 0.001 ETH
    }

    // Add 10% buffer for price fluctuation
    const value = (price * 110n) / 100n;

    // Send via smart account user operation (gasless via paymaster)
    const sendResult = await cdp.evm.sendUserOperation({
      smartAccount: smartAccount, // The smart account object (not just address)
      network: "base",
      calls: [{
        to: BASENAME_REGISTRAR,
        data: registerData,
        value,
      }],
    });

    // Wait for user operation to be confirmed and get the actual transaction hash
    const waitResult = await cdp.evm.waitForUserOperation({
      smartAccount,
      userOpHash: sendResult.userOpHash
    });

    done(`${fullName} (gas sponsored)`);
    return { basename: fullName, txHash: waitResult?.transactionHash };
  } catch (error) {
    // Basename registration can fail for many reasons (taken, needs funds, etc.)
    fail(`${fullName} — ${error.message?.slice(0, 60) || "failed"}`);
    console.log(`   ℹ️  The smart account may need ETH for the name registration fee`);
    console.log(`   ℹ️  Fund ${smartAccount.address} with ~0.002 ETH on Base`);
    return { basename: null, error: error.message };
  }
}

// ═══════════════════════════════════════════════════════════════
// Step 3: Launch Token via Clanker
// ═══════════════════════════════════════════════════════════════

async function launchToken(cdp, smartAccount, opts) {
  step("🚀", `Launching $${opts.symbol}...`);

  try {
    const publicClient = createPublicClient({
      chain: base,
      transport: http(),
    });

    // Get the Clanker V4 deployment config for Base (chainId 8453)
    const clankerConfig = CLANKERS["clanker_v4"];

    if (!clankerConfig) {
      throw new Error("Clanker V4 config not found for Base");
    }

    // Calculate pool tick for target market cap
    const tickInfo = getTickFromMarketCap(opts.marketCap);

    // Get pool positions and fee config from SDK
    const poolPositions = POOL_POSITIONS[PoolPositions.Standard];
    const feeConfig = FEE_CONFIGS[FeeConfigs.DynamicBasic];

    // Build the V4 DeploymentConfig struct matching the contract ABI:
    // DeploymentConfig = { TokenConfig, PoolConfig, LockerConfig, MevModuleConfig, ExtensionConfig[] }
    const deploymentConfig = {
      // TokenConfig
      tokenConfig: {
        tokenAdmin: smartAccount.address,
        name: opts.name,
        symbol: opts.symbol,
        salt: "0x" + "00".repeat(32),
        image: opts.image || "",
        metadata: JSON.stringify({
          description: opts.description,
          launchedBy: "Agent Launchpad by MeltedMindz",
          agentWallet: smartAccount.address,
        }),
        context: "Launched via Agent Launchpad",
        originatingChainId: 8453n,
      },
      // PoolConfig
      poolConfig: {
        hook: clankerConfig.related.feeDynamicHook, // Dynamic fee hook
        pairedToken: WETH_ADDRESSES[8453],
        tickIfToken0IsClanker: tickInfo.tickIfToken0IsClanker,
        tickSpacing: feeConfig?.tickSpacing || 200, // SDK returns undefined, fallback 200 is correct for Standard pool positions
        poolData: "0x", // Hook initialization data
      },
      // LockerConfig — reward recipients go here as parallel arrays
      lockerConfig: {
        locker: clankerConfig.related.locker,
        rewardAdmins: [smartAccount.address, MELTEDMINDZ_ADDRESS],
        rewardRecipients: [smartAccount.address, MELTEDMINDZ_ADDRESS],
        rewardBps: [6000, 4000], // Agent 60%, MeltedMindz 40%
        tickLower: poolPositions.map(p => p.tickLower),
        tickUpper: poolPositions.map(p => p.tickUpper),
        positionBps: poolPositions.map(p => p.positionBps),
        lockerData: "0x",
      },
      // MevModuleConfig — no MEV protection for now
      mevModuleConfig: {
        mevModule: zeroAddress,
        mevModuleData: "0x",
      },
      // ExtensionConfig[] — no extensions
      extensionConfigs: [],
    };

    // Encode the deployToken calldata
    const deployData = encodeFunctionData({
      abi: clankerConfig.abi,
      functionName: "deployToken",
      args: [deploymentConfig],
    });

    // Send via CDP smart account (gasless via paymaster)
    const sendResult = await cdp.evm.sendUserOperation({
      smartAccount: smartAccount, // The smart account object (not just address)
      network: "base", 
      calls: [{
        to: clankerConfig.address,
        data: deployData,
        value: 0n,
      }],
    });

    // Wait for user operation to be confirmed and get the actual transaction hash
    const waitResult = await cdp.evm.waitForUserOperation({
      smartAccount,
      userOpHash: sendResult.userOpHash
    });

    const txHash = waitResult?.transactionHash;
    done(truncAddr(txHash));
    console.log(`   ⏳ Waiting for confirmation...`);

    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

    // Extract token address from TokenCreated event or Transfer event
    let tokenAddress = null;
    for (const log of receipt.logs) {
      // Transfer event from token minting (first Transfer from 0x0 is token creation)
      if (log.topics[0] === "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef" &&
          log.topics[1] === "0x0000000000000000000000000000000000000000000000000000000000000000") {
        tokenAddress = log.address;
        break;
      }
    }

    if (tokenAddress) {
      console.log(`   ✅ Token deployed: ${tokenAddress}`);
    }

    return {
      txHash,
      tokenAddress,
    };
  } catch (error) {
    fail(`${error.message?.slice(0, 80) || "deployment failed"}`);

    if (error.message?.includes("insufficient") || error.message?.includes("gas")) {
      console.log(`   ℹ️  The smart account may need ETH on Base for the Clanker deployment`);
      console.log(`   ℹ️  Fund ${smartAccount.address} with ~0.01 ETH on Base`);
    }

    return { tokenAddress: null, error: error.message };
  }
}

// ═══════════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════════

async function main() {
  const opts = parseArgs();

  if (opts.help || !opts.name || !opts.symbol) {
    showHelp();
    process.exit(opts.help ? 0 : 1);
  }

  console.log(`
🤖 Agent Launchpad
═══════════════════
`);

  // Load credentials — supports both env vars and ~/.axiom/wallet.env
  let apiKeyId = process.env.CDP_API_KEY_ID;
  let apiKeySecret = process.env.CDP_API_KEY_SECRET;
  let walletSecret = process.env.CDP_WALLET_SECRET;

  // If env vars not set, try reading from wallet.env (handles multi-line PEM)
  if (!apiKeyId || !apiKeySecret) {
    try {
      const envFile = readFileSync(join(homedir(), ".axiom/wallet.env"), "utf-8");
      
      if (!apiKeyId) {
        const m = envFile.match(/CDP_API_KEY_ID="([^"]+)"/);
        if (m) apiKeyId = m[1];
      }
      if (!apiKeySecret) {
        const m = envFile.match(/CDP_API_KEY_SECRET="(-----BEGIN[\s\S]*?-----END[^"]+)"/);
        if (m) apiKeySecret = m[1].trim();
      }
      if (!walletSecret) {
        const m = envFile.match(/CDP_WALLET_SECRET="([^"]+)"/);
        if (m) walletSecret = m[1];
      }
    } catch { /* wallet.env not found, that's ok */ }
  }

  if (!apiKeyId || !apiKeySecret) {
    console.error("❌ Missing CDP credentials. Set CDP_API_KEY_ID and CDP_API_KEY_SECRET.");
    console.error("   See README.md for setup instructions.");
    process.exit(1);
  }

  // Initialize CDP client
  const cdpOpts = { apiKeyId, apiKeySecret };
  if (walletSecret) cdpOpts.walletSecret = walletSecret;
  const cdp = new CdpClient(cdpOpts);

  // Step 1: Create wallet
  const { eoaAccount, smartAccount } = await createWallet(cdp);

  // Step 2: Register basename (optional) - TEMPORARILY DISABLED
  let basenameResult = { basename: null };
  // if (opts.basename) {
  //   basenameResult = await registerBasename(cdp, smartAccount, opts.name);
  // }

  // Step 3: Launch token (uses CDP smart account for gasless tx)
  const tokenResult = await launchToken(cdp, smartAccount, opts);

  // ── Summary ──
  console.log(`
── Summary ────────────────────────────────
  EOA:       ${eoaAccount.address}
  Wallet:    ${smartAccount.address}${basenameResult.basename ? `\n  Name:      ${basenameResult.basename}` : ""}${tokenResult.tokenAddress ? `\n  Token:     ${tokenResult.tokenAddress}` : ""}${tokenResult.txHash ? `\n  Tx:        https://basescan.org/tx/${tokenResult.txHash}` : ""}${tokenResult.tokenAddress ? `\n  Trade:     https://www.clanker.world/clanker/${tokenResult.tokenAddress}` : ""}
  Fee split: Agent 60% | MeltedMindz 40%
  Basename registration coming soon
───────────────────────────────────────────

💡 Save your EOA address — it owns the smart account.
   The smart account address is your agent's onchain identity.
${tokenResult.tokenAddress ? `\n🎉 $${opts.symbol} is live! Share the Clanker link above.` : ""}
`);

  // Save launch data to JSON file for state persistence
  const output = {
    timestamp: new Date().toISOString(),
    eoaAddress: eoaAccount.address,
    smartAccountAddress: smartAccount.address,
    tokenAddress: tokenResult.tokenAddress,
    txHash: tokenResult.txHash,
    name: opts.name,
    symbol: opts.symbol,
    feeRecipient: MELTEDMINDZ_ADDRESS,
    feeSplit: "Agent 60% / MeltedMindz 40%",
    clankerUrl: tokenResult.tokenAddress ? `https://www.clanker.world/clanker/${tokenResult.tokenAddress}` : null,
    basescanUrl: tokenResult.txHash ? `https://basescan.org/tx/${tokenResult.txHash}` : null,
  };
  
  const filename = `launch-${opts.symbol.toLowerCase()}-${Date.now()}.json`;
  writeFileSync(filename, JSON.stringify(output, null, 2));
  console.log(`\n📄 Launch data saved to ${filename}`);
}

main().catch((error) => {
  console.error("\n💥 Unexpected error:", error.message);
  if (process.env.DEBUG) console.error(error);
  process.exit(1);
});
