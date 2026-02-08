#!/usr/bin/env node
/**
 * test-connection.mjs — Quick test to verify CDP SDK connection works
 * 
 * Usage: node scripts/test-connection.mjs
 * 
 * Reads credentials from env vars or ~/.agent-launchpad/credentials.env
 */

import { CdpClient } from "@coinbase/cdp-sdk";
import { readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

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

  return { apiKeyId, apiKeySecret, walletSecret };
}

console.log("🔌 Testing CDP SDK connection...\n");

try {
  const creds = loadCdpCreds();
  if (!creds.apiKeyId || !creds.apiKeySecret) {
    console.error("❌ Missing CDP_API_KEY_ID or CDP_API_KEY_SECRET");
    console.error("   Set env vars or add to ~/.agent-launchpad/credentials.env");
    process.exit(1);
  }

  const cdpOpts = { apiKeyId: creds.apiKeyId, apiKeySecret: creds.apiKeySecret };
  if (creds.walletSecret) cdpOpts.walletSecret = creds.walletSecret;
  const cdp = new CdpClient(cdpOpts);
  
  // Create a test EOA account
  const account = await cdp.evm.createAccount();
  console.log("✅ CDP connection works!");
  console.log(`   Account: ${account.address}`);
  console.log(`   Type:    ${account.type}`);
  
  // Create a smart account from it
  const smartAccount = await cdp.evm.createSmartAccount({ owner: account });
  console.log(`\n✅ Smart account created!`);
  console.log(`   Address: ${smartAccount.address}`);
  console.log(`   Type:    ${smartAccount.type}`);
  console.log(`   Owner:   ${account.address}`);
  
  console.log("\n🎉 All good! You're ready to launch.");
} catch (error) {
  console.error("❌ Connection failed:", error.message);
  
  if (error.message?.includes("API key") || error.message?.includes("auth")) {
    console.error("\n💡 Make sure these env vars are set:");
    console.error("   CDP_API_KEY_ID");
    console.error("   CDP_API_KEY_SECRET");
    console.error("   CDP_WALLET_SECRET");
  }
  
  process.exit(1);
}
