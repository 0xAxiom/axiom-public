#!/usr/bin/env python3
"""
parse-article.py — Convert Markdown article to sequential publishing steps.

Usage:
    parse-article.py input.md --output article-steps.json
    parse-article.py input.md --output article-steps.json --html-only
    parse-article.py input.md  (prints JSON to stdout)

Output JSON format:
{
    "title": "Article Title (from H1)",
    "steps": [
        {"type": "paste_html", "html": "<p>First paragraph...</p><h2>Section</h2>"},
        {"type": "code_block", "lang": "bash", "code": "echo hello"},
        {"type": "paste_html", "html": "<p>More text...</p>"},
        ...
    ]
}

The --html-only flag outputs a single HTML string of all non-code content
(code blocks replaced with placeholder comments), useful for debugging.

Why this approach:
    The X Articles editor cannot handle a single paste of HTML + code blocks.
    Pasting everything at once with placeholders then backtracking to replace
    them causes misplaced blocks and cursor failures. Instead, we walk through
    linearly — each step appends at the cursor position. No backtracking needed.
"""

import argparse
import json
import re
import sys
import textwrap

# Try to import markdown library; fall back to manual conversion
try:
    import markdown as md_lib
    HAS_MARKDOWN_LIB = True
except ImportError:
    HAS_MARKDOWN_LIB = False


def manual_md_to_html(text: str) -> str:
    """Convert markdown text to HTML without external libraries."""
    lines = text.split('\n')
    html_lines = []
    in_list = False
    in_ordered_list = False
    in_blockquote = False
    list_type = None  # 'ul' or 'ol'

    def inline(s):
        """Process inline markdown: bold, italic, code, links."""
        # Code spans first (so they don't get processed by bold/italic)
        s = re.sub(r'`([^`]+)`', r'<code>\1</code>', s)
        # Bold + italic
        s = re.sub(r'\*\*\*(.+?)\*\*\*', r'<strong><em>\1</em></strong>', s)
        # Bold
        s = re.sub(r'\*\*(.+?)\*\*', r'<strong>\1</strong>', s)
        s = re.sub(r'__(.+?)__', r'<strong>\1</strong>', s)
        # Italic
        s = re.sub(r'\*(.+?)\*', r'<em>\1</em>', s)
        s = re.sub(r'_(.+?)_', r'<em>\1</em>', s)
        # Links
        s = re.sub(r'\[([^\]]+)\]\(([^)]+)\)', r'<a href="\2">\1</a>', s)
        return s

    def close_list():
        nonlocal in_list, in_ordered_list, list_type
        if in_list:
            html_lines.append(f'</{list_type}>')
            in_list = False
            in_ordered_list = False
            list_type = None

    def close_blockquote():
        nonlocal in_blockquote
        if in_blockquote:
            html_lines.append('</blockquote>')
            in_blockquote = False

    i = 0
    while i < len(lines):
        line = lines[i]
        stripped = line.strip()

        # Empty line — close any open blocks
        if not stripped:
            close_list()
            close_blockquote()
            i += 1
            continue

        # Headings
        heading_match = re.match(r'^(#{2,6})\s+(.+)$', stripped)
        if heading_match:
            close_list()
            close_blockquote()
            level = len(heading_match.group(1))
            text = inline(heading_match.group(2).strip())
            html_lines.append(f'<h{level}>{text}</h{level}>')
            i += 1
            continue

        # Horizontal rule
        if re.match(r'^(-{3,}|\*{3,}|_{3,})$', stripped):
            close_list()
            close_blockquote()
            html_lines.append('<hr>')
            i += 1
            continue

        # Blockquote
        if stripped.startswith('>'):
            close_list()
            if not in_blockquote:
                html_lines.append('<blockquote>')
                in_blockquote = True
            quote_text = re.sub(r'^>\s?', '', stripped)
            if quote_text:
                html_lines.append(f'<p>{inline(quote_text)}</p>')
            i += 1
            continue

        # Unordered list
        ul_match = re.match(r'^[-*+]\s+(.+)$', stripped)
        if ul_match:
            close_blockquote()
            if not in_list or list_type != 'ul':
                close_list()
                html_lines.append('<ul>')
                in_list = True
                list_type = 'ul'
            html_lines.append(f'<li>{inline(ul_match.group(1))}</li>')
            i += 1
            continue

        # Ordered list
        ol_match = re.match(r'^\d+\.\s+(.+)$', stripped)
        if ol_match:
            close_blockquote()
            if not in_list or list_type != 'ol':
                close_list()
                html_lines.append('<ol>')
                in_list = True
                list_type = 'ol'
            html_lines.append(f'<li>{inline(ol_match.group(1))}</li>')
            i += 1
            continue

        # Image — skip (X Articles doesn't support inline images well)
        if re.match(r'^!\[.*?\]\(.*?\)$', stripped):
            i += 1
            continue

        # Regular paragraph
        close_list()
        close_blockquote()
        # Collect consecutive non-special lines into one paragraph
        para_lines = [inline(stripped)]
        i += 1
        while i < len(lines):
            next_stripped = lines[i].strip()
            if not next_stripped:
                break
            # Check if next line is a special element
            if (re.match(r'^#{2,6}\s', next_stripped) or
                re.match(r'^(-{3,}|\*{3,}|_{3,})$', next_stripped) or
                re.match(r'^[-*+]\s', next_stripped) or
                re.match(r'^\d+\.\s', next_stripped) or
                next_stripped.startswith('>') or
                re.match(r'^!\[.*?\]\(.*?\)$', next_stripped)):
                break
            para_lines.append(inline(next_stripped))
            i += 1
        html_lines.append(f'<p>{" ".join(para_lines)}</p>')

    close_list()
    close_blockquote()

    return '\n'.join(html_lines)


def md_to_html(text: str) -> str:
    """Convert markdown text segment to HTML."""
    if not text.strip():
        return ''

    if HAS_MARKDOWN_LIB:
        # Use markdown library with common extensions
        html = md_lib.markdown(
            text,
            extensions=['extra', 'sane_lists'],
            output_format='html5'
        )
        # Strip images (X Articles doesn't handle inline images well)
        html = re.sub(r'<img[^>]*/?>', '', html)
        return html.strip()
    else:
        return manual_md_to_html(text)


def parse_article(markdown_text: str) -> dict:
    """
    Parse a markdown article into sequential publishing steps.

    Returns:
        {
            "title": "Article Title",
            "steps": [
                {"type": "paste_html", "html": "..."},
                {"type": "code_block", "lang": "bash", "code": "..."},
                ...
            ]
        }
    """
    lines = markdown_text.split('\n')
    title = ''
    segments = []  # List of (type, content) tuples

    # ── Extract title (first H1) and split at code fences ─────────────────────
    current_text = []
    i = 0

    while i < len(lines):
        line = lines[i]

        # Extract H1 as title (only the first one)
        if not title and re.match(r'^#\s+(.+)$', line.strip()):
            # Flush any text before the H1
            if current_text:
                text = '\n'.join(current_text).strip()
                if text:
                    segments.append(('text', text))
                current_text = []
            title = re.match(r'^#\s+(.+)$', line.strip()).group(1).strip()
            i += 1
            continue

        # Code fence start
        fence_match = re.match(r'^```(\w*)(.*)$', line)
        if fence_match:
            # Flush accumulated text
            if current_text:
                text = '\n'.join(current_text).strip()
                if text:
                    segments.append(('text', text))
                current_text = []

            lang = fence_match.group(1) or 'text'
            code_lines = []
            i += 1

            # Collect until closing fence
            while i < len(lines):
                if lines[i].strip() == '```':
                    break
                code_lines.append(lines[i])
                i += 1
            i += 1  # Skip closing fence

            code = '\n'.join(code_lines)
            # Remove trailing whitespace but keep internal structure
            code = code.rstrip()

            if code:  # Only add non-empty code blocks
                segments.append(('code', lang, code))
            continue

        # Regular line
        current_text.append(line)
        i += 1

    # Flush remaining text
    if current_text:
        text = '\n'.join(current_text).strip()
        if text:
            segments.append(('text', text))

    # ── Convert segments to steps ─────────────────────────────────────────────
    steps = []

    for seg in segments:
        if seg[0] == 'text':
            html = md_to_html(seg[1])
            if html:
                steps.append({
                    'type': 'paste_html',
                    'html': html
                })
        elif seg[0] == 'code':
            steps.append({
                'type': 'code_block',
                'lang': seg[1],
                'code': seg[2]
            })

    # ── Merge adjacent paste_html steps (if no code between them) ─────────────
    # Actually, we keep them separate — each paste is one ClipboardEvent.
    # But we CAN merge consecutive text segments since there's no code between them.
    merged_steps = []
    for step in steps:
        if (step['type'] == 'paste_html' and
            merged_steps and
            merged_steps[-1]['type'] == 'paste_html'):
            merged_steps[-1]['html'] += '\n' + step['html']
        else:
            merged_steps.append(step)

    return {
        'title': title,
        'steps': merged_steps
    }


def generate_html_only(result: dict) -> str:
    """Generate a single HTML string for debugging/preview."""
    parts = []
    code_idx = 0
    for step in result['steps']:
        if step['type'] == 'paste_html':
            parts.append(step['html'])
        elif step['type'] == 'code_block':
            code_idx += 1
            parts.append(f'<!-- CODE_BLOCK_{code_idx}: {step["lang"]} -->')
    return '\n'.join(parts)


def main():
    parser = argparse.ArgumentParser(
        description='Convert Markdown article to sequential publishing steps.'
    )
    parser.add_argument('input', help='Input Markdown file path')
    parser.add_argument('--output', '-o', help='Output JSON file path (default: stdout)')
    parser.add_argument('--html-only', action='store_true',
                        help='Output single HTML string instead of steps JSON')

    args = parser.parse_args()

    # Read input
    if args.input == '-':
        md_text = sys.stdin.read()
    else:
        with open(args.input, 'r', encoding='utf-8') as f:
            md_text = f.read()

    # Parse
    result = parse_article(md_text)

    # Output
    if args.html_only:
        output = generate_html_only(result)
    else:
        output = json.dumps(result, ensure_ascii=False, indent=2)

    if args.output:
        with open(args.output, 'w', encoding='utf-8') as f:
            f.write(output)
        # Stats to stderr
        n_html = sum(1 for s in result['steps'] if s['type'] == 'paste_html')
        n_code = sum(1 for s in result['steps'] if s['type'] == 'code_block')
        print(f'✓ Parsed: {len(result["steps"])} steps ({n_html} html, {n_code} code blocks)',
              file=sys.stderr)
        print(f'  Title: {result["title"]!r}', file=sys.stderr)
        print(f'  Output: {args.output}', file=sys.stderr)
    else:
        print(output)


if __name__ == '__main__':
    main()
