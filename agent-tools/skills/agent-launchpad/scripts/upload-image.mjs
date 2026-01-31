#!/usr/bin/env node
/**
 * upload-image.mjs — Image Upload for Agent Launchpad
 * 
 * Uploads local image files to IPFS via Pinata and returns the
 * permanent gateway URL for use in token launches.
 * 
 * Usage:
 *   node scripts/upload-image.mjs --file ./avatar.png
 *   # Output: https://gateway.pinata.cloud/ipfs/Qm...
 * 
 * Supported formats: png, jpg, jpeg, gif, webp
 * 
 * Environment:
 *   PINATA_JWT — Pinata JWT token (or stored in ~/.axiom/wallet.env)
 */

import { readFileSync, existsSync } from "fs";
import { extname, basename, join } from "path";
import { homedir } from "os";

// ═══════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════

const SUPPORTED_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp'];
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
const PINATA_API_URL = "https://api.pinata.cloud/pinning/pinFileToIPFS";
const PINATA_GATEWAY = "https://gateway.pinata.cloud/ipfs";

// ═══════════════════════════════════════════════════════════════
// Load Pinata credentials
// ═══════════════════════════════════════════════════════════════

function loadPinataJwt() {
  // Check env var first
  if (process.env.PINATA_JWT) return process.env.PINATA_JWT;

  // Fallback to wallet.env
  const walletEnvPath = join(homedir(), ".axiom", "wallet.env");
  if (existsSync(walletEnvPath)) {
    const envFile = readFileSync(walletEnvPath, "utf-8");
    const match = envFile.match(/PINATA_JWT="([^"]+)"/);
    if (match) return match[1];
  }

  throw new Error(
    "Pinata JWT not found. Set PINATA_JWT env var or add to ~/.axiom/wallet.env"
  );
}

// ═══════════════════════════════════════════════════════════════
// CLI Argument Parsing
// ═══════════════════════════════════════════════════════════════

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { file: null, help: false };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--file":
      case "-f":
        opts.file = args[++i];
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
📤 Image Upload for Agent Launchpad
═══════════════════════════════════

Upload local images to IPFS (Pinata) for use in token launches.

Usage:
  node scripts/upload-image.mjs --file <path>

Arguments:
  --file, -f    Path to image file (png, jpg, gif, webp)
  --help, -h    Show this help

Examples:
  node scripts/upload-image.mjs --file ./avatar.png
  node scripts/upload-image.mjs --file /path/to/image.jpg

Supported formats: ${SUPPORTED_EXTENSIONS.join(', ')}

Environment:
  PINATA_JWT    Pinata JWT token (or stored in ~/.axiom/wallet.env)
`);
}

// ═══════════════════════════════════════════════════════════════
// File Validation
// ═══════════════════════════════════════════════════════════════

function validateFile(filePath) {
  if (!existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const ext = extname(filePath).toLowerCase();
  if (!SUPPORTED_EXTENSIONS.includes(ext)) {
    throw new Error(`Unsupported file type: ${ext}. Supported: ${SUPPORTED_EXTENSIONS.join(', ')}`);
  }

  const buffer = readFileSync(filePath);
  if (buffer.length > MAX_FILE_SIZE) {
    throw new Error(`File too large: ${(buffer.length / 1024 / 1024).toFixed(1)}MB. Max: 50MB`);
  }

  return { ext, size: buffer.length, buffer };
}

function getMimeType(ext) {
  const types = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
  };
  return types[ext] || 'application/octet-stream';
}

// ═══════════════════════════════════════════════════════════════
// Upload to Pinata IPFS
// ═══════════════════════════════════════════════════════════════

async function uploadToPinata(filePath) {
  const jwt = loadPinataJwt();
  const { ext, size, buffer } = validateFile(filePath);
  const filename = basename(filePath);

  console.error(`📤 Uploading ${filename} (${(size / 1024).toFixed(1)}KB) to IPFS...`);

  const formData = new FormData();
  formData.append('file', new Blob([buffer], { type: getMimeType(ext) }), filename);
  formData.append('pinataMetadata', JSON.stringify({ name: filename }));

  const response = await fetch(PINATA_API_URL, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${jwt}` },
    body: formData,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Pinata upload failed (${response.status}): ${text}`);
  }

  const data = await response.json();
  const ipfsHash = data.IpfsHash;
  if (!ipfsHash) {
    throw new Error(`No IPFS hash in response: ${JSON.stringify(data)}`);
  }

  return `${PINATA_GATEWAY}/${ipfsHash}`;
}

// ═══════════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════════

async function main() {
  const opts = parseArgs();

  if (opts.help || !opts.file) {
    showHelp();
    process.exit(opts.help ? 0 : 1);
  }

  try {
    const url = await uploadToPinata(opts.file);
    // URL to stdout for script consumption
    console.log(url);
    console.error(`✅ Pinned to IPFS: ${url}`);
  } catch (error) {
    console.error(`❌ ${error.message}`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(`💥 Unexpected error: ${error.message}`);
  process.exit(1);
});
