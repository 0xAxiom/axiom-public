#!/usr/bin/env node
/**
 * upload-image.mjs — Image Upload for Agent Launchpad
 * 
 * Automatically resizes and compresses images to fit Clanker requirements,
 * then uploads to IPFS via Pinata.
 * 
 * Clanker requirements:
 *   - Format: JPEG or PNG only
 *   - Max size: 1MB
 *   - Recommended: 500x500 square
 * 
 * This script handles all of that automatically.
 * 
 * Usage:
 *   node scripts/upload-image.mjs --file ./avatar.png
 *   # Output: https://gateway.pinata.cloud/ipfs/bafy...
 * 
 * Requirements:
 *   - Pinata CLI: brew install PinataCloud/ipfs-cli/ipfs-cli
 *   - Auth: pinata auth (or write JWT to ~/.pinata-files-cli)
 */

import { readFileSync, writeFileSync, existsSync, statSync, mkdirSync, unlinkSync } from "fs";
import { extname, basename, join } from "path";
import { homedir } from "os";
import { execSync } from "child_process";
import { createRequire } from "module";

const require = createRequire(import.meta.url);

// ═══════════════════════════════════════════════════════════════
// Clanker Image Requirements (from clanker.world/deploy)
// ═══════════════════════════════════════════════════════════════

const CLANKER_MAX_SIZE = 1 * 1024 * 1024;  // 1MB — Clanker's hard limit
const CLANKER_TARGET_SIZE = 500;             // 500x500px — optimal display
const CLANKER_MAX_DIMENSION = 1000;          // Don't go over 1000px
const CLANKER_FORMATS = ['.png', '.jpg', '.jpeg']; // Clanker only accepts these
const INPUT_FORMATS = ['.png', '.jpg', '.jpeg', '.gif', '.webp']; // We accept more and convert
const PINATA_GATEWAY = "https://gateway.pinata.cloud/ipfs";

// ═══════════════════════════════════════════════════════════════
// CLI
// ═══════════════════════════════════════════════════════════════

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { file: null, help: false, noResize: false };
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--file": case "-f": opts.file = args[++i]; break;
      case "--no-resize": opts.noResize = true; break;
      case "--help": case "-h": opts.help = true; break;
    }
  }
  return opts;
}

function showHelp() {
  console.log(`
📤 Image Upload for Agent Launchpad
═══════════════════════════════════

Automatically resizes, compresses, and uploads images for token launches.

Clanker Requirements (handled automatically):
  • Format: JPEG or PNG only
  • Max file size: 1MB
  • Recommended: 500x500px square

Usage:
  node scripts/upload-image.mjs --file <path>

Arguments:
  --file, -f     Path to image file
  --no-resize    Skip auto-resize (use if your image is already optimized)
  --help, -h     Show this help

Input formats: ${INPUT_FORMATS.join(', ')} (auto-converted to PNG/JPEG)

The script will:
  1. Validate the input file
  2. Resize to 500x500 if larger (maintaining square crop)
  3. Compress to under 1MB
  4. Convert GIF/WebP to PNG
  5. Upload to IPFS via Pinata

Setup:
  Option 1: brew install PinataCloud/ipfs-cli/ipfs-cli && pinata auth
  Option 2: Set PINATA_JWT environment variable
`);
}

// ═══════════════════════════════════════════════════════════════
// Image Processing (sharp)
// ═══════════════════════════════════════════════════════════════

async function processImage(filePath) {
  let sharp;
  try {
    sharp = require('sharp');
  } catch {
    console.error(`⚠️  sharp not installed — skipping auto-resize.`);
    console.error(`   Install with: npm install sharp`);
    console.error(`   Image must be JPEG/PNG, under 1MB, ~500x500px`);
    
    // Validate raw file meets Clanker requirements
    const ext = extname(filePath).toLowerCase();
    if (!CLANKER_FORMATS.includes(ext)) {
      throw new Error(`Clanker only accepts JPEG/PNG. Got: ${ext}. Install sharp for auto-conversion.`);
    }
    const size = statSync(filePath).size;
    if (size > CLANKER_MAX_SIZE) {
      throw new Error(`File is ${(size / 1024 / 1024).toFixed(1)}MB. Clanker max is 1MB. Install sharp for auto-compression.`);
    }
    return filePath; // Return as-is
  }

  const metadata = await sharp(filePath).metadata();
  const { width, height, format } = metadata;
  console.error(`  Input: ${width}x${height} ${format} (${(statSync(filePath).size / 1024).toFixed(0)}KB)`);

  // Determine output format
  const isJpeg = format === 'jpeg' || format === 'jpg';
  const outputFormat = isJpeg ? 'jpeg' : 'png';
  const outputExt = isJpeg ? '.jpg' : '.png';

  // Create temp directory
  const tmpDir = join(homedir(), '.agent-launchpad', 'tmp');
  if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });
  const tmpFile = join(tmpDir, `processed-${Date.now()}${outputExt}`);

  // Build processing pipeline
  let pipeline = sharp(filePath);

  // Resize if needed — crop to square, then resize to target
  const maxDim = Math.max(width, height);
  const minDim = Math.min(width, height);
  
  if (maxDim > CLANKER_TARGET_SIZE || width !== height) {
    // Crop to square (center crop) then resize
    const cropSize = Math.min(minDim, maxDim);
    pipeline = pipeline
      .resize(CLANKER_TARGET_SIZE, CLANKER_TARGET_SIZE, {
        fit: 'cover',
        position: 'center',
      });
    console.error(`  Resized: ${CLANKER_TARGET_SIZE}x${CLANKER_TARGET_SIZE} (square crop)`);
  }

  // Compress based on format
  if (outputFormat === 'jpeg') {
    pipeline = pipeline.jpeg({ quality: 85, mozjpeg: true });
  } else {
    pipeline = pipeline.png({ compressionLevel: 9, adaptiveFiltering: true });
  }

  await pipeline.toFile(tmpFile);

  // Check if under 1MB, if not, compress more aggressively
  let fileSize = statSync(tmpFile).size;
  if (fileSize > CLANKER_MAX_SIZE) {
    console.error(`  Still ${(fileSize / 1024).toFixed(0)}KB — compressing more...`);
    
    if (outputFormat === 'jpeg') {
      // Try lower quality
      for (const quality of [70, 55, 40]) {
        await sharp(filePath)
          .resize(CLANKER_TARGET_SIZE, CLANKER_TARGET_SIZE, { fit: 'cover', position: 'center' })
          .jpeg({ quality, mozjpeg: true })
          .toFile(tmpFile);
        fileSize = statSync(tmpFile).size;
        if (fileSize <= CLANKER_MAX_SIZE) break;
      }
    } else {
      // Convert PNG to JPEG for better compression
      const jpegTmp = tmpFile.replace('.png', '.jpg');
      await sharp(filePath)
        .resize(CLANKER_TARGET_SIZE, CLANKER_TARGET_SIZE, { fit: 'cover', position: 'center' })
        .jpeg({ quality: 80, mozjpeg: true })
        .toFile(jpegTmp);
      
      // Clean up PNG temp
      if (existsSync(tmpFile)) unlinkSync(tmpFile);
      fileSize = statSync(jpegTmp).size;
      console.error(`  Converted to JPEG for better compression`);
      
      console.error(`  Output: ${CLANKER_TARGET_SIZE}x${CLANKER_TARGET_SIZE} JPEG (${(fileSize / 1024).toFixed(0)}KB)`);
      return jpegTmp;
    }
  }

  if (fileSize > CLANKER_MAX_SIZE) {
    throw new Error(`Could not compress below 1MB (got ${(fileSize / 1024 / 1024).toFixed(1)}MB). Try a simpler image.`);
  }

  console.error(`  Output: ${CLANKER_TARGET_SIZE}x${CLANKER_TARGET_SIZE} ${outputFormat.toUpperCase()} (${(fileSize / 1024).toFixed(0)}KB)`);
  return tmpFile;
}

// ═══════════════════════════════════════════════════════════════
// Upload via Pinata CLI (preferred)
// ═══════════════════════════════════════════════════════════════

function hasPinataCli() {
  try {
    execSync('which pinata', { stdio: 'pipe' });
    return existsSync(join(homedir(), '.pinata-files-cli'));
  } catch { return false; }
}

function uploadViaCli(filePath) {
  const filename = basename(filePath);
  const result = execSync(`pinata upload "${filePath}" --name "${filename}"`, {
    encoding: 'utf-8',
    timeout: 30000,
  });
  const data = JSON.parse(result.trim());
  if (!data.cid) throw new Error('No CID in Pinata CLI response');
  return `${PINATA_GATEWAY}/${data.cid}`;
}

// ═══════════════════════════════════════════════════════════════
// Upload via Pinata V3 API (fallback)
// ═══════════════════════════════════════════════════════════════

function loadPinataJwt() {
  if (process.env.PINATA_JWT) return process.env.PINATA_JWT;
  const paths = [
    join(homedir(), ".pinata-files-cli"),
    join(homedir(), ".agent-launchpad", "credentials.env"),
    join(homedir(), ".axiom", "wallet.env"),
  ];
  for (const p of paths) {
    if (!existsSync(p)) continue;
    const content = readFileSync(p, "utf-8").trim();
    if (content.startsWith('eyJ')) return content;
    const match = content.match(/PINATA_JWT=["']?([^\s"']+)["']?/);
    if (match) return match[1];
  }
  throw new Error('Pinata JWT not found. Run: pinata auth (or set PINATA_JWT env var)');
}

async function uploadViaApi(filePath) {
  const jwt = loadPinataJwt();
  const filename = basename(filePath);
  const ext = extname(filePath).toLowerCase();
  const mimeType = ext === '.png' ? 'image/png' : 'image/jpeg';
  const buffer = readFileSync(filePath);

  const formData = new FormData();
  formData.append('file', new Blob([buffer], { type: mimeType }), filename);
  formData.append('network', 'public');

  const response = await fetch('https://uploads.pinata.cloud/v3/files', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${jwt}` },
    body: formData,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Pinata upload failed (${response.status}): ${text}`);
  }

  const data = await response.json();
  const cid = data.data?.cid;
  if (!cid) throw new Error(`No CID in response: ${JSON.stringify(data)}`);
  return `${PINATA_GATEWAY}/${cid}`;
}

// ═══════════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════════

async function main() {
  const opts = parseArgs();
  if (opts.help || !opts.file) { showHelp(); process.exit(opts.help ? 0 : 1); }

  const filePath = opts.file;

  // Validate input exists
  if (!existsSync(filePath)) {
    console.error(`❌ File not found: ${filePath}`);
    process.exit(1);
  }

  const ext = extname(filePath).toLowerCase();
  if (!INPUT_FORMATS.includes(ext)) {
    console.error(`❌ Unsupported format: ${ext}. Use: ${INPUT_FORMATS.join(', ')}`);
    process.exit(1);
  }

  try {
    const originalSize = statSync(filePath).size;
    console.error(`📤 Processing ${basename(filePath)} (${(originalSize / 1024).toFixed(0)}KB)...`);

    // Process image (resize, compress, convert)
    let processedFile;
    if (opts.noResize) {
      // Validate meets Clanker requirements
      if (!CLANKER_FORMATS.includes(ext)) {
        console.error(`❌ Clanker only accepts JPEG/PNG. Use without --no-resize for auto-conversion.`);
        process.exit(1);
      }
      if (originalSize > CLANKER_MAX_SIZE) {
        console.error(`❌ File is ${(originalSize / 1024 / 1024).toFixed(1)}MB. Clanker max is 1MB. Remove --no-resize for auto-compression.`);
        process.exit(1);
      }
      processedFile = filePath;
    } else {
      processedFile = await processImage(filePath);
    }

    // Upload
    let url;
    if (hasPinataCli()) {
      console.error(`  Uploading via Pinata CLI...`);
      url = uploadViaCli(processedFile);
    } else {
      console.error(`  Uploading via Pinata API...`);
      url = await uploadViaApi(processedFile);
    }

    // Clean up temp file
    if (processedFile !== filePath && existsSync(processedFile)) {
      unlinkSync(processedFile);
    }

    // URL to stdout
    console.log(url);
    console.error(`✅ Pinned: ${url}`);
  } catch (error) {
    console.error(`❌ ${error.message}`);
    process.exit(1);
  }
}

main();
