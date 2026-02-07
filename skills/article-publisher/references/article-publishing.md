# Article Publishing Reference

## Overview

Publish markdown articles to X (Twitter) Articles editor via browser automation.
The key innovation is **sequential step-by-step publishing** — no backtracking.

## Why Sequential Steps (The Hard-Won Lesson)

### The old approach (broken — don't use):

1. Convert entire markdown to HTML
2. Replace code blocks with placeholders (`🔷CODE1🔷`, `🔷CODE2🔷`, etc.)
3. Paste all HTML body at once
4. Go back and find each placeholder
5. Delete placeholder, insert code block via Insert menu

**What went wrong:**
- Placeholders would end up in wrong positions after paste
- Finding and clicking placeholders required fragile text search
- Deleting placeholder text and repositioning cursor was unreliable
- Code blocks inserted at wrong locations required delete-and-reinsert
- **Hours of debugging** per article. Unacceptable.

### The new approach (what this skill uses):

1. Pre-process markdown into a linear sequence of steps
2. Walk through each step in order — paste HTML or insert code block
3. Each step appends at the current cursor position
4. **No backtracking. No placeholder replacement. No repositioning.**

```json
[
  {"type": "paste_html", "html": "<p>Intro text...</p><h2>Section</h2><p>More...</p>"},
  {"type": "code_block", "lang": "bash", "code": "echo hello"},
  {"type": "paste_html", "html": "<p>After code text...</p>"},
  {"type": "code_block", "lang": "javascript", "code": "const x = 1;"},
  {"type": "paste_html", "html": "<p>Conclusion...</p>"}
]
```

## Technical Details

### HTML Paste (ClipboardEvent)

System clipboard via Meta+V **does not work** through Chrome relay CDP.
Must use synthetic ClipboardEvent with DataTransfer:

```javascript
const dt = new DataTransfer();
dt.setData('text/html', htmlContent);
const el = document.querySelector('[contenteditable="true"][data-testid]')
  || document.querySelector('[contenteditable="true"]');
el.focus();

// Move cursor to end of content
const range = document.createRange();
range.selectNodeContents(el);
range.collapse(false);  // collapse to end
const sel = window.getSelection();
sel.removeAllRanges();
sel.addRange(range);

el.dispatchEvent(new ClipboardEvent('paste', {
  clipboardData: dt,
  bubbles: true,
  cancelable: true
}));
```

**CRITICAL:** Paste ALL text of each segment in ONE shot. If you split a segment
into multiple paste operations, H2 headers merge into the preceding paragraph
block. This is a known quirk of the X Articles editor.

### Code Block Insertion

The X Articles editor has a specific flow for code blocks:

1. **Press Enter** — ensure new line at cursor position
2. **Click "Insert"** — toolbar menu button
3. **Click "Code"** — dropdown option
4. **Search for language** — type language name in search field
5. **Click language** — select from filtered results
6. **Insert code** — `document.execCommand('insertText', false, codeContent)`
7. **Click "Insert"** — confirm button in dialog

**Why `document.execCommand`?** The code textarea is React-controlled. Setting `.value` directly doesn't trigger React's state. Clipboard paste doesn't work. Only `execCommand('insertText', ...)` properly updates both the DOM and React's internal state.

### Language Name Mapping

The code dialog searches by full language name. Common mappings:

| Markdown fence | X Articles search term |
|----------------|----------------------|
| `bash`, `sh` | bash |
| `javascript`, `js` | javascript |
| `typescript`, `ts` | typescript |
| `python`, `py` | python |
| `json` | json |
| `yaml`, `yml` | yaml |
| `html` | html |
| `css` | css |
| `sql` | sql |
| `rust` | rust |
| `go` | go |
| `ruby`, `rb` | ruby |

### Cover Image Upload

```
browser upload selector="input[type='file'][accept*='image']" paths=["/path/to/banner.png"]
```

Then click "Apply" in the Edit media dialog.

## Full Publishing Flow

1. **Parse article:** `python3 parse-article.py article.md -o steps.json`
2. **Generate banner:** `./generate-banner.sh --title "..." --output banner.png`
3. **Navigate:** `browser navigate url="https://x.com/compose/articles"`
4. **Create new article:** Click "Create" button
5. **Upload cover:** Upload banner.png via file input
6. **Set title:** Click title area, type title from steps.json
7. **Walk through steps:** For each step in order:
   - `paste_html` → synthetic ClipboardEvent with the HTML
   - `code_block` → Insert menu → Code → language → execCommand → Insert
8. **Save draft:** Auto-saves, verify in preview
9. **Report:** "Draft saved — review and publish manually"

## Rules

- **NEVER auto-publish** — always save as draft
- **ONE paste per segment** — never split HTML content
- **Linear only** — never go back to fix positioning
- **Use Chrome relay** — `profile="chrome"` for X Articles (needs cookies)
