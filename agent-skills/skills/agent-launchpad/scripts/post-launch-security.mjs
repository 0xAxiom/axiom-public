#!/usr/bin/env node
/**
 * post-launch-security.mjs — Post-launch security audit for agent tokens
 * 
 * Performs comprehensive security checks on a launched agent token including:
 * - Token contract audit (name/symbol/supply verification)
 * - Fee recipient verification (agent wallet is slot 0 in locker)
 * - Wallet security (private key not exposed)
 * - Secret scanner (no accidentally committed secrets)
 * - Permission check (token admin verification)
 * 
 * Usage:
 *   node post-launch-security.mjs --token 0x... --wallet 0x...
 * 
 * Environment:
 *   No credentials required for read-only operations
 */

import { createPublicClient, http, parseAbi, getAddress, isAddress } from "viem";
import { base } from "viem/chains";
import { execSync } from "child_process";
import { readdirSync, readFileSync, statSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

// ═══════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════

const __dirname = dirname(fileURLToPath(import.meta.url));

// Clanker V4 fee locker on Base  
const FEE_LOCKER = "0x63D2DfEA64b3433F4071A98665bcD7Ca14d93496";

const FEE_LOCKER_ABI = parseAbi([
  "function tokenRewards(address token) external view returns (address[] memory rewardRecipients, uint16[] memory rewardBps, address[] memory rewardAdmins)",
]);

const ERC20_ABI = parseAbi([
  "function name() view returns (string)",
  "function symbol() view returns (string)", 
  "function totalSupply() view returns (uint256)",
  "function owner() view returns (address)",
  "function admin() view returns (address)",
]);

// ═══════════════════════════════════════════════════════════════
// CLI
// ═══════════════════════════════════════════════════════════════

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (name) => {
    const idx = args.indexOf(`--${name}`);
    return idx >= 0 && idx < args.length - 1 ? args[idx + 1] : null;
  };
  
  return {
    token: get("token"),
    wallet: get("wallet"),
  };
}

function printUsage() {
  console.log(`
Usage: node post-launch-security.mjs --token TOKEN_ADDRESS --wallet AGENT_WALLET_ADDRESS

Arguments:
  --token    Token contract address to audit
  --wallet   Agent wallet address to verify

Example:
  node post-launch-security.mjs --token 0x123... --wallet 0xabc...
  `);
}

// ═══════════════════════════════════════════════════════════════
// Security Check Functions
// ═══════════════════════════════════════════════════════════════

class SecurityCheck {
  constructor(name, description) {
    this.name = name;
    this.description = description;
    this.status = null; // 'pass', 'fail', 'warning'
    this.message = '';
  }
  
  pass(message = '') {
    this.status = 'pass';
    this.message = message;
  }
  
  fail(message = '') {
    this.status = 'fail';
    this.message = message;
  }
  
  warn(message = '') {
    this.status = 'warning';
    this.message = message;
  }
  
  getIcon() {
    switch (this.status) {
      case 'pass': return '✅';
      case 'fail': return '❌';
      case 'warning': return '⚠️';
      default: return '❓';
    }
  }
}

async function auditTokenContract(client, tokenAddress, agentWallet) {
  const check = new SecurityCheck("Token Contract", "name/symbol/supply verified");
  
  try {
    const [name, symbol, totalSupply] = await Promise.all([
      client.readContract({
        address: tokenAddress,
        abi: ERC20_ABI,
        functionName: 'name',
      }),
      client.readContract({
        address: tokenAddress,
        abi: ERC20_ABI,
        functionName: 'symbol',
      }),
      client.readContract({
        address: tokenAddress,
        abi: ERC20_ABI,
        functionName: 'totalSupply',
      }),
    ]);
    
    // Basic validation - token should have name, symbol, and reasonable supply
    if (!name || !symbol || totalSupply === 0n) {
      check.fail("missing name, symbol, or zero supply");
      return check;
    }
    
    // Supply should be reasonable (not suspicious)
    const supplyStr = (totalSupply / 10n**18n).toString();
    if (totalSupply > 10n**30n) { // More than 1 trillion tokens
      check.warn(`very large supply: ${supplyStr} tokens`);
      return check;
    }
    
    check.pass(`${name} (${symbol}) - ${supplyStr} tokens`);
    
  } catch (error) {
    check.fail(`failed to read contract: ${error.message}`);
  }
  
  return check;
}

async function verifyFeeRecipients(client, tokenAddress, agentWallet) {
  const check = new SecurityCheck("Fee Recipients", "agent is slot 0 recipient");
  
  try {
    const [rewardRecipients, rewardBps, rewardAdmins] = await client.readContract({
      address: FEE_LOCKER,
      abi: FEE_LOCKER_ABI,
      functionName: 'tokenRewards',
      args: [tokenAddress],
    });
    
    if (!rewardRecipients || rewardRecipients.length === 0) {
      check.fail("no reward recipients configured");
      return check;
    }
    
    const agentAddress = getAddress(agentWallet);
    const slot0Recipient = getAddress(rewardRecipients[0]);
    
    if (slot0Recipient !== agentAddress) {
      check.fail(`slot 0 is ${slot0Recipient}, expected ${agentAddress}`);
      return check;
    }
    
    const agentBps = rewardBps[0];
    const agentPercent = (Number(agentBps) / 100).toFixed(1);
    
    check.pass(`agent is slot 0 (${agentPercent}%)`);
    
  } catch (error) {
    if (error.message.includes("out of bounds") || error.message.includes("revert")) {
      check.fail("token not configured in fee locker");
    } else {
      check.fail(`failed to read locker config: ${error.message}`);
    }
  }
  
  return check;
}

function scanForWalletExposure(agentWallet) {
  const check = new SecurityCheck("Wallet Security", "private key not exposed");
  
  try {
    const currentDir = process.cwd();
    const commonPaths = [
      '.env',
      '.env.local', 
      '.env.development',
      '.env.production',
      'credentials.env',
      'wallet.env',
      '.secret',
      'private.key',
    ];
    
    let foundFiles = [];
    let foundExposure = false;
    
    // Check common credential files for the wallet address
    for (const file of commonPaths) {
      try {
        const content = readFileSync(join(currentDir, file), 'utf-8');
        if (content.toLowerCase().includes(agentWallet.toLowerCase())) {
          foundFiles.push(file);
          // Look for private key patterns near the wallet address
          if (content.match(/[0-9a-fA-F]{64}/) && content.toLowerCase().includes('private')) {
            foundExposure = true;
          }
        }
      } catch {
        // File doesn't exist, ignore
      }
    }
    
    // Check git history for wallet exposure (last 10 commits)
    try {
      const gitLog = execSync('git log --oneline -10 --grep="private\\|key\\|secret" --all 2>/dev/null || true', 
        { encoding: 'utf-8', cwd: currentDir });
      if (gitLog.includes(agentWallet)) {
        foundExposure = true;
        foundFiles.push('git history');
      }
    } catch {
      // Git not available or not a git repo
    }
    
    if (foundExposure) {
      check.fail(`wallet found in: ${foundFiles.join(', ')}`);
    } else if (foundFiles.length > 0) {
      check.warn(`wallet address found in: ${foundFiles.join(', ')}`);
    } else {
      check.pass("no wallet exposure detected");
    }
    
  } catch (error) {
    check.warn(`scan failed: ${error.message}`);
  }
  
  return check;
}

function scanForSecrets() {
  const check = new SecurityCheck("Secret Scanner", "no exposed secrets");
  
  try {
    const currentDir = process.cwd();
    const secretPatterns = [
      // Private keys (64 hex chars)
      /[0-9a-fA-F]{64}/g,
      // API keys
      /(?:api[_-]?key|apikey)["\s]*[:=]["\s]*([A-Za-z0-9]{20,})/gi,
      // Bearer tokens
      /bearer\s+([A-Za-z0-9\-._~+/]+=*)/gi,
      // SSH private keys
      /-----BEGIN\s+(RSA\s+)?PRIVATE\s+KEY-----/gi,
      // AWS keys
      /AKIA[0-9A-Z]{16}/g,
    ];
    
    let foundSecrets = [];
    
    function scanDirectory(dir, maxDepth = 2) {
      if (maxDepth <= 0) return;
      
      try {
        const entries = readdirSync(dir);
        for (const entry of entries) {
          // Skip common non-source directories
          if (['node_modules', '.git', 'dist', 'build', '.next'].includes(entry)) continue;
          
          const fullPath = join(dir, entry);
          const stat = statSync(fullPath);
          
          if (stat.isDirectory()) {
            scanDirectory(fullPath, maxDepth - 1);
          } else if (stat.isFile()) {
            // Only scan text files
            if (!/\.(js|mjs|ts|json|env|md|txt|config|cfg|ini|yaml|yml|toml)$/i.test(entry)) continue;
            if (stat.size > 1024 * 1024) continue; // Skip files > 1MB
            
            try {
              const content = readFileSync(fullPath, 'utf-8');
              for (const pattern of secretPatterns) {
                const matches = content.match(pattern);
                if (matches) {
                  foundSecrets.push({
                    file: fullPath.replace(currentDir + '/', ''),
                    pattern: pattern.toString(),
                    count: matches.length,
                  });
                }
              }
            } catch {
              // Unable to read file as text
            }
          }
        }
      } catch {
        // Directory access error
      }
    }
    
    scanDirectory(currentDir);
    
    if (foundSecrets.length > 0) {
      const fileCount = new Set(foundSecrets.map(s => s.file)).size;
      check.fail(`found potential secrets in ${fileCount} files`);
    } else {
      check.pass("no exposed secrets detected");
    }
    
  } catch (error) {
    check.warn(`scan failed: ${error.message}`);
  }
  
  return check;
}

async function verifyTokenPermissions(client, tokenAddress, agentWallet) {
  const check = new SecurityCheck("Permission Check", "token admin verification");
  
  try {
    let admin = null;
    
    // Try common admin/owner functions
    const adminFunctions = ['owner', 'admin', 'getOwner'];
    
    for (const funcName of adminFunctions) {
      try {
        admin = await client.readContract({
          address: tokenAddress,
          abi: parseAbi([`function ${funcName}() view returns (address)`]),
          functionName: funcName,
        });
        break;
      } catch {
        // Function doesn't exist, try next
      }
    }
    
    if (!admin) {
      check.warn("unable to determine token admin");
      return check;
    }
    
    const agentAddress = getAddress(agentWallet);
    const adminAddress = getAddress(admin);
    
    if (adminAddress === agentAddress) {
      check.pass("agent is token admin");
    } else {
      check.fail(`admin is ${adminAddress}, expected ${agentAddress}`);
    }
    
  } catch (error) {
    check.warn(`failed to check permissions: ${error.message}`);
  }
  
  return check;
}

// ═══════════════════════════════════════════════════════════════
// Main Function
// ═══════════════════════════════════════════════════════════════

async function main() {
  const { token, wallet } = parseArgs();
  
  if (!token || !wallet) {
    printUsage();
    process.exit(1);
  }
  
  // Validate addresses
  if (!isAddress(token) || !isAddress(wallet)) {
    console.error("❌ Invalid token or wallet address");
    process.exit(1);
  }
  
  // Create viem client for Base
  const client = createPublicClient({
    chain: base,
    transport: http(),
  });
  
  // Get token info for header
  let tokenSymbol = "UNKNOWN";
  try {
    tokenSymbol = await client.readContract({
      address: token,
      abi: ERC20_ABI,
      functionName: 'symbol',
    });
  } catch {
    // Unable to get symbol
  }
  
  // Print header
  console.log("🔐 Post-Launch Security Audit");
  console.log("═══════════════════════════════");
  console.log("");
  console.log(`Token: $${tokenSymbol} (${token})`);
  console.log(`Agent: ${wallet}`);
  console.log("");
  
  // Run all security checks
  const checks = [
    await auditTokenContract(client, token, wallet),
    await verifyFeeRecipients(client, token, wallet),
    scanForWalletExposure(wallet),
    scanForSecrets(),
    await verifyTokenPermissions(client, token, wallet),
  ];
  
  // Print results
  for (const check of checks) {
    const icon = check.getIcon();
    const message = check.message ? ` — ${check.message}` : '';
    console.log(`${icon} ${check.name}${message}`);
  }
  
  // Calculate score
  const totalChecks = checks.length;
  const passedChecks = checks.filter(c => c.status === 'pass').length;
  const failedChecks = checks.filter(c => c.status === 'fail').length;
  const warningChecks = checks.filter(c => c.status === 'warning').length;
  
  console.log("");
  
  if (failedChecks > 0) {
    console.log(`Score: ${passedChecks}/${totalChecks} checks passed (${failedChecks} critical failures${warningChecks > 0 ? `, ${warningChecks} warnings` : ''})`);
    process.exit(1);
  } else if (warningChecks > 0) {
    console.log(`Score: ${passedChecks}/${totalChecks} checks passed (${warningChecks} warnings)`);
  } else {
    console.log(`Score: ${passedChecks}/${totalChecks} checks passed ✨`);
  }
  
  process.exit(0);
}

// ═══════════════════════════════════════════════════════════════
// Run
// ═══════════════════════════════════════════════════════════════

main().catch((error) => {
  console.error("❌ Security audit failed:", error.message);
  process.exit(1);
});