#!/usr/bin/env node
/**
 * Agent Launchpad — Interactive Setup
 * 
 * Walks an agent through everything needed to launch:
 * name, symbol, description, image, socials → deploy
 * 
 * Usage: npx @axiombot/agent-launchpad setup
 */

import { createInterface } from 'readline';
import { existsSync, readFileSync, statSync } from 'fs';
import { extname, resolve } from 'path';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));

const rl = createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((r) => rl.question(q, r));

// Image constraints
const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5MB
const SUPPORTED_FORMATS = ['.png', '.jpg', '.jpeg', '.gif', '.webp'];
const RECOMMENDED_SIZE = '500x500 to 1000x1000 px';

async function main() {
  console.log(`
🚀 Agent Launchpad — Token Setup
═══════════════════════════════════
  Let's get your agent onchain.
  This will create a token on Base with
  75% of LP trading fees going to you.
`);

  // 1. Name
  const name = await ask('📛 Token name (e.g. "Scout"): ');
  if (!name || name.length > 50) {
    console.log('❌ Name is required (max 50 chars)');
    process.exit(1);
  }

  // 2. Symbol
  const defaultSymbol = name.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
  const symbolInput = await ask(`💎 Symbol (default: ${defaultSymbol}): `);
  const symbol = symbolInput || defaultSymbol;
  if (symbol.length > 10) {
    console.log('❌ Symbol too long (max 10 chars)');
    process.exit(1);
  }

  // 3. Description
  const description = await ask('📝 Description (1-2 sentences, what does your agent do?): ');
  if (description && description.length > 500) {
    console.log('❌ Description too long (max 500 chars)');
    process.exit(1);
  }

  // 4. Admin address
  const admin = await ask('🔑 Admin wallet address (0x... — this receives 75% of fees): ');
  if (!/^0x[a-fA-F0-9]{40}$/.test(admin)) {
    console.log('❌ Invalid address. Must be 0x followed by 40 hex characters.');
    process.exit(1);
  }

  // 5. Image
  console.log(`
📸 Token Image
  Recommended: ${RECOMMENDED_SIZE}, square
  Formats: ${SUPPORTED_FORMATS.join(', ')}
  Max size: ${MAX_IMAGE_SIZE / 1024 / 1024}MB
  
  You can provide:
  • A local file path (will be uploaded to IPFS)
  • A URL (https:// or ipfs://)
  • Leave blank for no image
`);
  const imageInput = await ask('Image (path or URL): ');
  let image = '';

  if (imageInput) {
    if (imageInput.startsWith('http://') || imageInput.startsWith('https://') || imageInput.startsWith('ipfs://')) {
      image = imageInput;
      console.log(`  ✅ Using URL: ${image.slice(0, 60)}...`);
    } else {
      // Local file — validate and upload
      const filePath = resolve(imageInput);
      if (!existsSync(filePath)) {
        console.log(`  ❌ File not found: ${filePath}`);
        process.exit(1);
      }
      const ext = extname(filePath).toLowerCase();
      if (!SUPPORTED_FORMATS.includes(ext)) {
        console.log(`  ❌ Unsupported format: ${ext}. Use: ${SUPPORTED_FORMATS.join(', ')}`);
        process.exit(1);
      }
      const size = statSync(filePath).size;
      if (size > MAX_IMAGE_SIZE) {
        console.log(`  ❌ File too large: ${(size / 1024 / 1024).toFixed(1)}MB (max ${MAX_IMAGE_SIZE / 1024 / 1024}MB)`);
        console.log(`  💡 Resize to ${RECOMMENDED_SIZE} and compress before uploading.`);
        process.exit(1);
      }

      console.log(`  📤 Uploading ${(size / 1024).toFixed(0)}KB to IPFS...`);
      const uploadResult = await new Promise((resolve, reject) => {
        const child = spawn('node', [join(__dirname, '..', 'scripts', 'upload-image.mjs'), '--file', filePath], {
          stdio: ['inherit', 'pipe', 'pipe'],
        });
        let stdout = '';
        child.stdout.on('data', (d) => stdout += d.toString());
        child.stderr.on('data', (d) => process.stderr.write(d));
        child.on('close', (code) => {
          if (code === 0) resolve(stdout.trim().split('\n').pop());
          else reject(new Error('Upload failed'));
        });
      });
      image = uploadResult;
      console.log(`  ✅ Pinned: ${image}`);
    }
  }

  // 6. Social URLs
  console.log(`
🔗 Social Links (optional)
  Add links to your agent's social presence.
  Press Enter to skip each one.
`);
  const twitter = await ask('  Twitter/X URL: ');
  const website = await ask('  Website URL: ');
  const telegram = await ask('  Telegram URL: ');

  const socialUrls = [];
  if (twitter) socialUrls.push({ platform: 'twitter', url: twitter });
  if (website) socialUrls.push({ platform: 'website', url: website });
  if (telegram) socialUrls.push({ platform: 'telegram', url: telegram });

  // 7. Confirm
  console.log(`
═══════════════════════════════════
  Ready to launch!
  
  Name:        ${name}
  Symbol:      $${symbol}
  Description: ${description || '(none)'}
  Admin:       ${admin}
  Image:       ${image || '(none)'}
  Socials:     ${socialUrls.length > 0 ? socialUrls.map(s => s.url).join(', ') : '(none)'}
  Chain:       Base
  Fees:        Agent 75% | Protocol 25%
  Cost:        FREE
═══════════════════════════════════
`);

  const confirm = await ask('Deploy? (y/n): ');
  rl.close();

  if (confirm.toLowerCase() !== 'y') {
    console.log('Cancelled.');
    process.exit(0);
  }

  // 8. Deploy
  const args = ['--name', name, '--symbol', symbol, '--admin', admin];
  if (description) args.push('--description', description);
  if (image) args.push('--image', image);
  if (twitter) args.push('--social-twitter', twitter);
  if (website) args.push('--social-website', website);
  if (telegram) args.push('--social-telegram', telegram);

  const deploy = spawn('node', [join(__dirname, '..', 'scripts', 'deploy-token.mjs'), ...args], {
    stdio: 'inherit',
    env: process.env,
  });
  deploy.on('close', (code) => process.exit(code));
}

main().catch((e) => {
  console.error(`❌ ${e.message}`);
  process.exit(1);
});
