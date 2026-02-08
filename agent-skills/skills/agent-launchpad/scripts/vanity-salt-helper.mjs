/**
 * vanity-salt-helper.mjs — Vanity salt integration for launch.mjs
 *
 * Import this in launch.mjs to automatically mine "ax" suffix salts at deploy time.
 *
 * Usage in launch.mjs:
 *   import { findVanitySalt } from "./vanity-salt-helper.mjs";
 *
 *   // Before calling clanker.getDeployTransaction():
 *   const vanitySalt = await findVanitySalt({
 *     name: opts.name,
 *     symbol: opts.symbol,
 *     tokenAdmin: agentAccount.address,
 *     image: imageUrl,
 *     metadata: { description: opts.description },
 *     context: { interface: "agent-launchpad", platform: "agent-launchpad" },
 *   });
 *
 *   // Then pass vanitySalt.salt in the deployConfig:
 *   const deployConfig = {
 *     ...otherConfig,
 *     salt: vanitySalt.salt,  // <-- bytes32 that produces address ending in "ax"
 *   };
 */

import { keccak256, encodeAbiParameters, concat } from "viem";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));

const CLANKER_V4 = "0xE85A59c628F7d27878ACeB4bf3b35733630083a9";
const DEFAULT_SUPPLY = 100_000_000_000n * 10n ** 18n;

/**
 * Core CREATE2 address prediction matching Clanker V4 factory logic.
 */
function predictAddress(deployer, salt, tokenAdmin, initCodeHash) {
  const actualSalt = keccak256(
    encodeAbiParameters(
      [{ type: "address" }, { type: "bytes32" }],
      [tokenAdmin, salt]
    )
  );

  const hash = keccak256(concat(["0xff", deployer, actualSalt, initCodeHash]));
  return ("0x" + hash.slice(26)).toLowerCase();
}

/**
 * Mine a bytes32 salt for a specific deployment that produces an "ax" suffix address.
 *
 * Performance: "ax" is 1 byte (256 possibilities), so on average ~128 attempts.
 * At ~200k attempts/sec in Node.js, this takes < 1 millisecond.
 *
 * @param {object} opts - Deployment config
 * @param {string} opts.name - Token name
 * @param {string} opts.symbol - Token symbol
 * @param {string} opts.tokenAdmin - Admin address
 * @param {string} [opts.image] - Token image URL
 * @param {object} [opts.metadata] - Token metadata
 * @param {object} [opts.context] - Deploy context
 * @param {number} [opts.chainId] - Chain ID (default: 8453)
 * @param {string} [suffix] - Hex suffix to match (default: "ax")
 * @returns {Promise<{ salt: string, address: string, attempts: number }>}
 */
export async function findVanitySalt(opts, suffix = "a5") {
  const { encodeDeployData } = await import("viem");

  // Load SDK config to get token ABI + bytecode
  const sdkPath = join(__dirname, "..", "node_modules", "clanker-sdk", "dist", "v4", "index.js");
  const sdk = await import(sdkPath);

  let clankerConfig = null;
  if (sdk.CLANKERS) {
    clankerConfig = Object.values(sdk.CLANKERS).find(
      (cfg) => cfg.chainId === (opts.chainId || 8453) && cfg.type === "V4"
    );
  }

  if (!clankerConfig) {
    throw new Error("Could not find Clanker V4 config in SDK");
  }

  const metadata = typeof opts.metadata === "string"
    ? opts.metadata
    : JSON.stringify(opts.metadata || { description: "", socialMediaUrls: [], auditUrls: [] });

  const context = typeof opts.context === "string"
    ? opts.context
    : JSON.stringify(opts.context || { interface: "agent-launchpad", platform: "agent-launchpad" });

  const tokenArgs = [
    opts.name,
    opts.symbol,
    DEFAULT_SUPPLY,
    opts.tokenAdmin,
    opts.image || "",
    metadata,
    context,
    BigInt(opts.chainId || 8453),
  ];

  const deployData = encodeDeployData({
    abi: clankerConfig.token.abi,
    bytecode: clankerConfig.token.bytecode,
    args: tokenArgs,
  });
  const initCodeHash = keccak256(deployData);

  // Mine!
  const target = suffix.toLowerCase();
  if (!/^[0-9a-f]+$/.test(target)) {
    throw new Error(
      `Invalid hex suffix "${suffix}". Addresses only contain 0-9 and a-f. ` +
      `'x' is not hex. Try "a5", "a0", "af", or "ace" instead.`
    );
  }
  const targetLen = target.length;
  const startTime = Date.now();
  let attempts = 0;

  while (attempts < 50_000_000) {
    const saltBytes = crypto.randomBytes(32);
    const salt = "0x" + saltBytes.toString("hex");

    const addr = predictAddress(CLANKER_V4, salt, opts.tokenAdmin, initCodeHash);
    attempts++;

    if (addr.slice(-targetLen) === target) {
      const elapsed = (Date.now() - startTime) / 1000;
      return { salt, address: addr, attempts, elapsed };
    }
  }

  throw new Error(`Failed to find vanity salt after ${attempts} attempts`);
}

/**
 * Get a vanity salt for deployment.
 * Thin wrapper that logs progress.
 */
export async function getVanitySaltForLaunch(deployOpts, suffix = "a5") {
  console.log(`\n⛏️  Mining vanity salt (target: ...${suffix})...`);
  const start = Date.now();
  const result = await findVanitySalt(deployOpts, suffix);
  const elapsed = ((Date.now() - start) / 1000).toFixed(2);
  console.log(`   ✅ Found in ${result.attempts} attempts (${elapsed}s)`);
  console.log(`   🎯 Address will end in: ...${result.address.slice(-4)}`);
  return result;
}
