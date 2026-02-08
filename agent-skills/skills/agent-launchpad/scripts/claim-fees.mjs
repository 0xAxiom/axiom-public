#!/usr/bin/env node
/**
 * claim-fees.mjs — Claim Clanker LP fee rewards for a launched agent token
 * 
 * Uses the Clanker fee locker contract to claim accumulated WETH and token fees.
 * Works with CDP smart accounts for gasless claiming.
 * 
 * Usage:
 *   node claim-fees.mjs --token 0x... --wallet 0x...
 *   node claim-fees.mjs --token 0x... --wallet 0x... --dry-run
 * 
 * Environment:
 *   CDP_API_KEY_ID, CDP_API_KEY_SECRET, CDP_WALLET_SECRET
 *   (or stored in ~/.agent-launchpad/credentials.env)
 */

import { CdpClient } from "@coinbase/cdp-sdk";
import { createPublicClient, http, encodeFunctionData, parseAbi, formatEther, formatUnits } from "viem";
import { base } from "viem/chains";
import { readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

// ═══════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════

const WETH = "0x4200000000000000000000000000000000000006";

// Clanker V4 fee locker on Base
const FEE_LOCKER = "0xF3622742b1E446D92e45E22923Ef11C2fcD55D68";

const FEE_LOCKER_ABI = parseAbi([
  "function claim(address feeOwner, address token) external",
  "function availableFees(address feeOwner, address token) external view returns (uint256)",
]);

const ERC20_ABI = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
]);

// ═══════════════════════════════════════════════════════════════
// CLI
// ═══════════════════════════════════════════════════════════════

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (name) => {
    const i = args.indexOf("--" + name);
    return i >= 0 && args[i + 1] ? args[i + 1] : null;
  };
  return {
    token: get("token"),
    wallet: get("wallet"),
    eoaKey: get("eoa-key"),
    dryRun: args.includes("--dry-run"),
    help: args.includes("--help") || args.includes("-h"),
  };
}

function showHelp() {
  console.log(`
🤖 Agent Fee Claimer
═════════════════════

Claim accumulated LP fee rewards from Clanker for your agent token.

Usage:
  node claim-fees.mjs --token <TOKEN_ADDRESS> --wallet <SMART_ACCOUNT_ADDRESS> --eoa-key <PRIVATE_KEY>

Options:
  --token     Token contract address (required)
  --wallet    Agent's smart account address (required)
  --eoa-key   EOA private key that owns the smart account (required for claiming)
  --dry-run   Check fees without claiming
  --help      Show this help

Environment:
  CDP_API_KEY_ID, CDP_API_KEY_SECRET, CDP_WALLET_SECRET
  (or stored in ~/.agent-launchpad/credentials.env)
`);
}

// ═══════════════════════════════════════════════════════════════
// Credential Loading
// ═══════════════════════════════════════════════════════════════

function loadCdpCreds() {
  let apiKeyId = process.env.CDP_API_KEY_ID;
  let apiKeySecret = process.env.CDP_API_KEY_SECRET;
  let walletSecret = process.env.CDP_WALLET_SECRET;

  if (!apiKeyId || !apiKeySecret) {
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
    } catch { /* not found */ }
  }

  // Load paymaster URL
  let paymasterUrl = process.env.CDP_PAYMASTER_URL;
  if (!paymasterUrl) {
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
  }

  return { apiKeyId, apiKeySecret, walletSecret, paymasterUrl };
}

// ═══════════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════════

async function main() {
  const opts = parseArgs();

  if (opts.help || !opts.token || !opts.wallet) {
    showHelp();
    process.exit(opts.help ? 0 : 1);
  }

  if (!opts.dryRun && !opts.eoaKey) {
    console.error("\n❌ EOA private key required for claiming (use --eoa-key or --dry-run)");
    process.exit(1);
  }

  const publicClient = createPublicClient({
    chain: base,
    transport: http(),
  });

  const tokenAddress = opts.token;
  const walletAddress = opts.wallet;

  // Get token info
  let tokenSymbol = "TOKEN";
  try {
    tokenSymbol = await publicClient.readContract({
      address: tokenAddress,
      abi: ERC20_ABI,
      functionName: "symbol",
    });
  } catch { /* use default */ }

  console.log(`\n🔍 Checking fees for $${tokenSymbol}...`);
  console.log(`   Wallet:  ${walletAddress}`);
  console.log(`   Token:   ${tokenAddress}`);

  // Check available WETH fees
  let wethFees = 0n;
  try {
    wethFees = await publicClient.readContract({
      address: FEE_LOCKER,
      abi: FEE_LOCKER_ABI,
      functionName: "availableFees",
      args: [walletAddress, WETH],
    });
  } catch (e) {
    console.log(`   ⚠️  Could not read WETH fees: ${e.message?.slice(0, 60)}`);
  }

  // Check available token fees
  let tokenFees = 0n;
  try {
    tokenFees = await publicClient.readContract({
      address: FEE_LOCKER,
      abi: FEE_LOCKER_ABI,
      functionName: "availableFees",
      args: [walletAddress, tokenAddress],
    });
  } catch (e) {
    console.log(`   ⚠️  Could not read token fees: ${e.message?.slice(0, 60)}`);
  }

  console.log(`\n   WETH fees:  ${formatEther(wethFees)} ETH`);
  console.log(`   Token fees: ${formatUnits(tokenFees, 18)} $${tokenSymbol}`);

  if (wethFees === 0n && tokenFees === 0n) {
    console.log("\n   ℹ️  No fees to claim yet.");
    return;
  }

  if (opts.dryRun) {
    console.log("\n   🏁 Dry run — not claiming.");
    return;
  }

  // Initialize CDP client
  const creds = loadCdpCreds();
  if (!creds.apiKeyId || !creds.apiKeySecret) {
    console.error("\n❌ Missing CDP credentials.");
    process.exit(1);
  }

  const cdpOpts = { apiKeyId: creds.apiKeyId, apiKeySecret: creds.apiKeySecret };
  if (creds.walletSecret) cdpOpts.walletSecret = creds.walletSecret;
  const cdp = new CdpClient(cdpOpts);

  // Reconstruct the smart account from the EOA private key
  const eoaAccount = await cdp.evm.createAccountFromPrivateKey(opts.eoaKey);
  const smartAccount = await cdp.evm.createSmartAccount({
    owner: eoaAccount,
  });

  // Claim WETH fees
  if (wethFees > 0n) {
    console.log(`\n   💰 Claiming ${formatEther(wethFees)} WETH...`);
    try {
      const claimData = encodeFunctionData({
        abi: FEE_LOCKER_ABI,
        functionName: "claim",
        args: [walletAddress, WETH],
      });

      const result = await cdp.evm.sendUserOperation({
        smartAccount: smartAccount,
        network: "base",
        paymasterUrl: creds.paymasterUrl,
        calls: [{
          to: FEE_LOCKER,
          data: claimData,
          value: 0n,
        }],
      });

      const waitResult = await cdp.evm.waitForUserOperation({
        smartAccount,
        userOpHash: result.userOpHash
      });

      console.log(`   ✅ WETH claimed! Tx: ${waitResult?.transactionHash}`);
    } catch (e) {
      console.log(`   ❌ WETH claim failed: ${e.message?.slice(0, 80)}`);
    }
  }

  // Claim token fees
  if (tokenFees > 0n) {
    console.log(`\n   💰 Claiming ${formatUnits(tokenFees, 18)} $${tokenSymbol}...`);
    try {
      const claimData = encodeFunctionData({
        abi: FEE_LOCKER_ABI,
        functionName: "claim",
        args: [walletAddress, tokenAddress],
      });

      const result = await cdp.evm.sendUserOperation({
        smartAccount: smartAccount,
        network: "base",
        paymasterUrl: creds.paymasterUrl,
        calls: [{
          to: FEE_LOCKER,
          data: claimData,
          value: 0n,
        }],
      });

      const waitResult = await cdp.evm.waitForUserOperation({
        smartAccount,
        userOpHash: result.userOpHash
      });

      console.log(`   ✅ $${tokenSymbol} claimed! Tx: ${waitResult?.transactionHash}`);
    } catch (e) {
      console.log(`   ❌ Token claim failed: ${e.message?.slice(0, 80)}`);
    }
  }

  // Show final balances
  console.log("\n── Post-Claim Balances ──");
  try {
    const wethBal = await publicClient.readContract({
      address: WETH,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [walletAddress],
    });
    console.log(`   WETH:   ${formatEther(wethBal)}`);
  } catch { /* skip */ }

  try {
    const tokenBal = await publicClient.readContract({
      address: tokenAddress,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [walletAddress],
    });
    console.log(`   $${tokenSymbol}: ${formatUnits(tokenBal, 18)}`);
  } catch { /* skip */ }

  console.log("");
}

main().catch((error) => {
  console.error("\n💥 Error:", error.message);
  if (process.env.DEBUG) console.error(error);
  process.exit(1);
});
