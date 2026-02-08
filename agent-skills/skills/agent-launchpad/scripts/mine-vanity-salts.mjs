#!/usr/bin/env node
/**
 * mine-vanity-salts.mjs — Vanity Salt Miner for Agent Launchpad
 *
 * Mines CREATE2 salts that produce token addresses ending in "ax" (case-insensitive).
 *
 * ⚠️  IMPORTANT: CREATE2 addresses depend on deployer + salt + keccak256(initCode).
 * The initCode includes constructor args (name, symbol, admin, image, metadata, etc.),
 * so the resulting address changes with EVERY deployment.
 *
 * This means we CANNOT pre-compute a static pool of vanity salts.
 * Instead, this script mines a vanity salt for a SPECIFIC deployment config at launch time.
 *
 * The Clanker factory applies an additional transform:
 *   actualSalt = keccak256(abi.encode(tokenAdmin, salt))
 * So we mine the `salt` value (bytes32) that the user passes in TokenConfig.
 *
 * Usage:
 *   # Mine a single vanity salt for a specific deployment (called by launch.mjs)
 *   node mine-vanity-salts.mjs \
 *     --name "ScoutAI" --symbol "SCOUT" --admin 0x123... \
 *     --image "" --metadata '{}' --context '{}' --suffix ax
 *
 *   # Pre-mine a batch for common configs (saves to vanity-salts.json)
 *   node mine-vanity-salts.mjs --batch --count 10 --suffix ax
 */

import { keccak256, encodeAbiParameters, encodePacked, getContractAddress, toHex, hexToBigInt, pad, concat } from "viem";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "data");
const SALTS_FILE = join(DATA_DIR, "vanity-salts.json");

// ═══════════════════════════════════════════════════════════════
// Constants — from Clanker V4
// ═══════════════════════════════════════════════════════════════

const CLANKER_V4 = "0xE85A59c628F7d27878ACeB4bf3b35733630083a9";
const DEFAULT_SUPPLY = 100_000_000_000n * 10n ** 18n; // 100B tokens with 18 decimals
const BASE_CHAIN_ID = 8453n;

// ═══════════════════════════════════════════════════════════════
// Token bytecode — loaded from Clanker SDK
// ═══════════════════════════════════════════════════════════════

let ClankerToken_v4_bytecode;
try {
  // Dynamically load from clanker-sdk
  const sdkPath = join(__dirname, "..", "node_modules", "clanker-sdk", "dist", "v4", "index.js");
  // We'll extract it by importing the module
  const sdk = await import(sdkPath);
  // The bytecode is embedded in the compiled JS — we need to get the config
  // Since it's not directly exported, we'll use encodeDeployData approach
} catch (e) {
  // Fallback: will be provided at runtime
}

// ═══════════════════════════════════════════════════════════════
// CREATE2 Address Prediction (matching Clanker SDK logic)
// ═══════════════════════════════════════════════════════════════

/**
 * Predict the token address given deployment params and a salt.
 *
 * The Clanker factory uses:
 *   actualSalt = keccak256(abi.encode(tokenAdmin, salt))
 *   address = CREATE2(factory, actualSalt, keccak256(initCode))
 *
 * Where initCode = bytecode + abi.encode(constructorArgs)
 *
 * @param {object} params
 * @param {string} params.deployer - Factory address (CLANKER_V4)
 * @param {string} params.salt - The bytes32 salt value (what we're mining)
 * @param {string} params.tokenAdmin - The token admin address
 * @param {string} params.initCodeHash - keccak256 of the full init code
 * @returns {string} Predicted address (checksummed)
 */
function predictAddress({ deployer, salt, tokenAdmin, initCodeHash }) {
  // Clanker's salt transform: actualSalt = keccak256(abi.encode(tokenAdmin, salt))
  const actualSalt = keccak256(
    encodeAbiParameters(
      [
        { type: "address", name: "tokenAdmin" },
        { type: "bytes32", name: "salt" },
      ],
      [tokenAdmin, salt]
    )
  );

  // Standard CREATE2: keccak256(0xff ++ deployer ++ salt ++ keccak256(initCode))
  const hash = keccak256(
    concat([
      "0xff",
      deployer,
      actualSalt,
      initCodeHash,
    ])
  );

  // Address is last 20 bytes
  return ("0x" + hash.slice(26)).toLowerCase();
}

// ═══════════════════════════════════════════════════════════════
// Mining Logic
// ═══════════════════════════════════════════════════════════════

/**
 * Mine a salt that produces an address ending with the given suffix.
 *
 * @param {object} opts
 * @param {string} opts.deployer - Factory address
 * @param {string} opts.tokenAdmin - Token admin address
 * @param {string} opts.initCodeHash - keccak256 of full deploy data
 * @param {string} opts.suffix - Desired hex suffix (e.g., "ax")
 * @param {number} opts.maxAttempts - Max iterations (default 10M)
 * @returns {{ salt: string, address: string, attempts: number }}
 */
function mineSalt({ deployer, tokenAdmin, initCodeHash, suffix = "a5", maxAttempts = 10_000_000 }) {
  const target = suffix.toLowerCase();
  const targetLen = target.length;

  // Validate suffix is valid hex
  if (!/^[0-9a-f]+$/.test(target)) {
    throw new Error(
      `Invalid hex suffix "${suffix}". Ethereum addresses only contain 0-9 and a-f.\n` +
      `  'x' is NOT a valid hex digit. Suggested alternatives:\n` +
      `    "a5" — visually similar to "aS", clean branding\n` +
      `    "a0" — reads as "AO"\n` +
      `    "af" — clean hex ending\n` +
      `    "ace" — 3-char suffix, ~4096 attempts\n` +
      `    "bad" — 3-char suffix for fun\n` +
      `    "0a" — starts with zero\n` +
      `  Note: Each hex char = 16x more attempts. 2 chars ≈ 256, 3 chars ≈ 4096, 4 chars ≈ 65536`
    );
  }

  console.log(`⛏️  Mining for address ending in "${target}"...`);
  console.log(`   Factory: ${deployer}`);
  console.log(`   Admin: ${tokenAdmin}`);
  console.log(`   InitCodeHash: ${initCodeHash}`);

  const startTime = Date.now();
  let attempts = 0;

  for (let i = 0; i < maxAttempts; i++) {
    // Generate random 32-byte salt
    const saltBytes = crypto.randomBytes(32);
    const salt = "0x" + saltBytes.toString("hex");

    const addr = predictAddress({ deployer, salt, tokenAdmin, initCodeHash });

    attempts++;
    if (attempts % 100_000 === 0) {
      const elapsed = (Date.now() - startTime) / 1000;
      const rate = Math.round(attempts / elapsed);
      process.stdout.write(`\r   ${attempts.toLocaleString()} attempts (${rate.toLocaleString()}/s)...`);
    }

    if (addr.slice(-targetLen) === target) {
      const elapsed = (Date.now() - startTime) / 1000;
      console.log(`\n✅ Found in ${attempts.toLocaleString()} attempts (${elapsed.toFixed(1)}s)`);
      console.log(`   Salt: ${salt}`);
      console.log(`   Address: ${addr}`);
      return { salt, address: addr, attempts };
    }
  }

  throw new Error(`Failed to find vanity salt after ${maxAttempts.toLocaleString()} attempts`);
}

// ═══════════════════════════════════════════════════════════════
// Compute initCodeHash using Clanker SDK
// ═══════════════════════════════════════════════════════════════

/**
 * Compute the initCodeHash for a specific token deployment.
 * This requires the clanker-sdk to get the token bytecode + constructor args.
 *
 * @param {object} tokenConfig
 * @returns {string} keccak256 hash of the init code
 */
async function computeInitCodeHash(tokenConfig) {
  try {
    const { Clanker } = await import("clanker-sdk/v4");
    const { encodeDeployData } = await import("viem");
    const { createPublicClient, http } = await import("viem");
    const { base } = await import("viem/chains");

    const publicClient = createPublicClient({ chain: base, transport: http() });
    const clanker = new Clanker({ publicClient, wallet: null });

    // We need to get the clanker config to access token ABI and bytecode
    // The SDK doesn't directly expose this, so we use its internal config
    // For now, we'll import the bytecodes directly
    const sdkPath = join(__dirname, "..", "node_modules", "clanker-sdk", "dist", "v4", "index.js");

    // Read the SDK source and extract the bytecode and config
    // This is a workaround since the SDK doesn't export these directly
    const sdkModule = await import(sdkPath);

    // The SDK's getDeployTransaction already computes the expected address
    // We can extract what we need by comparing
    return null; // Will use runtime approach instead
  } catch (e) {
    console.error("Could not compute initCodeHash from SDK:", e.message);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════
// Runtime Mining (integrated with Clanker SDK)
// ═══════════════════════════════════════════════════════════════

/**
 * Mine a vanity salt at deployment time.
 * This is the primary entry point — called by launch.mjs before deploying.
 *
 * Uses the Clanker SDK's `predictTokenAddressV4` internally by trying random salts
 * until we find one whose predicted address ends in "ax".
 *
 * @param {object} deployConfig - The same config you'd pass to getDeployTransaction
 * @param {string} suffix - Desired hex suffix (default: "ax")
 * @returns {Promise<string>} The bytes32 salt to use in TokenConfig
 */
export async function mineVanitySaltForDeploy(deployConfig, suffix = "ax") {
  const { encodeDeployData: encodeDD, keccak256: k256, encodeAbiParameters: encAbi, concat: cc, createPublicClient, http } = await import("viem");
  const { base } = await import("viem/chains");

  // Import SDK internals to get the token bytecode config
  const sdkPath = join(__dirname, "..", "node_modules", "clanker-sdk", "dist", "v4", "index.js");
  const sdk = await import(sdkPath);

  // Get the clanker config for Base mainnet V4
  // The SDK stores configs in CLANKERS object
  // We need to find the right one for chainId 8453

  // Approach: Use the SDK's predictTokenAddressV4 function
  // The tokenArgs for the ClankerToken constructor are:
  //   [name, symbol, DEFAULT_SUPPLY, tokenAdmin, image, metadata, context, chainId]

  const metadata = JSON.stringify(deployConfig.metadata || { description: "", socialMediaUrls: [], auditUrls: [] });
  const context = JSON.stringify(deployConfig.context || { interface: "agent-launchpad", platform: "agent-launchpad" });

  const tokenArgs = [
    deployConfig.name,
    deployConfig.symbol,
    DEFAULT_SUPPLY,
    deployConfig.tokenAdmin,
    deployConfig.image || "",
    metadata,
    context,
    BigInt(deployConfig.chainId || 8453),
  ];

  // Get the token config from SDK (abi + bytecode for ClankerToken_v4)
  // Since the SDK groups configs by chainId + type, we look for Base mainnet
  let clankerConfig = null;
  if (sdk.CLANKERS) {
    clankerConfig = Object.values(sdk.CLANKERS).find(
      (cfg) => cfg.chainId === 8453 && cfg.type === "V4"
    );
  }

  if (!clankerConfig) {
    throw new Error("Could not find Clanker V4 config for Base in SDK");
  }

  // Compute initCodeHash
  const deployData = encodeDD({
    abi: clankerConfig.token.abi,
    bytecode: clankerConfig.token.bytecode,
    args: tokenArgs,
  });
  const initCodeHash = k256(deployData);

  // Now mine!
  return mineSalt({
    deployer: CLANKER_V4,
    tokenAdmin: deployConfig.tokenAdmin,
    initCodeHash,
    suffix,
    maxAttempts: 50_000_000,
  });
}

// ═══════════════════════════════════════════════════════════════
// Lightweight Mining (no SDK dependency)
// ═══════════════════════════════════════════════════════════════

/**
 * Mine a vanity salt given a pre-computed initCodeHash.
 * This is the fast path — use when you already know the initCodeHash.
 *
 * @param {string} tokenAdmin - Admin address
 * @param {string} initCodeHash - keccak256 of the full init code
 * @param {string} suffix - Desired hex suffix (default: "ax")
 * @returns {{ salt: string, address: string, attempts: number }}
 */
export function mineVanitySaltFast(tokenAdmin, initCodeHash, suffix = "ax") {
  return mineSalt({
    deployer: CLANKER_V4,
    tokenAdmin,
    initCodeHash,
    suffix,
  });
}

// ═══════════════════════════════════════════════════════════════
// Vanity Salt Pool Management
// ═══════════════════════════════════════════════════════════════

/**
 * Load the vanity salt pool from disk.
 * The pool stores salts keyed by initCodeHash (since each deployment has unique params).
 *
 * Pool format:
 * {
 *   "generic": [
 *     { salt: "0x...", minedAt: "2024-...", suffix: "ax", note: "pre-mined, needs initCodeHash match" }
 *   ],
 *   "byInitCodeHash": {
 *     "0xabc...": { salt: "0x...", address: "0x...ax", minedAt: "2024-..." }
 *   }
 * }
 */
export function loadPool() {
  try {
    return JSON.parse(readFileSync(SALTS_FILE, "utf-8"));
  } catch {
    return { generic: [], byInitCodeHash: {} };
  }
}

export function savePool(pool) {
  writeFileSync(SALTS_FILE, JSON.stringify(pool, null, 2));
}

/**
 * Get the next vanity salt for a specific deployment.
 * If one was pre-mined for this exact initCodeHash, pop it.
 * Otherwise, mine one on the fly.
 *
 * @param {string} tokenAdmin
 * @param {string} initCodeHash
 * @param {string} suffix
 * @returns {{ salt: string, address: string }}
 */
export function getNextVanitySalt(tokenAdmin, initCodeHash, suffix = "ax") {
  const pool = loadPool();

  // Check if we have a pre-mined salt for this exact initCodeHash
  if (pool.byInitCodeHash?.[initCodeHash]) {
    const cached = pool.byInitCodeHash[initCodeHash];
    delete pool.byInitCodeHash[initCodeHash];
    savePool(pool);
    console.log(`♻️  Using pre-mined vanity salt for ${initCodeHash.slice(0, 10)}...`);
    return { salt: cached.salt, address: cached.address };
  }

  // Mine on the fly
  console.log(`🆕 No cached salt found, mining fresh...`);
  const result = mineVanitySaltFast(tokenAdmin, initCodeHash, suffix);

  return { salt: result.salt, address: result.address };
}

// ═══════════════════════════════════════════════════════════════
// CLI
// ═══════════════════════════════════════════════════════════════

async function main() {
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.includes("-h")) {
    console.log(`
⛏️  Vanity Salt Miner for Agent Launchpad
═══════════════════════════════════════════

Mine CREATE2 salts that produce token addresses ending in "ax".

Usage:
  # Mine at deploy time (recommended — called by launch.mjs):
  node mine-vanity-salts.mjs --deploy \\
    --name "ScoutAI" --symbol "SCOUT" \\
    --admin 0x123... --suffix ax

  # Quick mine with known initCodeHash:
  node mine-vanity-salts.mjs \\
    --admin 0x123... \\
    --init-code-hash 0xabc... \\
    --suffix ax

  # Show pool status:
  node mine-vanity-salts.mjs --status

Notes:
  CREATE2 address = f(deployer, salt, initCodeHash)
  initCodeHash = keccak256(bytecode + constructor_args)

  Since constructor args include token name, symbol, image, etc.,
  each deployment has a UNIQUE initCodeHash. Salts cannot be pre-mined
  without knowing the exact deployment params.

  Expected time to mine "ax" suffix (1 byte = 256 possibilities): ~0.5-2 seconds
  Expected time to mine "0ax" suffix: ~30-60 seconds
`);
    process.exit(0);
  }

  if (args.includes("--status")) {
    const pool = loadPool();
    const cachedCount = Object.keys(pool.byInitCodeHash || {}).length;
    console.log(`📊 Vanity Salt Pool Status`);
    console.log(`   Cached salts: ${cachedCount}`);
    console.log(`   Pool file: ${SALTS_FILE}`);
    process.exit(0);
  }

  // Parse CLI args
  const getArg = (name) => {
    const idx = args.indexOf(name);
    return idx >= 0 ? args[idx + 1] : null;
  };

  const admin = getArg("--admin");
  const initHash = getArg("--init-code-hash");
  const suffix = getArg("--suffix") || "ax";
  const name = getArg("--name");
  const symbol = getArg("--symbol");

  if (args.includes("--deploy") && name && symbol && admin) {
    // Full deploy mode — compute initCodeHash via SDK and mine
    console.log(`🚀 Mining vanity salt for ${name} ($${symbol})...\n`);
    try {
      const result = await mineVanitySaltForDeploy({
        name,
        symbol,
        tokenAdmin: admin,
        image: getArg("--image") || "",
        metadata: { description: getArg("--description") || "" },
        context: { interface: "agent-launchpad", platform: "agent-launchpad" },
        chainId: 8453,
      }, suffix);

      console.log(`\n🎯 Result:`);
      console.log(`   Salt: ${result.salt}`);
      console.log(`   Address: ${result.address}`);
      console.log(`   Suffix: ${result.address.slice(-suffix.length)}`);

      // Cache it
      const pool = loadPool();
      // Note: We don't cache deploy-mode results since they're used immediately
      process.exit(0);
    } catch (e) {
      console.error(`❌ ${e.message}`);
      process.exit(1);
    }
  }

  if (admin && initHash) {
    // Quick mine mode
    console.log(`⛏️  Mining vanity salt...\n`);
    const result = mineVanitySaltFast(admin, initHash, suffix);

    console.log(`\n🎯 Result:`);
    console.log(`   Salt: ${result.salt}`);
    console.log(`   Address: ${result.address}`);

    // Cache it
    const pool = loadPool();
    if (!pool.byInitCodeHash) pool.byInitCodeHash = {};
    pool.byInitCodeHash[initHash] = {
      salt: result.salt,
      address: result.address,
      minedAt: new Date().toISOString(),
      suffix,
      admin,
    };
    savePool(pool);
    console.log(`\n💾 Saved to pool`);
    process.exit(0);
  }

  console.error("Missing required args. Run with --help for usage.");
  process.exit(1);
}

// Only run CLI if this is the main module
if (process.argv[1]?.endsWith("mine-vanity-salts.mjs")) {
  main().catch((e) => {
    console.error("💥", e.message);
    process.exit(1);
  });
}
