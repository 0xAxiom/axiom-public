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
import { createPublicClient, http, encodeFunctionData } from "viem";
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

  // Auto-derive symbol from name if not provided
  if (opts.name && !opts.symbol) {
    // Take first word, uppercase, max 10 chars
    opts.symbol = opts.name
      .replace(/[^a-zA-Z0-9\s]/g, "")
      .split(/\s+/)[0]
      .toUpperCase()
      .slice(0, 10);
  }

  return opts;
}

// ═══════════════════════════════════════════════════════════════
// Basename Auto-Naming with Fallbacks
// ═══════════════════════════════════════════════════════════════

function generateBasenameCandidates(name, symbol) {
  const base = name.toLowerCase().replace(/[^a-z0-9]/g, "");
  const sym = symbol.toLowerCase().replace(/[^a-z0-9]/g, "");

  // Generate candidates in priority order
  const candidates = [
    base,                    // scoutai
    sym,                     // scout
    `${base}bot`,            // scoutaibot
    `${sym}bot`,             // scoutbot
    `${base}0x`,             // scoutai0x
    `${sym}0x`,              // scout0x
    `${base}agent`,          // scoutaiagent
    `${sym}agent`,           // scoutagent
    `${sym}ai`,              // scoutai
    `${base}x`,              // scoutaix
    `${sym}x`,               // scoutx
  ];

  // Deduplicate while preserving order
  return [...new Set(candidates)].filter(c => c.length >= 3);
}

function showHelp() {
  console.log(`
🤖 Agent Launchpad
═══════════════════

Take any AI agent onchain in one command.
Creates wallet, deploys token, registers basename, runs security audit.

Usage:
  node launch.mjs --name "ScoutAI" [options]

Required:
  --name, -n        Agent/token name (e.g., "ScoutAI")

Optional:
  --symbol, -s      Token symbol (auto-derived from name if omitted, e.g., "SCOUTAI")
  --description, -d Token description
  --image, -i       Token image URL or local file path
  --market-cap, -m  Initial market cap in ETH (default: 10)
  --help, -h        Show this help

Automatic:
  • Symbol auto-derived from name (first word, uppercase)
  • Basename always registered with fallbacks:
    name → namebot → name0x → nameagent → symbol variants
  • Security audit runs after deployment
  • All gas sponsored by CDP paymaster (gasless)

Fee Split (hardcoded, enforced on-chain):
  Agent 60% | Protocol 20% | Bankr 20%

Environment Variables:
  CDP_API_KEY_ID      Coinbase Developer Platform API key ID
  CDP_API_KEY_SECRET  CDP API key secret (EC private key PEM)
  CDP_WALLET_SECRET   CDP wallet encryption secret
  CDP_PAYMASTER_URL   Paymaster & Bundler endpoint

Examples:
  node launch.mjs --name "ScoutAI"
  node launch.mjs --name "ScoutAI" --description "AI research assistant"
  node launch.mjs --name "ScoutAI" --symbol "SCOUT" --image ./avatar.png
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

async function launchToken(cdp, smartAccount, eoaAccount, opts, paymasterUrl, publicClient) {
  // Process image URL (upload if local file)
  const imageUrl = await processImageUrl(opts.image);

  step("🚀", `Launching $${opts.symbol}...`);

  try {
    // Use Clanker SDK to build the deploy transaction (without sending)
    const { Clanker } = await import("clanker-sdk/v4");
    const clanker = new Clanker({ publicClient, wallet: null });

    // Hardcoded fee split — agent gets 60%, protocol wallets get 20% each
    // Admin for protocol slots is set to the protocol wallets themselves,
    // so agents cannot change the protocol fee recipients on-chain.
    // Note: smartAccount.address is the agent's onchain identity
    const deployConfig = {
      name: opts.name,
      symbol: opts.symbol,
      tokenAdmin: smartAccount.address,
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
      rewards: {
        recipients: [
          {
            recipient: smartAccount.address,   // Agent's smart wallet
            admin: smartAccount.address,       // Agent controls their own slot
            bps: AGENT_BPS,                   // 60%
            token: "Both",
          },
          {
            recipient: PROTOCOL_FEE_ADDRESS,   // Protocol
            admin: PROTOCOL_FEE_ADDRESS,       // Only protocol can change
            bps: PROTOCOL_BPS,                 // 20%
            token: "Both",
          },
          {
            recipient: BANKR_FEE_ADDRESS,      // Bankr
            admin: BANKR_FEE_ADDRESS,          // Only Bankr can change
            bps: BANKR_BPS,                    // 20%
            token: "Both",
          },
        ],
      },
    };

    // Get the raw transaction data from Clanker SDK
    const deployTx = await clanker.getDeployTransaction(deployConfig);
    console.log(`\n   📝 Deploy calldata built`);
    console.log(`   🏭 Clanker V4: ${truncAddr(deployTx.address)}`);
    console.log(`   📍 Expected token: ${truncAddr(deployTx.expectedAddress)}`);

    // Encode the calldata
    const deployCalldata = encodeFunctionData({
      abi: deployTx.abi,
      functionName: deployTx.functionName,
      args: deployTx.args,
    });

    // Send as UserOperation via smart account + paymaster (GASLESS)
    console.log(`   ⛽ Sending via paymaster (gasless)...`);
    const userOpResult = await cdp.evm.sendUserOperation({
      smartAccount,
      network: "base",
      paymasterUrl,
      calls: [{
        to: deployTx.address,
        data: deployCalldata,
        value: deployTx.value || 0n,
      }],
    });

    console.log(`   ⏳ Waiting for UserOp confirmation...`);
    const receipt = await cdp.evm.waitForUserOperation({
      smartAccount,
      userOpHash: userOpResult.userOpHash,
    });

    const txHash = receipt.transactionHash;
    done(truncAddr(txHash));

    // Wait for 2 block confirmations
    console.log(`   ⏳ Waiting for block confirmations...`);
    await publicClient.waitForTransactionReceipt({ hash: txHash, confirmations: 2 });
    console.log(`   ✅ Confirmed (2 blocks)`);

    // Get the token address from the expected address or from logs
    const tokenAddress = deployTx.expectedAddress;
    console.log(`   🎉 Token deployed: ${tokenAddress}`);

    return { txHash, tokenAddress };
  } catch (error) {
    fail(`${error.message?.slice(0, 80) || "deployment failed"}`);
    console.log(`   ❌ Error: ${error.message?.slice(0, 200)}`);
    return { tokenAddress: null, error: error.message };
  }
}

// ═══════════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════════

async function main() {
  const opts = parseArgs();

  if (opts.help || !opts.name) {
    showHelp();
    process.exit(opts.help ? 0 : 1);
  }

  console.log(`   Agent: ${opts.name}`);
  console.log(`   Token: $${opts.symbol}`);
  console.log(`   Basename: auto (with fallbacks)\n`);

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

  if (!paymasterUrl) {
    console.error("❌ Missing CDP_PAYMASTER_URL. Required for gasless transactions.");
    console.error("   Get it from portal.cdp.coinbase.com → Paymaster & Bundler.");
    process.exit(1);
  }

  // Initialize CDP client
  const cdpOpts = { apiKeyId, apiKeySecret };
  if (walletSecret) cdpOpts.walletSecret = walletSecret;
  const cdp = new CdpClient(cdpOpts);

  // ═══════════════════════════════════════════════════════════════
  // STEP 1: Create Agent Wallet (EOA + Smart Account)
  // ═══════════════════════════════════════════════════════════════
  step("📦", "Creating agent wallet...");
  const eoaAccount = await cdp.evm.createAccount();
  const smartAccount = await cdp.evm.createSmartAccount({ owner: eoaAccount });
  done(`EOA ${truncAddr(eoaAccount.address)} → Smart ${truncAddr(smartAccount.address)}`);
  console.log(`   📋 Agent wallet: ${smartAccount.address}`);
  console.log(`   🔑 Signer (EOA): ${eoaAccount.address}`);
  console.log(`   ⛽ Gas: sponsored by paymaster (gasless)\n`);

  const publicClient = createPublicClient({ chain: base, transport: http() });

  // ═══════════════════════════════════════════════════════════════
  // STEP 2: Deploy Token (gasless via paymaster)
  // ═══════════════════════════════════════════════════════════════
  const tokenResult = await launchToken(cdp, smartAccount, eoaAccount, opts, paymasterUrl, publicClient);

  if (!tokenResult.tokenAddress) {
    console.error("\n❌ Token deployment failed. Check errors above.");
    process.exit(1);
  }

  // Brief pause between steps to let chain state propagate
  await new Promise(r => setTimeout(r, 3000));

  // ═══════════════════════════════════════════════════════════════
  // STEP 3: Register Basename (auto-naming with fallbacks)
  // ═══════════════════════════════════════════════════════════════
  let registeredBasename = null;

  step("🏷️ ", "Finding available basename...");
  const candidates = generateBasenameCandidates(opts.name, opts.symbol);
  console.log(`\n   📋 Candidates: ${candidates.map(c => c + ".base.eth").join(", ")}`);

  try {
    // Check availability for each candidate
    let chosenLabel = null;
    for (const label of candidates) {
      try {
        const isAvailable = await publicClient.readContract({
          address: BASENAME_REGISTRAR,
          abi: REGISTRAR_ABI,
          functionName: "available",
          args: [label],
        });
        if (isAvailable) {
          chosenLabel = label;
          console.log(`   ✅ ${label}.base.eth is available!`);
          break;
        } else {
          console.log(`   ❌ ${label}.base.eth — taken`);
        }
        // Small delay to avoid rate limiting
        await new Promise(r => setTimeout(r, 500));
      } catch (e) {
        // Rate limit or RPC error, skip this candidate
        console.log(`   ⚠️  ${label}.base.eth — check failed, skipping`);
      }
    }

    if (!chosenLabel) {
      fail("No basename available from candidates");
      console.log(`   ℹ️  All candidates taken. Agent can register manually later.`);
    } else {
      step("🏷️ ", `Registering ${chosenLabel}.base.eth...`);

      // Get price
      const price = await publicClient.readContract({
        address: BASENAME_REGISTRAR,
        abi: REGISTRAR_ABI,
        functionName: "registerPrice",
        args: [chosenLabel, ONE_YEAR],
      });
      const value = (price * 110n) / 100n; // 10% buffer

      // Encode register call (UpgradeableRegistrarController struct)
      const registerData = encodeFunctionData({
        abi: REGISTRAR_ABI,
        functionName: "register",
        args: [{
          name: chosenLabel,
          owner: smartAccount.address,
          duration: ONE_YEAR,
          resolver: BASENAME_RESOLVER,
          data: [],
          reverseRecord: true,
          coinTypes: [],
          signatureExpiry: 0n,
          signature: "0x",
        }],
      });

      // Send via smart account + paymaster
      console.log(`\n   ⛽ Sending via paymaster...`);
      const userOpResult = await cdp.evm.sendUserOperation({
        smartAccount,
        network: "base",
        paymasterUrl,
        calls: [{
          to: BASENAME_REGISTRAR,
          data: registerData,
          value,
        }],
      });

      console.log(`   ⏳ Waiting for confirmation...`);
      const receipt = await cdp.evm.waitForUserOperation({
        smartAccount,
        userOpHash: userOpResult.userOpHash,
      });

      if (receipt.transactionHash) {
        await publicClient.waitForTransactionReceipt({
          hash: receipt.transactionHash,
          confirmations: 2,
        });
        registeredBasename = `${chosenLabel}.base.eth`;
        done(`${registeredBasename} (confirmed)`);
      } else {
        fail(`${chosenLabel}.base.eth — UserOp failed`);
      }
    }
  } catch (error) {
    fail(`${error.message?.slice(0, 80) || "basename registration failed"}`);
    console.log(`   ℹ️  Note: Basename registration costs ~0.001 ETH (fee, not gas).`);
    console.log(`   ℹ️  The smart account may need ETH for the name fee.`);
  }

  // Brief pause before security audit
  await new Promise(r => setTimeout(r, 3000));

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
        "--wallet", smartAccount.address,
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
  console.log(`
══════════════════════════════════════════════
  🤖 LAUNCH COMPLETE
══════════════════════════════════════════════

  Agent Wallet:  ${smartAccount.address}
  Signer (EOA):  ${eoaAccount.address}${registeredBasename ? `\n  Basename:     ${registeredBasename}` : ""}
  Token:         ${tokenResult.tokenAddress}
  Trade:         https://www.clanker.world/clanker/${tokenResult.tokenAddress}
  Tx:            https://basescan.org/tx/${tokenResult.txHash}

  Fee Split:
    Agent    60%  →  ${truncAddr(smartAccount.address)}
    Protocol 20%  →  ${truncAddr(PROTOCOL_FEE_ADDRESS)}
    Bankr    20%  →  ${truncAddr(BANKR_FEE_ADDRESS)}

  ⛽ Gas: All transactions sponsored by paymaster (gasless)

══════════════════════════════════════════════

  💡 Your agent wallet is managed by CDP.
     Re-access anytime with the same CDP credentials.
     Smart Account: ${smartAccount.address}
     EOA Signer:    ${eoaAccount.address}

  📋 Next steps:
     • Claim fees: node claim-fees.mjs --token ${tokenResult.tokenAddress} --wallet ${smartAccount.address}
     • Set up auto-claim on a cron schedule
`);

  // Save launch data
  const output = {
    timestamp: new Date().toISOString(),
    smartAccountAddress: smartAccount.address,
    eoaAddress: eoaAccount.address,
    basename: registeredBasename,
    tokenAddress: tokenResult.tokenAddress,
    txHash: tokenResult.txHash,
    name: opts.name,
    symbol: opts.symbol,
    feeRecipients: {
      agent: { address: smartAccount.address, bps: AGENT_BPS },
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
