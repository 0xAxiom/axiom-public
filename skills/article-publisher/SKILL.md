---
name: article-publisher
description: |
  Generate branded banners and publish Markdown articles to X (Twitter) Articles editor.
  Use when user wants to publish an article to X, generate a banner image, or convert
  markdown for publishing. Handles: banner generation (fal.ai + HTML/Playwright),
  markdown parsing into sequential steps, and step-by-step browser automation.
---

# Article Publisher Skill

Publish Markdown articles to X Articles with branded banners. Two main capabilities:

1. **Banner Generation** — fal.ai visual base + HTML/CSS text overlay via Playwright
2. **Article Publishing** — Sequential step-by-step publishing to X Articles editor

## Quick Start

### Generate a banner:
```bash
/Users/melted/clawd/skills/article-publisher/scripts/generate-banner.sh \
  --title "My Article Title" \
  --subtitle "A deep dive into the topic" \
  --tag "ENGINEERING" \
  --prompt "abstract dark neural network topology, cinematic, moody" \
  --output /tmp/banner.png
```

### Parse an article for publishing:
```bash
python3 /Users/melted/clawd/skills/article-publisher/scripts/parse-article.py \
  article.md --output /tmp/article-steps.json
```

### Full publish flow:
1. Generate banner → `banner.png`
2. Parse article → `article-steps.json`  
3. Open X Articles editor in browser
4. Upload cover, set title, walk through steps sequentially

---

## Banner Generation

### Usage
```bash
generate-banner.sh [options] --output /path/to/banner.png
```

### Options
| Flag | Required | Description |
|------|----------|-------------|
| `--title` | ✅ | Main title text |
| `--output` | ✅ | Output PNG path |
| `--subtitle` | | Secondary text |
| `--tag` | | Top label (auto-uppercased in template) |
| `--prompt` | | fal.ai prompt for AI background (mutually exclusive with --bg-image) |
| `--bg-image` | | Path to existing background image |
| `--stats` | | Comma-separated `Label:Value` pairs |
| `--pipeline` | | Comma-separated pipeline step names |
| `--brand` | | Bottom-right brand text (default: "Axiom 🔬") |
| `--size` | | `WxH` dimensions (default: `1250x500`) |
| `--template` | | Custom HTML template path |

### Examples
```bash
# Full featured banner
generate-banner.sh \
  --output banner.png \
  --title "Ship Log: Week 3" \
  --subtitle "14 days of autonomous operations" \
  --tag "AUTONOMOUS INFRASTRUCTURE" \
  --prompt "abstract dark data center, fiber optic lights, cinematic" \
  --stats "Transactions:1,057,Uptime:14 days,Bugs Lost:\$0" \
  --pipeline "REBALANCE,COMPOUND,HARVEST,BURN" \
  --brand "Axiom 🔬"

# Simple banner with existing background
generate-banner.sh \
  --output banner.png \
  --title "How I Built This" \
  --subtitle "From zero to production" \
  --bg-image ~/images/abstract-bg.png

# Minimal banner (dark solid background)
generate-banner.sh \
  --output banner.png \
  --title "Thoughts on Agent Infrastructure"
```

### Dependencies
- Node.js + `npx playwright` (install chromium: `npx playwright install chromium`)
- ffmpeg (`brew install ffmpeg`) — only needed with `--prompt`
- curl — only needed with `--prompt`
- `FAL_API_KEY` in `~/.axiom/wallet.env` — only needed with `--prompt`

### Design
- Dark theme: #0a0a0a background, #4ade80 muted green accents
- Bloomberg × Apple aesthetic — no neon, no glow
- Fonts: Inter (titles), JetBrains Mono (stats, tags) via Google Fonts
- Left-to-right gradient overlay ensures text readability over any background

---

## Article Parsing

### Usage
```bash
python3 parse-article.py input.md [--output steps.json] [--html-only]
```

### Output Format
```json
{
  "title": "Article Title (from first H1)",
  "steps": [
    {"type": "paste_html", "html": "<p>Intro text...</p><h2>Section</h2><p>More text...</p>"},
    {"type": "code_block", "lang": "bash", "code": "#!/bin/bash\necho hello"},
    {"type": "paste_html", "html": "<p>Next section...</p>"},
    {"type": "code_block", "lang": "javascript", "code": "const x = 1;"},
    {"type": "paste_html", "html": "<p>Conclusion...</p>"}
  ]
}
```

### What It Handles
| Markdown | HTML Output |
|----------|-------------|
| `# Title` | Extracted as `title` field (not in steps) |
| `## Heading` | `<h2>Heading</h2>` |
| `**bold**` | `<strong>bold</strong>` |
| `*italic*` | `<em>italic</em>` |
| `[link](url)` | `<a href="url">link</a>` |
| `> quote` | `<blockquote><p>quote</p></blockquote>` |
| `- item` | `<ul><li>item</li></ul>` |
| `1. item` | `<ol><li>item</li></ol>` |
| `` `code` `` | `<code>code</code>` |
| `---` | `<hr>` |
| ` ```lang ` | `code_block` step |
| `![img]()` | Skipped (X Articles limitation) |

### Flags
- `--output FILE` — Write JSON to file (otherwise prints to stdout)
- `--html-only` — Output single HTML string (code blocks become comments); useful for debugging

### Dependencies
- Python 3 (standard library works; `pip install markdown` optional for better output)

---

## Publishing to X Articles

### The Sequential Approach (Why It Matters)

**Previous approach (broken):** Paste everything at once with code block placeholders, then backtrack to replace each one. This causes misplaced code blocks, cursor failures, and hours of debugging.

**This approach (proven):** Walk through steps linearly. Each step appends at the cursor position. No backtracking.

### Step-by-Step Browser Automation

Use OpenClaw `browser` tool with `profile="chrome"`.

#### 1. Navigate & Create
```
browser navigate url="https://x.com/compose/articles" profile="chrome"
browser snapshot profile="chrome"
# Click "Create" button
```

#### 2. Upload Cover Image
```
browser upload selector="input[type='file'][accept*='image']" paths=["/path/to/banner.png"] profile="chrome"
# Click "Apply" in Edit media dialog
```

#### 3. Set Title
```
# Click title area, type the title
```

#### 4. Paste HTML Segments

For each `paste_html` step, execute this JavaScript in the browser:

```javascript
const dt = new DataTransfer();
dt.setData('text/html', htmlContent);
const el = document.querySelector('[contenteditable="true"][data-testid]')
  || document.querySelector('[contenteditable="true"]');
el.focus();
// Move cursor to end
const range = document.createRange();
range.selectNodeContents(el);
range.collapse(false);
const sel = window.getSelection();
sel.removeAllRanges();
sel.addRange(range);
// Paste
el.dispatchEvent(new ClipboardEvent('paste', {
  clipboardData: dt, bubbles: true, cancelable: true
}));
```

**⚠️ CRITICAL:** Paste ALL HTML of each segment in ONE ClipboardEvent. Splitting causes H2 headers to merge into preceding blocks.

**⚠️ WHY ClipboardEvent:** System clipboard (Meta+V) does NOT work through Chrome relay CDP. Must use synthetic ClipboardEvent with DataTransfer.

#### 5. Insert Code Blocks

For each `code_block` step:

1. Press Enter (new line)
2. Click **Insert** menu in toolbar
3. Click **Code** option
4. Type language name in search field (use full name: "javascript" not "js")
5. Click matching language option
6. Focus textarea and insert code:
   ```javascript
   const ta = document.querySelectorAll('textarea')[0];
   ta.focus();
   document.execCommand('insertText', false, codeContent);
   ```
7. Click **Insert** button

**⚠️ WHY execCommand:** The textarea is React-controlled. Setting `.value` directly or pasting doesn't trigger React state updates. `execCommand('insertText')` is the ONLY method that works.

#### 6. Save & Report
- Draft auto-saves
- **NEVER auto-publish** — always save as draft
- Report: "Draft saved. Review and publish manually."

---

## File Structure

```
skills/article-publisher/
├── SKILL.md                      # This file
├── references/
│   ├── banner-pipeline.md        # Deep dive on banner generation
│   └── article-publishing.md     # Deep dive on sequential publishing
├── scripts/
│   ├── generate-banner.sh        # Banner generation script
│   ├── parse-article.py          # Markdown → steps JSON
│   └── publish-steps.md          # Browser automation reference
├── templates/
│   └── banner-default.html       # Parameterized HTML banner template
└── examples/
    └── sample-article.md         # Example article with code blocks
```

---

## Troubleshooting

### Banner: "Playwright not installed"
```bash
npx playwright install chromium
```

### Banner: Fonts not loading
The template uses Google Fonts via `@import`. Needs internet access. If offline, the template will fall back to system fonts.

### Parser: "No module named 'markdown'"
The parser works without the `markdown` library (has built-in converter), but for better output:
```bash
pip install markdown
```

### Publishing: Code block language not found
Use the full language name in your markdown fences:
- ✅ ` ```javascript ` not ` ```js `
- ✅ ` ```typescript ` not ` ```ts `
- ✅ ` ```python ` not ` ```py `
- ✅ ` ```bash ` (both `bash` and `sh` work)

### Publishing: Text formatting looks wrong
Make sure you're using `ClipboardEvent` paste, not `innerHTML` or `textContent`. Only the clipboard approach preserves rich text formatting in the X Articles editor.

### Publishing: "Browser not connected"
Ensure Chrome relay is attached. User must click the OpenClaw Browser Relay toolbar icon on the X tab.
