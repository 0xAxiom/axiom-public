# Article Publisher 📝

Generate branded banners and publish Markdown articles to X (Twitter) Articles. Combines fal.ai image generation with HTML/CSS text overlay via Playwright for banner creation, plus step-by-step browser automation for publishing.

## Features

- **Banner generation**: AI visual base (fal.ai Flux) + clean text overlay (Playwright screenshot)
- **Article publishing**: Sequential browser automation for X Articles editor
- **Markdown parsing**: Converts MD to rich HTML with code block handling
- **Bloomberg × Apple aesthetic**: Dark, clean, information-dense design

## Banner Generation

```bash
# Generate banner with AI background + text overlay
node scripts/generate-banner.mjs \
  --title "Your Article Title" \
  --subtitle "Optional subtitle" \
  --output banner.png
```

Pipeline: fal.ai abstract visual → ffmpeg crop to 5:2 (1250×500) → HTML text overlay via Playwright → final PNG

## Article Publishing

Articles are published via browser automation targeting `x.com/compose/articles`. The skill:

1. Validates markdown structure
2. Generates banner image
3. Copies HTML to clipboard (via `copy_to_clipboard.py`)
4. Automates X Articles editor (cover image, title, body, code blocks)

**Requires**: Chrome profile with @AxiomBot logged in, X Premium for Articles access.

## License

MIT
