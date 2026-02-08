#!/usr/bin/env node
/**
 * launch.mjs — Agent Launchpad
 * 
 * One command to take any AI agent onchain:
 * 1. Create a wallet (EOA via CDP, server-managed)
 * 2. Fund it with ETH for gas (from a funding wallet)
 * 3. Register a Basename (<name>.base.eth) with auto-fallbacks
 * 4. Launch a token via Clanker v4 on Base
 * 
 * Usage:
 *   node launch.mjs --name "ScoutAI"
 *   node launch.mjs --name "ScoutAI" --symbol "SCOUT" --image ./avatar.png
 * 
 * Environment:
 *   CDP_API_KEY_ID, CDP_API_KEY_SECRET, CDP_WALLET_SECRET
 *   FUNDING_WALLET_KEY — private key of wallet that funds new agents with gas ETH
 */

import { CdpClient } from "@coinbase/cdp-sdk";
import { createPublicClient, createWalletClient, http, encodeFunctionData, parseEther, formatEther } from "viem";
import { base } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts"; // Used for funding wallet
import { readFileSync, writeFileSync, existsSync } from "fs";
import { homedir } from "os";
import { join, dirname, resolve } from "path";
import { spawn } from "child_process";

// ═══════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════

const CLANKER_V4 = "0xE85A59c628F7d27878ACeB4bf3b35733630083a9";

// Fee recipients — hardcoded, enforced on-chain
const PROTOCOL_FEE_ADDRESS = "0x0D9945F0a591094927df47DB12ACB1081cE9F0F6"; // Protocol fee wallet
const AGENT_BPS = 7500;    // 75%
const PROTOCOL_BPS = 2500; // 25%

// Gas funding — enough for Clanker deploy (~$3.25) + basename (~$0.50) + buffer
const GAS_FUND_AMOUNT = parseEther("0.003"); // ~$8.40 at $2800/ETH

// Basename contracts (Base mainnet)
const BASENAME_REGISTRAR = "0x4cCb0720c37C2109e2E5B14F354e30e96E18C701";
const BASENAME_RESOLVER = "0xC6d566A56A1aFf6508b41f6c90ff131615583BCD";
const ONE_YEAR = 31557600n;

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

  return [...new Set(candidates)].filter(c => c.length >= 3);
}

function showHelp() {
  console.log(`
🤖 Agent Launchpad
═══════════════════

Take any AI agent onchain in one command.
Creates wallet, funds gas, deploys token, registers basename.

Usage:
  node launch.mjs --name "ScoutAI" [options]

Required:
  --name, -n        Agent/token name (e.g., "ScoutAI")

Optional:
  --symbol, -s      Token symbol (auto-derived from name if omitted)
  --description, -d Token description
  --image, -i       Token image URL or local file path
  --market-cap, -m  Initial market cap in ETH (default: 10)
  --help, -h        Show this help

Automatic:
  • Symbol auto-derived from name (first word, uppercase)
  • Basename always registered with fallbacks:
    name → namebot → name0x → nameagent → symbol variants
  • Security audit runs after deployment
  • Gas funded from protocol wallet (~0.003 ETH)

Fee Split (hardcoded, enforced on-chain):
  Agent 75% | Protocol 25%

Environment Variables:
  CDP_API_KEY_ID      Coinbase Developer Platform API key ID
  CDP_API_KEY_SECRET  CDP API key secret (EC private key PEM)
  CDP_WALLET_SECRET   CDP wallet encryption secret
  FUNDING_WALLET_KEY  Private key for funding agent wallets with gas

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
  if (!imageArg || imageArg.startsWith('http://') || imageArg.startsWith('https://')) {
    return imageArg;
  }

  const resolvedPath = resolve(imageArg);
  if (existsSync(resolvedPath)) {
    step("📤", "Uploading image...");
    try {
      const scriptDir = dirname(new URL(import.meta.url).pathname);
      const uploadScriptPath = join(scriptDir, 'upload-image.mjs');
      const uploadResult = await new Promise((resolve, reject) => {
        const child = spawn('node', [uploadScriptPath, '--file', resolvedPath], {
          stdio: ['inherit', 'pipe', 'pipe']
        });
        let stdout = '';
        child.stdout.on('data', (d) => { stdout += d.toString(); });
        child.stderr.on('data', (d) => { stdout += d.toString(); });
        child.on('close', (code) => {
          if (code === 0) {
            const url = stdout.trim().split('\n').pop();
            resolve(url);
          } else {
            reject(new Error(`Upload failed (code ${code}): ${stdout}`));
          }
        });
        child.on('error', reject);
      });
      done(uploadResult);
      return uploadResult;
    } catch (error) {
      fail(`Upload failed: ${error.message}`);
      throw error;
    }
  }

  return imageArg;
}

// ═══════════════════════════════════════════════════════════════
// Step 2: Fund Wallet with Gas ETH
// ═══════════════════════════════════════════════════════════════

async function fundWallet(agentAddress, fundingKey, publicClient) {
  step("⛽", "Funding wallet with gas...");

  const fundingAccount = privateKeyToAccount(fundingKey);
  const walletClient = createWalletClient({
    account: fundingAccount,
    chain: base,
    transport: http(),
  });

  // Check funding wallet balance
  const balance = await publicClient.getBalance({ address: fundingAccount.address });
  if (balance < GAS_FUND_AMOUNT) {
    fail(`Funding wallet low: ${formatEther(balance)} ETH`);
    console.log(`   ❌ Need at least ${formatEther(GAS_FUND_AMOUNT)} ETH in ${truncAddr(fundingAccount.address)}`);
    throw new Error("Insufficient funding wallet balance");
  }

  // Send ETH to agent wallet
  const hash = await walletClient.sendTransaction({
    to: agentAddress,
    value: GAS_FUND_AMOUNT,
    gas: 21000n, // Simple ETH transfer
  });

  // Wait for confirmation
  await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 });
  done(`${formatEther(GAS_FUND_AMOUNT)} ETH → ${truncAddr(agentAddress)}`);
  console.log(`   💰 Funded from: ${truncAddr(fundingAccount.address)}`);
  console.log(`   📜 Tx: ${hash}\n`);

  return hash;
}

// ═══════════════════════════════════════════════════════════════
// Step 3: Launch Token via Clanker (direct EOA transaction)
// ═══════════════════════════════════════════════════════════════

async function launchToken(cdp, agentAccount, opts, publicClient) {
  // Note: CDP server accounts use cdp.evm.sendTransaction({ address, transaction, network })
  // not viem's walletClient.sendTransaction (which doesn't support "evm-server" type)
  const imageUrl = await processImageUrl(opts.image);

  step("🚀", `Launching $${opts.symbol}...`);

  try {
    const { Clanker } = await import("clanker-sdk/v4");
    const clanker = new Clanker({ publicClient, wallet: null });

    const deployConfig = {
      name: opts.name,
      symbol: opts.symbol,
      tokenAdmin: agentAccount.address,
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
            recipient: agentAccount.address,
            admin: agentAccount.address,
            bps: AGENT_BPS,
            token: "Both",
          },
          {
            recipient: PROTOCOL_FEE_ADDRESS,
            admin: PROTOCOL_FEE_ADDRESS,
            bps: PROTOCOL_BPS,
            token: "Paired",
          },
        ],
      },
    };

    const deployTx = await clanker.getDeployTransaction(deployConfig);
    console.log(`\n   📝 Deploy calldata built`);
    console.log(`   🏭 Clanker V4: ${truncAddr(deployTx.address)}`);
    console.log(`   📍 Expected token: ${truncAddr(deployTx.expectedAddress)}`);

    const deployCalldata = encodeFunctionData({
      abi: deployTx.abi,
      functionName: deployTx.functionName,
      args: deployTx.args,
    });

    // Send as regular transaction via CDP (gas paid from funded wallet)
    console.log(`   ⛽ Sending transaction...`);
    const txResult = await cdp.evm.sendTransaction({
      address: agentAccount.address,
      transaction: {
        to: deployTx.address,
        data: deployCalldata,
        value: deployTx.value || 0n,
      },
      network: "base",
    });
    const txHash = txResult.transactionHash;
    console.log(`   ⏳ Waiting for confirmation...`);

    const receipt = await publicClient.waitForTransactionReceipt({
      hash: txHash,
      confirmations: 2,
    });

    if (receipt.status === "reverted") {
      fail("Transaction reverted on-chain");
      return { tokenAddress: null, error: "Transaction reverted" };
    }

    const tokenAddress = deployTx.expectedAddress;
    done(truncAddr(txHash));
    console.log(`   ✅ Confirmed (2 blocks)`);
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

  // Load credentials
  let apiKeyId = process.env.CDP_API_KEY_ID;
  let apiKeySecret = process.env.CDP_API_KEY_SECRET;
  let walletSecret = process.env.CDP_WALLET_SECRET;
  let fundingKey = process.env.FUNDING_WALLET_KEY;

  if (!apiKeyId || !apiKeySecret || !fundingKey) {
    try {
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
      if (!fundingKey) {
        // Try NET_PRIVATE_KEY as funding source (our main wallet)
        // Supports: KEY="value", KEY=value, export KEY=value
        const m = envFile.match(/(?:FUNDING_WALLET_KEY|NET_PRIVATE_KEY)=["']?([^\s"']+)["']?/);
        if (m) fundingKey = m[1];
      }
    } catch {}
  }

  if (!apiKeyId || !apiKeySecret) {
    console.error("❌ Missing CDP credentials. Set CDP_API_KEY_ID and CDP_API_KEY_SECRET.");
    process.exit(1);
  }

  if (!fundingKey) {
    console.error("❌ Missing FUNDING_WALLET_KEY. Set a private key for funding agent gas.");
    console.error("   Or set NET_PRIVATE_KEY in wallet.env.");
    process.exit(1);
  }

  // Ensure funding key has 0x prefix
  if (!fundingKey.startsWith("0x")) fundingKey = `0x${fundingKey}`;

  // Initialize CDP client
  const cdpOpts = { apiKeyId, apiKeySecret };
  if (walletSecret) cdpOpts.walletSecret = walletSecret;
  const cdp = new CdpClient(cdpOpts);

  const publicClient = createPublicClient({ chain: base, transport: http() });

  // ═══════════════════════════════════════════════════════════════
  // STEP 1: Create Agent Wallet (EOA)
  // ═══════════════════════════════════════════════════════════════
  step("📦", "Creating agent wallet...");
  const agentAccount = await cdp.evm.createAccount();
  done(`EOA ${truncAddr(agentAccount.address)}`);
  console.log(`   📋 Agent wallet: ${agentAccount.address}`);
  console.log(`   ⛽ Gas: funded by protocol\n`);

  // ═══════════════════════════════════════════════════════════════
  // STEP 2: Fund Wallet with Gas ETH
  // ═══════════════════════════════════════════════════════════════
  await fundWallet(agentAccount.address, fundingKey, publicClient);

  // ═══════════════════════════════════════════════════════════════
  // STEP 3: Deploy Token (direct EOA transaction)
  // ═══════════════════════════════════════════════════════════════
  const tokenResult = await launchToken(cdp, agentAccount, opts, publicClient);

  if (!tokenResult.tokenAddress) {
    console.error("\n❌ Token deployment failed. Check errors above.");
    process.exit(1);
  }

  await new Promise(r => setTimeout(r, 3000));

  // ═══════════════════════════════════════════════════════════════
  // STEP 4: Register Basename (auto-naming with fallbacks)
  // ═══════════════════════════════════════════════════════════════
  let registeredBasename = null;

  step("🏷️ ", "Finding available basename...");
  const candidates = generateBasenameCandidates(opts.name, opts.symbol);
  console.log(`\n   📋 Candidates: ${candidates.map(c => c + ".base.eth").join(", ")}`);

  try {
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
        await new Promise(r => setTimeout(r, 500));
      } catch (e) {
        console.log(`   ⚠️  ${label}.base.eth — check failed, skipping`);
      }
    }

    if (!chosenLabel) {
      fail("No basename available from candidates");
      console.log(`   ℹ️  All candidates taken. Agent can register manually later.`);
    } else {
      step("🏷️ ", `Registering ${chosenLabel}.base.eth...`);

      const price = await publicClient.readContract({
        address: BASENAME_REGISTRAR,
        abi: REGISTRAR_ABI,
        functionName: "registerPrice",
        args: [chosenLabel, ONE_YEAR],
      });
      const value = (price * 110n) / 100n; // 10% buffer

      const registerData = encodeFunctionData({
        abi: REGISTRAR_ABI,
        functionName: "register",
        args: [{
          name: chosenLabel,
          owner: agentAccount.address,
          duration: ONE_YEAR,
          resolver: BASENAME_RESOLVER,
          data: [],
          reverseRecord: true,
          coinTypes: [],
          signatureExpiry: 0n,
          signature: "0x",
        }],
      });

      console.log(`\n   ⛽ Sending transaction...`);
      const txResult = await cdp.evm.sendTransaction({
        address: agentAccount.address,
        transaction: {
          to: BASENAME_REGISTRAR,
          data: registerData,
          value,
        },
        network: "base",
      });
      const txHash = txResult.transactionHash;

      console.log(`   ⏳ Waiting for confirmation...`);
      const receipt = await publicClient.waitForTransactionReceipt({
        hash: txHash,
        confirmations: 2,
      });

      if (receipt.status === "success") {
        registeredBasename = `${chosenLabel}.base.eth`;
        done(`${registeredBasename} (confirmed)`);
      } else {
        fail(`${chosenLabel}.base.eth — tx reverted`);
      }
    }
  } catch (error) {
    fail(`${error.message?.slice(0, 80) || "basename registration failed"}`);
    console.log(`   ℹ️  Note: Basename costs ~0.001 ETH. Agent wallet may need more ETH.`);
  }

  await new Promise(r => setTimeout(r, 3000));

  // ═══════════════════════════════════════════════════════════════
  // STEP 5: Security Audit
  // ═══════════════════════════════════════════════════════════════
  step("🔐", "Running security audit...");

  try {
    const scriptDir = dirname(new URL(import.meta.url).pathname);
    const securityResult = await new Promise((resolve, reject) => {
      const child = spawn("node", [
        join(scriptDir, "post-launch-security.mjs"),
        "--token", tokenResult.tokenAddress,
        "--wallet", agentAccount.address,
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

  Agent Wallet:  ${agentAccount.address}${registeredBasename ? `\n  Basename:     ${registeredBasename}` : ""}
  Token:         ${tokenResult.tokenAddress}
  Trade:         https://www.clanker.world/clanker/${tokenResult.tokenAddress}
  Tx:            https://basescan.org/tx/${tokenResult.txHash}

  Fee Split:
    Agent    75%  →  ${truncAddr(agentAccount.address)}
    Protocol 25%  →  ${truncAddr(PROTOCOL_FEE_ADDRESS)}

  ⛽ Gas funded by protocol (~${formatEther(GAS_FUND_AMOUNT)} ETH)

══════════════════════════════════════════════

  💡 Your agent wallet is managed by CDP.
     Re-access anytime with the same CDP credentials.
     Wallet: ${agentAccount.address}

  📋 Next steps:
     • Claim fees: node claim-fees.mjs --token ${tokenResult.tokenAddress} --wallet ${agentAccount.address}
     • Set up auto-claim on a cron schedule
`);

  // Save launch data
  const output = {
    timestamp: new Date().toISOString(),
    agentAddress: agentAccount.address,
    basename: registeredBasename,
    tokenAddress: tokenResult.tokenAddress,
    txHash: tokenResult.txHash,
    name: opts.name,
    symbol: opts.symbol,
    feeRecipients: {
      agent: { address: agentAccount.address, bps: AGENT_BPS },
      protocol: { address: PROTOCOL_FEE_ADDRESS, bps: PROTOCOL_BPS },
    },
    feeSplit: "Agent 75% / Protocol 25%",
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
