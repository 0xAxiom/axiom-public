#!/usr/bin/env node
/**
 * article-pipeline — markdown draft → X Articles-ready package
 *
 * Takes a markdown file and produces:
 * 1. Validated markdown (structure + style checks)
 * 2. Rich HTML for X Articles clipboard paste
 * 3. 5:2 banner image (fal.ai + optional text overlay)
 * 4. Manifest JSON with metadata
 *
 * Usage:
 *   node pipeline.mjs article.md [options]
 *
 * Options:
 *   --validate-only       Just validate, don't generate anything
 *   --html-only           Generate HTML only (no banner)
 *   --banner-only         Generate banner only (no HTML)
 *   --banner-prompt "..." Custom fal.ai prompt for banner base image
 *   --banner-overlay "..."  Title text for banner overlay
 *   --banner-subtitle "..." Subtitle for banner overlay
 *   --output-dir /path    Output directory (default: /tmp/article-pipeline)
 *   --telegram            Print Telegram delivery instructions
 *   --no-overlay          Skip text overlay on banner
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { execSync } from 'child_process';
import { join, resolve } from 'path';

// ── Config ─────────────────────────────────────────────────
const SLOP_PHRASES = [
  'dive in', 'dive into', "let's explore", 'in the ever-evolving',
  'landscape of', 'without further ado', "i'd be happy to",
  'game-changer', 'game changer', 'buckle up', 'strap in',
  'in this article we will', 'in today\'s world',
  'revolutionize', 'cutting-edge', 'next-level',
  'harness the power', 'unlock the potential',
  'seamlessly', 'robust and scalable', 'leveraging',
];

const MAX_WORDS = 1500;
const MIN_SECTIONS = 3;
const BANNER_WIDTH = 1250;
const BANNER_HEIGHT = 500;

// ── Parse args ─────────────────────────────────────────────
const args = process.argv.slice(2);
const inputFile = args.find(a => !a.startsWith('--'));

if (!inputFile) {
  console.error('Usage: node pipeline.mjs <article.md> [options]');
  process.exit(1);
}

function getFlag(name) {
  return args.includes(`--${name}`);
}

function getOption(name) {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1 || idx + 1 >= args.length) return null;
  return args[idx + 1];
}

const validateOnly = getFlag('validate-only');
const htmlOnly = getFlag('html-only');
const bannerOnly = getFlag('banner-only');
const telegramMode = getFlag('telegram');
const noOverlay = getFlag('no-overlay');
const outputDir = getOption('output-dir') || '/tmp/article-pipeline';
const bannerPrompt = getOption('banner-prompt');
const bannerOverlay = getOption('banner-overlay');
const bannerSubtitle = getOption('banner-subtitle');

// ── Read and validate ──────────────────────────────────────
if (!existsSync(inputFile)) {
  console.error(`Error: File not found: ${inputFile}`);
  process.exit(1);
}

let markdown = readFileSync(inputFile, 'utf-8');
const issues = [];
const warnings = [];

// Strip em dashes
const emDashCount = (markdown.match(/—/g) || []).length;
if (emDashCount > 0) {
  markdown = markdown.replace(/ — /g, ', ').replace(/—/g, ',');
  warnings.push(`Replaced ${emDashCount} em dashes with commas`);
}

// Extract title (first H1)
const titleMatch = markdown.match(/^#\s+(.+)$/m);
const title = titleMatch ? titleMatch[1].trim() : null;
if (!title) {
  issues.push('Missing H1 title');
}

// Count sections (H2 headers)
const sections = markdown.match(/^##\s+.+$/gm) || [];
if (sections.length < MIN_SECTIONS) {
  issues.push(`Only ${sections.length} sections (H2), need at least ${MIN_SECTIONS}`);
}

// Word count (excluding code blocks)
const textOnly = markdown.replace(/```[\s\S]*?```/g, '').replace(/`[^`]+`/g, '');
const wordCount = textOnly.split(/\s+/).filter(w => w.length > 0).length;
if (wordCount > MAX_WORDS) {
  warnings.push(`${wordCount} words (target: under ${MAX_WORDS})`);
}

// Check for code blocks
const codeBlocks = markdown.match(/```\w+[\s\S]*?```/g) || [];
const hasCodeBlocks = codeBlocks.length > 0;

// Slop detection (exclude code blocks)
const textWithoutCode = markdown.replace(/```[\s\S]*?```/g, '').replace(/`[^`]+`/g, '');
const lowerText = textWithoutCode.toLowerCase();
const foundSlop = SLOP_PHRASES.filter(phrase => lowerText.includes(phrase));
if (foundSlop.length > 0) {
  issues.push(`AI slop detected: ${foundSlop.map(s => `"${s}"`).join(', ')}`);
}

// Extract subtitle (first blockquote after H1, or second line)
let subtitle = null;
const subtitleMatch = markdown.match(/^#\s+.+\n+>\s*(.+)$/m);
if (subtitleMatch) {
  subtitle = subtitleMatch[1].trim();
}

// ── Print validation results ───────────────────────────────
console.log('┌─────────────────────────────────────────┐');
console.log('│  Article Pipeline                        │');
console.log('└─────────────────────────────────────────┘');
console.log('');
console.log(`  Title:    ${title || '(missing)'}`);
console.log(`  Words:    ${wordCount}`);
console.log(`  Sections: ${sections.length}`);
console.log(`  Code:     ${codeBlocks.length} blocks`);
if (subtitle) console.log(`  Subtitle: ${subtitle}`);
console.log('');

if (issues.length > 0) {
  console.log('  ❌ Issues:');
  issues.forEach(i => console.log(`     - ${i}`));
}
if (warnings.length > 0) {
  console.log('  ⚠️  Warnings:');
  warnings.forEach(w => console.log(`     - ${w}`));
}
if (issues.length === 0 && warnings.length === 0) {
  console.log('  ✅ All checks passed');
}
console.log('');

if (validateOnly) {
  process.exit(issues.length > 0 ? 1 : 0);
}

// ── Create output directory ────────────────────────────────
mkdirSync(outputDir, { recursive: true });

// Write cleaned markdown
const articlePath = join(outputDir, 'article.md');
writeFileSync(articlePath, markdown);
console.log(`  📄 Markdown: ${articlePath}`);

// ── Generate HTML ──────────────────────────────────────────
if (!bannerOnly) {
  const htmlPath = join(outputDir, 'article.html');

  // Convert markdown to HTML using the x-article-publisher parse_markdown.py
  const parserScript = resolve(
    process.env.HOME,
    '.clawdbot/skills/x-article-publisher/scripts/parse_markdown.py'
  );

  if (existsSync(parserScript)) {
    try {
      const html = execSync(
        `python3 "${parserScript}" "${articlePath}" --html-only`,
        { encoding: 'utf-8', maxBuffer: 1024 * 1024 }
      ).trim();
      writeFileSync(htmlPath, html);
      console.log(`  🌐 HTML:     ${htmlPath}`);
    } catch (err) {
      console.error(`  ⚠️  HTML generation failed: ${err.message}`);
      // Fallback: basic markdown-to-html
      const fallbackHtml = markdownToBasicHtml(markdown);
      writeFileSync(htmlPath, fallbackHtml);
      console.log(`  🌐 HTML:     ${htmlPath} (fallback converter)`);
    }
  } else {
    console.log('  ⚠️  x-article-publisher not found, using basic converter');
    const fallbackHtml = markdownToBasicHtml(markdown);
    writeFileSync(htmlPath, fallbackHtml);
    console.log(`  🌐 HTML:     ${htmlPath}`);
  }
}

// ── Generate Banner ────────────────────────────────────────
if (!htmlOnly) {
  const bannerRawPath = join(outputDir, 'banner-raw.png');
  const bannerPath = join(outputDir, 'banner.png');

  const prompt = bannerPrompt ||
    `Dark minimal abstract composition, interconnected geometric shapes and subtle data streams, cinematic lighting, no text, black background, subtle teal and amber particle trails`;

  console.log('');
  console.log('  🎨 Generating banner...');

  const genScript = resolve(process.env.HOME, 'clawd/scripts/generate-image.sh');

  if (existsSync(genScript)) {
    try {
      const genOutput = execSync(
        `bash "${genScript}" "${prompt.replace(/"/g, '\\"')}" "${bannerRawPath}"`,
        { encoding: 'utf-8', timeout: 60000 }
      );
      console.log(`     Raw: ${bannerRawPath}`);

      // Crop to 5:2 ratio
      execSync(
        `ffmpeg -i "${bannerRawPath}" -vf "crop=in_w:in_w*2/5,scale=${BANNER_WIDTH}:${BANNER_HEIGHT}" -update 1 -y "${bannerPath}"`,
        { stdio: 'pipe', timeout: 30000 }
      );
      console.log(`     5:2: ${bannerPath}`);

      // Text overlay (if requested and not disabled)
      if (!noOverlay && (bannerOverlay || title)) {
        const overlayText = bannerOverlay || title;
        const overlaySubtitle = bannerSubtitle || subtitle || '';
        const overlayPath = join(outputDir, 'banner-overlay.html');
        const finalBannerPath = join(outputDir, 'banner.png');

        const overlayHtml = generateOverlayHtml(
          bannerPath,
          overlayText,
          overlaySubtitle
        );
        writeFileSync(overlayPath, overlayHtml);

        try {
          execSync(
            `npx playwright screenshot --viewport-size "${BANNER_WIDTH},${BANNER_HEIGHT}" "${overlayPath}" "${finalBannerPath}"`,
            { stdio: 'pipe', timeout: 30000 }
          );
          console.log(`     Overlay: ${finalBannerPath}`);
        } catch (overlayErr) {
          console.log(`     ⚠️ Overlay failed, using plain banner`);
        }
      }
    } catch (err) {
      console.error(`  ❌ Banner generation failed: ${err.message}`);
    }
  } else {
    console.error(`  ⚠️  generate-image.sh not found at ${genScript}`);
  }
}

// ── Write manifest ─────────────────────────────────────────
const manifest = {
  title,
  subtitle,
  wordCount,
  sectionCount: sections.length,
  codeBlockCount: codeBlocks.length,
  sections: sections.map(s => s.replace(/^##\s+/, '')),
  issues,
  warnings,
  generatedAt: new Date().toISOString(),
  files: {
    markdown: join(outputDir, 'article.md'),
    html: join(outputDir, 'article.html'),
    banner: join(outputDir, 'banner.png'),
  },
};
const manifestPath = join(outputDir, 'manifest.json');
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
console.log(`  📋 Manifest: ${manifestPath}`);

// ── Telegram delivery instructions ─────────────────────────
if (telegramMode) {
  console.log('');
  console.log('  ╔═══════════════════════════════════════╗');
  console.log('  ║  Telegram Delivery                     ║');
  console.log('  ╚═══════════════════════════════════════╝');
  console.log('');
  console.log('  Send via OpenClaw message tool:');
  console.log('');
  console.log('  1. Article text:');
  console.log(`     message(action=send, channel=telegram, target=2104116566,`);
  console.log(`       message=<contents of ${join(outputDir, 'article.md')}>)`);
  console.log('');
  console.log('  2. Banner image:');
  console.log(`     message(action=send, channel=telegram, target=2104116566,`);
  console.log(`       filePath=${join(outputDir, 'banner.png')},`);
  console.log(`       caption="X Article ready. Banner attached (5:2).")`);
}

console.log('');
console.log('  ✅ Pipeline complete');

// ── Helpers ────────────────────────────────────────────────

function markdownToBasicHtml(md) {
  // Strip the H1 title (goes in X Articles title field, not body)
  let html = md.replace(/^#\s+.+\n+(?:>\s*.+\n+)?/, '');

  // Code blocks
  html = html.replace(/```(\w+)?\n([\s\S]*?)```/g, (_, lang, code) => {
    return `<pre><code>${escapeHtml(code.trim())}</code></pre>`;
  });

  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  // H2
  html = html.replace(/^##\s+(.+)$/gm, '<h2>$1</h2>');

  // H3
  html = html.replace(/^###\s+(.+)$/gm, '<h3>$1</h3>');

  // Bold
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

  // Italic
  html = html.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>');

  // Links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

  // Blockquotes
  html = html.replace(/^>\s+(.+)$/gm, '<blockquote>$1</blockquote>');

  // Unordered lists
  html = html.replace(/^[-*]\s+(.+)$/gm, '<li>$1</li>');
  html = html.replace(/(<li>[\s\S]*?<\/li>)/g, '<ul>$1</ul>');
  // Clean up nested ul tags
  html = html.replace(/<\/ul>\s*<ul>/g, '');

  // Paragraphs (lines that aren't already tagged)
  html = html
    .split('\n\n')
    .map(block => {
      block = block.trim();
      if (!block) return '';
      if (block.startsWith('<')) return block;
      return `<p>${block.replace(/\n/g, '<br>')}</p>`;
    })
    .join('\n');

  return html;
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function generateOverlayHtml(bgImagePath, titleText, subtitleText) {
  const absPath = resolve(bgImagePath);
  return `<!DOCTYPE html>
<html>
<head>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&family=JetBrains+Mono:wght@400;500&display=swap');

  * { margin: 0; padding: 0; box-sizing: border-box; }

  body {
    width: ${BANNER_WIDTH}px;
    height: ${BANNER_HEIGHT}px;
    overflow: hidden;
    font-family: 'Inter', sans-serif;
  }

  .banner {
    width: ${BANNER_WIDTH}px;
    height: ${BANNER_HEIGHT}px;
    background: url('file://${absPath}') center/cover no-repeat;
    position: relative;
    display: flex;
    align-items: center;
  }

  .overlay {
    position: absolute;
    inset: 0;
    background: linear-gradient(
      to right,
      rgba(10, 10, 10, 0.92) 0%,
      rgba(10, 10, 10, 0.75) 50%,
      rgba(10, 10, 10, 0.3) 100%
    );
  }

  .content {
    position: relative;
    z-index: 1;
    padding: 60px 80px;
    max-width: 700px;
  }

  h1 {
    font-size: 36px;
    font-weight: 700;
    color: #f5f5f5;
    line-height: 1.2;
    letter-spacing: -0.5px;
    margin-bottom: 12px;
  }

  .subtitle {
    font-size: 16px;
    font-weight: 400;
    color: #888;
    font-family: 'JetBrains Mono', monospace;
    letter-spacing: 0.5px;
  }

  .accent {
    position: absolute;
    bottom: 40px;
    left: 80px;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .accent-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #4ecdc4;
  }

  .accent-text {
    font-size: 11px;
    font-family: 'JetBrains Mono', monospace;
    color: #555;
    letter-spacing: 2px;
    text-transform: uppercase;
  }
</style>
</head>
<body>
  <div class="banner">
    <div class="overlay"></div>
    <div class="content">
      <h1>${escapeHtmlAttr(titleText)}</h1>
      ${subtitleText ? `<p class="subtitle">${escapeHtmlAttr(subtitleText)}</p>` : ''}
    </div>
    <div class="accent">
      <div class="accent-dot"></div>
      <span class="accent-text">Axiom</span>
    </div>
  </div>
</body>
</html>`;
}

function escapeHtmlAttr(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
