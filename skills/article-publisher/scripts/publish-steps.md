# Publishing Steps — Browser Automation Reference

Step-by-step browser automation for publishing to X Articles editor.
Use with OpenClaw `browser` tool (Chrome relay profile).

## Prerequisites

- Logged into X with Premium subscription (Articles feature)
- Chrome relay attached to a tab
- `article-steps.json` ready (from `parse-article.py`)
- Banner image ready (from `generate-banner.sh`)

---

## Phase 1: Navigate & Create

```
browser navigate url="https://x.com/compose/articles" profile="chrome"
```

Wait for the page to load, then find and click **"Create"** button to open a new article editor.

```
browser snapshot profile="chrome"
# Find the "Create" or equivalent button
browser act request={"kind":"click","ref":"<create_button_ref>"} profile="chrome"
```

---

## Phase 2: Upload Cover Image

Upload the banner PNG:

```
browser upload selector="input[type='file'][accept*='image']" paths=["/path/to/banner.png"] profile="chrome"
```

Then click **"Apply"** in the Edit media dialog:

```
browser snapshot profile="chrome"
# Find "Apply" button
browser act request={"kind":"click","ref":"<apply_button_ref>"} profile="chrome"
```

---

## Phase 3: Set Title

Click the title area and type/paste the title:

```
browser snapshot profile="chrome"
# Click title area (usually has "Add a title" or similar placeholder)
browser act request={"kind":"click","ref":"<title_ref>"} profile="chrome"
browser act request={"kind":"type","ref":"<title_ref>","text":"Article Title Here"} profile="chrome"
```

---

## Phase 4: Walk Through Steps Sequentially

Load the steps JSON and process each step in order:

### For `paste_html` steps:

**CRITICAL: Paste ALL text of the segment in ONE ClipboardEvent. Splitting causes H2 headers to merge into preceding blocks.**

```
browser act request={"kind":"evaluate","fn":"(htmlContent) => { const dt = new DataTransfer(); dt.setData('text/html', htmlContent); const el = document.querySelector('[contenteditable=\"true\"][data-testid]') || document.querySelector('[contenteditable=\"true\"]'); el.focus(); const range = document.createRange(); range.selectNodeContents(el); range.collapse(false); const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range); el.dispatchEvent(new ClipboardEvent('paste', {clipboardData: dt, bubbles: true, cancelable: true})); return 'pasted'; }","text":"<THE_HTML_CONTENT>"} profile="chrome"
```

Simplified version using browser evaluate:

```javascript
// JavaScript to execute in the browser
const htmlContent = `<p>Your HTML here...</p>`;
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

// Dispatch paste event
el.dispatchEvent(new ClipboardEvent('paste', {
  clipboardData: dt,
  bubbles: true,
  cancelable: true
}));
```

### For `code_block` steps:

1. **Press Enter** (ensure new line after previous content):
```
browser act request={"kind":"press","key":"Enter"} profile="chrome"
```

2. **Click "Insert" menu** in toolbar:
```
browser snapshot profile="chrome"
# Find the "Insert" button in the toolbar
browser act request={"kind":"click","ref":"<insert_menu_ref>"} profile="chrome"
```

3. **Click "Code"** in the dropdown:
```
browser snapshot profile="chrome"
browser act request={"kind":"click","ref":"<code_option_ref>"} profile="chrome"
```

4. **Select language** in the code dialog:
```
browser snapshot profile="chrome"
# Type the language name in the search field
browser act request={"kind":"type","ref":"<search_field_ref>","text":"bash"} profile="chrome"
# Click the matching language option
browser snapshot profile="chrome"
browser act request={"kind":"click","ref":"<language_option_ref>"} profile="chrome"
```

5. **Insert code content** — MUST use `document.execCommand`:
```
browser act request={"kind":"evaluate","fn":"(code) => { const ta = document.querySelectorAll('textarea')[0]; ta.focus(); document.execCommand('insertText', false, code); return 'inserted'; }","text":"<CODE_CONTENT>"} profile="chrome"
```

**⚠️ ONLY `document.execCommand('insertText', ...)` works on the React-controlled textarea. Direct value setting or clipboard paste will NOT trigger React's state update.**

6. **Click "Insert" button** to confirm:
```
browser snapshot profile="chrome"
browser act request={"kind":"click","ref":"<insert_button_ref>"} profile="chrome"
```

---

## Phase 5: Save Draft

The editor auto-saves. Optionally click save explicitly.

**NEVER auto-publish.** Always save as draft and report to the user for manual review.

---

## Common Issues & Solutions

### Problem: H2 headers merge into preceding blocks
**Cause:** Pasting HTML in multiple chunks
**Fix:** Always paste each segment's full HTML in a single ClipboardEvent

### Problem: Code block appears in wrong position
**Cause:** Cursor wasn't at end of content before inserting
**Fix:** Move cursor to end before each insert step (collapse range to end)

### Problem: execCommand doesn't insert text
**Cause:** textarea not focused, or using wrong method
**Fix:** Explicitly `.focus()` the textarea, use `insertText` command

### Problem: System clipboard paste (Meta+V) doesn't work
**Cause:** Chrome relay CDP doesn't have direct clipboard access
**Fix:** Use synthetic ClipboardEvent with DataTransfer (the approach above)

### Problem: Language search returns no results
**Cause:** Language name mismatch (e.g., "js" vs "javascript")
**Fix:** Use the full language name. Common mappings:
  - js → javascript
  - ts → typescript
  - sh → bash
  - py → python
  - rb → ruby
  - yml → yaml
