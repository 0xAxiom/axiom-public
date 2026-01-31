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
import { createWalletClient, createPublicClient, http, encodeFunctionData, zeroAddress, keccak256, toHex } from "viem";
import { base } from "viem/chains";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { homedir } from "os";
import { join, dirname, resolve } from "path";
import { spawn } from "child_process";

// ═══════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════

// Hardcoded fee split — cannot be overridden by agents
const PROTOCOL_FEE_ADDRESS = "0x0D9945F0a591094927df47DB12ACB1081cE9F0F6"; // Axiom protocol
const BANKR_FEE_ADDRESS = "0xF60633D02690e2A15A54AB919925F3d038Df163e";    // Bankr
const AGENT_BPS = 6000;    // Agent: 60%
const PROTOCOL_BPS = 2000; // Axiom protocol: 20%
const BANKR_BPS = 2000;    // Bankr: 20%
const BASENAME_REGISTRAR = "0xa7d2607c6BD39Ae9521e514026CBB078405Ab322"; // UpgradeableRegistrarController
const BASENAME_RESOLVER = "0x426fA03fB86E510d0Dd9F70335Cf102a98b10875"; // Upgradeable L2 Resolver
const ONE_YEAR = 31557600n; // seconds

// Basename registrar ABI (UpgradeableRegistrarController)
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
          { name: "coinTypes", type: "uint256[]" },
          { name: "signatureExpiry", type: "uint256" },
          { name: "signature", type: "bytes" },
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
  {
    name: "available",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "name", type: "string" }],
    outputs: [{ name: "", type: "bool" }],
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
  --image, -i       Token image URL or local file path
  --basename, -b    Register <name>.base.eth (gasless)
  --market-cap, -m  Initial market cap in ETH (default: 10)
  --help, -h        Show this help

Fee Split (hardcoded):
  Agent 60% | Protocol 20% | Bankr 20%
  This split is enforced on-chain and cannot be overridden.

Environment Variables:
  CDP_API_KEY_ID      Coinbase Developer Platform API key ID
  CDP_API_KEY_SECRET  CDP API key secret (EC private key PEM)
  CDP_WALLET_SECRET   CDP wallet encryption secret

Examples:
  node launch.mjs --name "MyAgent" --symbol "AGENT" --description "AI agent"
  node launch.mjs --name "MyAgent" --symbol "AGENT" --image ./avatar.png
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

async function registerBasename(cdp, smartAccount, name, paymasterUrl) {
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
      smartAccount: smartAccount,
      network: "base",
      paymasterUrl,
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
// Image Upload Helper
// ═══════════════════════════════════════════════════════════════

async function processImageUrl(imageArg) {
  // If empty or already a URL, return as-is
  if (!imageArg || imageArg.startsWith('http://') || imageArg.startsWith('https://')) {
    return imageArg;
  }

  // Check if it's a local file path
  const resolvedPath = resolve(imageArg);
  if (existsSync(resolvedPath)) {
    step("📤", "Uploading image...");
    
    try {
      // Get the script directory relative to this file
      const scriptDir = dirname(new URL(import.meta.url).pathname);
      const uploadScriptPath = join(scriptDir, 'upload-image.mjs');
      
      // Upload the image using our upload script
      const uploadResult = await new Promise((resolve, reject) => {
        const child = spawn('node', [uploadScriptPath, '--file', resolvedPath], {
          stdio: ['inherit', 'pipe', 'pipe']
        });

        let stdout = '';
        let stderr = '';

        child.stdout.on('data', (data) => {
          stdout += data.toString();
        });

        child.stderr.on('data', (data) => {
          stderr += data.toString();
        });

        child.on('close', (code) => {
          if (code === 0) {
            resolve(stdout.trim());
          } else {
            reject(new Error(`Upload failed: ${stderr.trim() || 'Unknown error'}`));
          }
        });

        child.on('error', (err) => {
          reject(new Error(`Failed to start upload script: ${err.message}`));
        });
      });

      done(uploadResult);
      return uploadResult;
    } catch (error) {
      fail(`Upload failed: ${error.message}`);
      throw error;
    }
  }

  // If it's neither a URL nor a valid file path, return as-is
  // (might be a placeholder or future URL format)
  return imageArg;
}

// ═══════════════════════════════════════════════════════════════
// Step 3: Launch Token via Clanker
// ═══════════════════════════════════════════════════════════════

async function launchToken(cdp, eoaAccount, opts) {
  // Process image URL (upload if local file)
  const imageUrl = await processImageUrl(opts.image);

  step("🚀", `Launching $${opts.symbol}...`);

  try {
    const publicClient = createPublicClient({
      chain: base,
      transport: http(),
    });

    // CDP's EOA account implements viem's LocalAccount interface (signMessage, signTransaction, sign)
    // This lets us use it directly as a viem wallet signer — no ERC-4337 overhead
    const walletClient = createWalletClient({
      account: eoaAccount,
      chain: base,
      transport: http(),
    });

    // Use the high-level Clanker SDK v4 for deployment
    const { Clanker } = await import("clanker-sdk/v4");
    const clanker = new Clanker({ publicClient, wallet: walletClient });

    // Hardcoded fee split — agent gets 60%, protocol wallets get 20% each
    // Admin for protocol slots is set to the protocol wallets themselves,
    // so agents cannot change the protocol fee recipients on-chain.
    const rewardRecipients = [
      {
        recipient: eoaAccount.address,       // Agent wallet
        admin: eoaAccount.address,           // Agent controls their own slot
        bps: AGENT_BPS,                      // 60%
        token: "Both",
      },
      {
        recipient: PROTOCOL_FEE_ADDRESS,     // Axiom protocol
        admin: PROTOCOL_FEE_ADDRESS,         // Only protocol can change this
        bps: PROTOCOL_BPS,                   // 20%
        token: "Both",
      },
      {
        recipient: BANKR_FEE_ADDRESS,        // Bankr
        admin: BANKR_FEE_ADDRESS,            // Only Bankr can change this
        bps: BANKR_BPS,                      // 20%
        token: "Both",
      },
    ];

    // Deploy the token using the SDK (handles all V4 config internally)
    const { txHash, waitForTransaction, error } = await clanker.deploy({
      name: opts.name,
      symbol: opts.symbol,
      tokenAdmin: eoaAccount.address,
      image: imageUrl || "",
      metadata: {
        description: opts.description || "",
        socialMediaUrls: [],
        auditUrls: [],
      },
      context: {
        interface: "agent-launchpad",
        platform: "agent-launchpad",
        messageId: "",
        id: "",
      },
      rewards: { recipients: rewardRecipients },
    });

    if (error) throw error;

    done(truncAddr(txHash));
    console.log(`   ⏳ Waiting for confirmation...`);

    const { address: tokenAddress } = await waitForTransaction();

    if (tokenAddress) {
      console.log(`   ✅ Token deployed: ${tokenAddress}`);
    }

    return {
      txHash,
      tokenAddress,
    };
  } catch (error) {
    fail(`${error.message?.slice(0, 80) || "deployment failed"}`);

    if (error.message?.includes("insufficient") || error.message?.includes("gas") || error.message?.includes("funds")) {
      console.log(`   ℹ️  The EOA needs ETH on Base for gas (~0.005 ETH)`);
      console.log(`   ℹ️  Fund ${eoaAccount.address} with ~0.01 ETH on Base`);
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

  // Load credentials — supports both env vars and ~/.agent-launchpad/credentials.env
  let apiKeyId = process.env.CDP_API_KEY_ID;
  let apiKeySecret = process.env.CDP_API_KEY_SECRET;
  let walletSecret = process.env.CDP_WALLET_SECRET;

  // If env vars not set, try reading from wallet.env (handles multi-line PEM)
  if (!apiKeyId || !apiKeySecret) {
    try {
      // Try multiple credential file locations
      const credPaths = [
        join(homedir(), ".agent-launchpad", "credentials.env"),
        join(homedir(), ".axiom", "wallet.env"),
        join(process.cwd(), "credentials.env"),
      ];
      let envFile;
      for (const p of credPaths) {
        try { envFile = readFileSync(p, "utf-8"); break; } catch {}
      }
      if (!envFile) throw new Error("No credential file found");
      
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

  // Load paymaster URL (required for gasless smart account txs)
  let paymasterUrl = process.env.CDP_PAYMASTER_URL;
  if (!paymasterUrl) {
    try {
      const credPaths = [
        join(homedir(), ".agent-launchpad", "credentials.env"),
        join(homedir(), ".axiom", "wallet.env"),
        join(process.cwd(), "credentials.env"),
      ];
      for (const p of credPaths) {
        try {
          const f = readFileSync(p, "utf-8");
          const m = f.match(/CDP_PAYMASTER_URL="([^"]+)"/);
          if (m) { paymasterUrl = m[1]; break; }
        } catch {}
      }
    } catch {}
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

  // ═══════════════════════════════════════════════════════════════
  // STEP 1: Create Agent Wallet
  // ═══════════════════════════════════════════════════════════════
  step("📦", "Creating agent wallet...");
  const eoaAccount = await cdp.evm.createAccount();
  done(truncAddr(eoaAccount.address));

  const publicClient = createPublicClient({ chain: base, transport: http() });
  const balance = await publicClient.getBalance({ address: eoaAccount.address });
  if (balance === 0n) {
    console.log(`\n   ⚠️  Wallet has 0 ETH. Needs ~0.005 ETH for gas on Base.`);
    console.log(`   💰 Fund this address: ${eoaAccount.address}`);
    console.log(`   ⏳ Waiting for funds (checking every 10s)...\n`);

    // Poll for funding
    let funded = false;
    for (let i = 0; i < 60; i++) { // Wait up to 10 minutes
      await new Promise(r => setTimeout(r, 10000));
      const bal = await publicClient.getBalance({ address: eoaAccount.address });
      if (bal > 0n) {
        const { formatEther } = await import("viem");
        console.log(`   ✅ Funded! Balance: ${formatEther(bal)} ETH\n`);
        funded = true;
        break;
      }
      if (i % 6 === 5) console.log(`   ⏳ Still waiting... (${Math.round((i+1)*10/60)}min)`);
    }
    if (!funded) {
      console.error("   ❌ Timed out waiting for funds. Fund the wallet and re-run.");
      console.error(`   Wallet: ${eoaAccount.address}`);
      // Still save wallet info so agent can resume
      const output = {
        timestamp: new Date().toISOString(),
        walletAddress: eoaAccount.address,
        status: "awaiting_funds",
        name: opts.name,
        symbol: opts.symbol,
      };
      const filename = `launch-${opts.symbol.toLowerCase()}-${Date.now()}.json`;
      writeFileSync(filename, JSON.stringify(output, null, 2));
      console.log(`\n📄 Wallet saved to ${filename} — fund and re-run to continue.`);
      process.exit(1);
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // STEP 2: Deploy Token
  // ═══════════════════════════════════════════════════════════════
  const tokenResult = await launchToken(cdp, eoaAccount, opts);

  if (!tokenResult.tokenAddress) {
    console.error("\n❌ Token deployment failed. Check errors above.");
    process.exit(1);
  }

  // ═══════════════════════════════════════════════════════════════
  // STEP 3: Register Basename
  // ═══════════════════════════════════════════════════════════════
  if (opts.basename) {
    const label = opts.name.toLowerCase().replace(/[^a-z0-9-]/g, "");
    step("🏷️ ", `Registering ${label}.base.eth...`);

    try {
      const walletClient = createWalletClient({
        account: eoaAccount,
        chain: base,
        transport: http(),
      });

      // Check availability
      const isAvailable = await publicClient.readContract({
        address: BASENAME_REGISTRAR,
        abi: REGISTRAR_ABI,
        functionName: "available",
        args: [label],
      });

      if (!isAvailable) {
        fail(`${label}.base.eth is taken`);
      } else {
        // Get price
        const price = await publicClient.readContract({
          address: BASENAME_REGISTRAR,
          abi: REGISTRAR_ABI,
          functionName: "registerPrice",
          args: [label, ONE_YEAR],
        });
        const value = (price * 110n) / 100n; // 10% buffer

        // Register with correct struct (UpgradeableRegistrarController)
        const registerData = encodeFunctionData({
          abi: REGISTRAR_ABI,
          functionName: "register",
          args: [{
            name: label,
            owner: eoaAccount.address,
            duration: ONE_YEAR,
            resolver: BASENAME_RESOLVER,
            data: [],
            reverseRecord: true,
            coinTypes: [],
            signatureExpiry: 0n,
            signature: "0x",
          }],
        });

        const hash = await walletClient.sendTransaction({
          to: BASENAME_REGISTRAR,
          data: registerData,
          value,
        });
        const receipt = await publicClient.waitForTransactionReceipt({ hash });

        if (receipt.status === "success") {
          done(`${label}.base.eth`);
        } else {
          fail(`${label}.base.eth — tx reverted`);
        }
      }
    } catch (error) {
      fail(`${error.message?.slice(0, 60) || "registration failed"}`);
      console.log(`   ℹ️  Agent may need more ETH for basename registration (~0.001 ETH)`);
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // STEP 4: Security Audit
  // ═══════════════════════════════════════════════════════════════
  step("🔐", "Running security audit...");

  try {
    const scriptDir = dirname(new URL(import.meta.url).pathname);
    const securityResult = await new Promise((resolve, reject) => {
      const child = spawn("node", [
        join(scriptDir, "post-launch-security.mjs"),
        "--token", tokenResult.tokenAddress,
        "--wallet", eoaAccount.address,
      ], { stdio: ["inherit", "pipe", "pipe"] });

      let stdout = "";
      child.stdout.on("data", (d) => { stdout += d.toString(); });
      child.stderr.on("data", (d) => { stdout += d.toString(); });
      child.on("close", (code) => resolve({ code, output: stdout }));
      child.on("error", (err) => reject(err));
    });

    if (securityResult.code === 0) {
      done("All checks passed");
    } else {
      fail("Some checks failed");
    }
    console.log(securityResult.output);
  } catch (error) {
    fail(`Security audit error: ${error.message?.slice(0, 60)}`);
  }

  // ═══════════════════════════════════════════════════════════════
  // SUMMARY
  // ═══════════════════════════════════════════════════════════════
  const basenameLabel = opts.basename ? opts.name.toLowerCase().replace(/[^a-z0-9-]/g, "") : null;

  console.log(`
══════════════════════════════════════════════
  🤖 LAUNCH COMPLETE
══════════════════════════════════════════════

  Agent Wallet:  ${eoaAccount.address}${basenameLabel ? `\n  Basename:     ${basenameLabel}.base.eth` : ""}
  Token:         ${tokenResult.tokenAddress}
  Trade:         https://www.clanker.world/clanker/${tokenResult.tokenAddress}
  Tx:            https://basescan.org/tx/${tokenResult.txHash}

  Fee Split:
    Agent    60%  →  ${truncAddr(eoaAccount.address)}
    Protocol 20%  →  ${truncAddr(PROTOCOL_FEE_ADDRESS)}
    Bankr    20%  →  ${truncAddr(BANKR_FEE_ADDRESS)}

══════════════════════════════════════════════

  💡 Your agent wallet is managed by CDP.
     Re-access it anytime with the same CDP credentials
     and address: ${eoaAccount.address}

  📋 Next steps:
     • Claim fees: node claim-fees.mjs --token ${tokenResult.tokenAddress} --wallet ${eoaAccount.address}
     • Set up auto-claim on a cron schedule
`);

  // Save launch data
  const output = {
    timestamp: new Date().toISOString(),
    walletAddress: eoaAccount.address,
    basename: basenameLabel ? `${basenameLabel}.base.eth` : null,
    tokenAddress: tokenResult.tokenAddress,
    txHash: tokenResult.txHash,
    name: opts.name,
    symbol: opts.symbol,
    feeRecipients: {
      agent: { address: eoaAccount.address, bps: AGENT_BPS },
      protocol: { address: PROTOCOL_FEE_ADDRESS, bps: PROTOCOL_BPS },
      bankr: { address: BANKR_FEE_ADDRESS, bps: BANKR_BPS },
    },
    feeSplit: "Agent 60% / Protocol 20% / Bankr 20%",
    clankerUrl: `https://www.clanker.world/clanker/${tokenResult.tokenAddress}`,
    basescanUrl: `https://basescan.org/tx/${tokenResult.txHash}`,
  };

  const filename = `launch-${opts.symbol.toLowerCase()}-${Date.now()}.json`;
  writeFileSync(filename, JSON.stringify(output, null, 2));
  console.log(`📄 Launch data saved to ${filename}`);
}

main().catch((error) => {
  console.error("\n💥 Unexpected error:", error.message);
  if (process.env.DEBUG) console.error(error);
  process.exit(1);
});
