# Article Pipeline 📝

End-to-end article delivery for X Articles. Takes a markdown draft and produces a publish-ready package: validated markdown, rich HTML, and a 5:2 banner image.

## The Problem

Publishing an article to X involves 7+ manual steps: write markdown, convert to HTML, generate banner, crop to 5:2, send to clipboard, deliver to Telegram, wait for human to paste. Each step has its own tool and its own failure mode.

## What It Does

One command. Markdown in, publish-ready package out.

```
node pipeline.mjs article.md --banner-prompt "Dark abstract, data streams"
```

Produces:
```
/tmp/article-pipeline/
├── article.md          # Validated (em dashes stripped, slop flagged)
├── article.html        # Rich HTML for X Articles paste
├── banner-raw.png      # Raw fal.ai generation
├── banner.png          # Final 5:2 (1250x500) with text overlay
└── manifest.json       # Metadata (title, word count, sections)
```

## Features

**Validation**
- Em dash detection and auto-replacement
- Word count enforcement (1500 max)
- Section count check (3+ H2 headers required)
- AI slop phrase detection ("dive in", "game-changer", etc.)

**HTML Generation**
- Uses x-article-publisher's `parse_markdown.py` for rich HTML
- Fallback built-in converter if dependency missing
- Preserves: H2, bold, italic, links, lists, blockquotes, code blocks

**Banner Generation**
- fal.ai Flux for abstract base image
- ffmpeg crop to 5:2 ratio (1250x500)
- Optional text overlay via Playwright (Inter + JetBrains Mono)
- Gradient mask: dark left (text) to transparent right (art shows through)

## Quick Start

```bash
# Validate an article
node pipeline.mjs article.md --validate-only

# Full pipeline
node pipeline.mjs article.md \
  --banner-prompt "Dark abstract, neural topology, black background" \
  --telegram

# Custom overlay text
node pipeline.mjs article.md \
  --banner-overlay "Stop Your Crons From Dying" \
  --banner-subtitle "30 jobs. Zero manual checks."

# Banner only (skip HTML)
node pipeline.mjs article.md --banner-only

# HTML only (skip banner)
node pipeline.mjs article.md --html-only

# No text overlay on banner
node pipeline.mjs article.md --no-overlay
```

## Dependencies

- Node.js 18+
- `ffmpeg` (banner cropping)
- `FAL_API_KEY` in `~/.axiom/wallet.env` (banner generation)
- Python 3.9+ with `Pillow`, `pyobjc-framework-Cocoa` (HTML clipboard, optional)
- `npx playwright` (text overlay, optional)

## How It Works

```
article.md
    │
    ├──► Validator ──► em dashes, slop, word count, structure
    │
    ├──► parse_markdown.py ──► article.html (rich text for clipboard)
    │
    ├──► fal.ai Flux ──► banner-raw.png
    │       │
    │       └──► ffmpeg crop 5:2 ──► banner.png
    │               │
    │               └──► Playwright overlay ──► banner.png (with title text)
    │
    └──► manifest.json (metadata)
```

## Integration

Used by Axiom's build crons. After shipping code, the cron writes an article draft, runs the pipeline, and delivers the package to Telegram. Human reviews and publishes.

## Article Style Rules

Enforced by the validator:

- No em dashes (auto-replaced with commas)
- No AI slop phrases
- Under 1500 words
- Real code blocks from actual projects
- H1 title required
- 3+ sections (H2 headers)

## License

MIT
