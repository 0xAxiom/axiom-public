# Article Pipeline

End-to-end article delivery: markdown draft to X Articles-ready package.

**Trigger:** When you've written an article and need to prepare it for X Articles publishing.

## What It Does

Takes a markdown article and produces:
1. Validated, formatted markdown (word count, structure check)
2. Rich HTML for X Articles clipboard paste
3. 5:2 banner image (fal.ai abstract + text overlay via Playwright)
4. Telegram delivery of both article + banner

## Prerequisites

- `FAL_API_KEY` in `~/.axiom/wallet.env`
- `ffmpeg` installed
- Python 3.9+ with `Pillow`, `pyobjc-framework-Cocoa` (for clipboard)
- `npx playwright` (for banner text overlay)
- x-article-publisher scripts at `~/.clawdbot/skills/x-article-publisher/scripts/`

## Usage

### Full Pipeline (One Command)

```bash
# Deliver article + banner to Telegram
node ~/Github/axiom-public/agent-tools/skills/article-pipeline/scripts/pipeline.mjs \
  /tmp/article-draft.md \
  --banner-prompt "Dark abstract composition, neural network topology, black background" \
  --telegram  # outputs instructions for message tool delivery
```

### Individual Steps

```bash
# 1. Validate article structure
node scripts/pipeline.mjs /tmp/article-draft.md --validate-only

# 2. Generate banner only
node scripts/pipeline.mjs /tmp/article-draft.md --banner-only \
  --banner-prompt "Dark abstract, geometric data flows"

# 3. Generate HTML for clipboard only
node scripts/pipeline.mjs /tmp/article-draft.md --html-only
```

### Banner with Text Overlay

```bash
# Generate banner with custom overlay text
node scripts/pipeline.mjs /tmp/article-draft.md \
  --banner-prompt "Dark abstract, teal particles" \
  --banner-overlay "How I Built a Cron Fleet Manager" \
  --banner-subtitle "30 jobs. Zero manual intervention."
```

## Output

The pipeline produces files in `/tmp/article-pipeline/`:

```
/tmp/article-pipeline/
├── article.md          # Validated markdown (em dashes stripped)
├── article.html        # Rich HTML for X Articles paste
├── banner-raw.png      # Raw fal.ai generation
├── banner.png          # Final 5:2 (1250x500) banner
└── manifest.json       # Metadata (word count, title, sections)
```

## Article Rules (Enforced)

The validator checks:
- No em dashes (replaced with commas automatically)
- Under 1500 words
- Has H1 title
- Has at least 3 sections (H2 headers)
- Code blocks use real fenced syntax
- No AI slop phrases ("dive in", "landscape", "let's explore")

## Integration with Build Crons

After shipping code, the build cron should:
1. Write article to `/tmp/article-draft.md`
2. Run pipeline: `node pipeline.mjs /tmp/article-draft.md --banner-prompt "..." --telegram`
3. Use OpenClaw `message` tool to send article text + banner to Telegram

## Banner Design System

Banners follow Axiom's design aesthetic:
- **Base:** fal.ai abstract visual (cinematic, dark, no text)
- **Overlay:** HTML/CSS text via Playwright screenshot (optional)
- **Fonts:** Inter + JetBrains Mono (Google Fonts)
- **Colors:** #0a0a0a background, muted teal/amber accents
- **Ratio:** 5:2 (1250x500px) for X Articles
