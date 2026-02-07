#!/bin/bash
set -euo pipefail

# ============================================================================
# generate-banner.sh — Branded banner generation (fal.ai + HTML/CSS + Playwright)
#
# Usage:
#   generate-banner.sh --output /path/to/banner.png --title "Title" [options]
#
# Options:
#   --title TEXT          Main title (required)
#   --subtitle TEXT       Subtitle text
#   --tag TEXT            Top label (e.g., "AUTONOMOUS INFRASTRUCTURE")
#   --prompt TEXT         fal.ai prompt for AI background image
#   --bg-image PATH       Use existing image as background (skips fal.ai)
#   --stats TEXT          Comma-separated "Label:Value" pairs
#   --pipeline TEXT       Comma-separated pipeline step names
#   --brand TEXT          Brand text (bottom-right), default "Axiom 🔬"
#   --size WxH            Banner size, default "1250x500"
#   --output PATH         Output PNG path (required)
#   --template PATH       Custom HTML template (default: banner-default.html)
#
# Examples:
#   generate-banner.sh --output banner.png --title "Ship Log" \
#     --subtitle "Autonomous infrastructure report" \
#     --tag "WEEKLY REPORT" \
#     --prompt "abstract dark network topology, cinematic, moody" \
#     --stats "Transactions:1057,Uptime:14 days,Bugs:$0" \
#     --pipeline "REBALANCE,COMPOUND,HARVEST,BURN"
#
#   generate-banner.sh --output banner.png --title "How I Built X" \
#     --bg-image ~/existing-bg.png \
#     --subtitle "A deep dive into autonomous agents"
# ============================================================================

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SKILL_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
TEMPLATE_DIR="$SKILL_DIR/templates"
WORK_DIR=$(mktemp -d)

# Cleanup on exit
cleanup() { rm -rf "$WORK_DIR"; }
trap cleanup EXIT

# ── Defaults ──────────────────────────────────────────────────────────────────
TITLE=""
SUBTITLE=""
TAG=""
PROMPT=""
BG_IMAGE=""
STATS=""
PIPELINE=""
BRAND="Axiom 🔬"
SIZE="1250x500"
OUTPUT=""
TEMPLATE="$TEMPLATE_DIR/banner-default.html"

# ── Parse args ────────────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case $1 in
    --title)     TITLE="$2"; shift 2 ;;
    --subtitle)  SUBTITLE="$2"; shift 2 ;;
    --tag)       TAG="$2"; shift 2 ;;
    --prompt)    PROMPT="$2"; shift 2 ;;
    --bg-image)  BG_IMAGE="$2"; shift 2 ;;
    --stats)     STATS="$2"; shift 2 ;;
    --pipeline)  PIPELINE="$2"; shift 2 ;;
    --brand)     BRAND="$2"; shift 2 ;;
    --size)      SIZE="$2"; shift 2 ;;
    --output)    OUTPUT="$2"; shift 2 ;;
    --template)  TEMPLATE="$2"; shift 2 ;;
    *)           echo "Unknown option: $1"; exit 1 ;;
  esac
done

# ── Validate ──────────────────────────────────────────────────────────────────
if [[ -z "$TITLE" ]]; then
  echo "❌ --title is required"
  exit 1
fi

if [[ -z "$OUTPUT" ]]; then
  echo "❌ --output is required"
  exit 1
fi

if [[ -z "$PROMPT" && -z "$BG_IMAGE" ]]; then
  echo "⚠️  No --prompt or --bg-image provided. Using solid dark background."
fi

# ── Check dependencies ────────────────────────────────────────────────────────
check_dep() {
  if ! command -v "$1" &>/dev/null; then
    echo "❌ Missing dependency: $1"
    echo "   $2"
    exit 1
  fi
}

check_dep "npx" "Install Node.js: https://nodejs.org"
check_dep "curl" "Install curl (should be pre-installed on macOS)"

# ffmpeg is only needed if we generate from fal.ai (need to crop)
if [[ -n "$PROMPT" ]] && ! command -v ffmpeg &>/dev/null; then
  echo "❌ Missing dependency: ffmpeg (needed to crop fal.ai output)"
  echo "   brew install ffmpeg"
  exit 1
fi

# Check playwright is available
if ! npx playwright --version &>/dev/null 2>&1; then
  echo "❌ Playwright not installed. Run: npx playwright install chromium"
  exit 1
fi

# ── Parse size ────────────────────────────────────────────────────────────────
WIDTH="${SIZE%%x*}"
HEIGHT="${SIZE##*x}"

# ── Step 1: Generate or prepare background image ─────────────────────────────
BG_PATH="$WORK_DIR/bg.png"

if [[ -n "$BG_IMAGE" ]]; then
  echo "📷 Using provided background: $BG_IMAGE"
  if [[ ! -f "$BG_IMAGE" ]]; then
    echo "❌ Background image not found: $BG_IMAGE"
    exit 1
  fi
  cp "$BG_IMAGE" "$BG_PATH"
elif [[ -n "$PROMPT" ]]; then
  echo "🎨 Generating background via fal.ai..."

  # Source API key
  if [[ -f ~/.axiom/wallet.env ]]; then
    source ~/.axiom/wallet.env
  fi

  if [[ -z "${FAL_API_KEY:-}" ]]; then
    echo "❌ FAL_API_KEY not set. Add to ~/.axiom/wallet.env"
    exit 1
  fi

  # Enhance prompt for banner-appropriate output
  ENHANCED_PROMPT="$PROMPT, abstract, no text, no words, no letters, cinematic lighting, dark moody atmosphere, 8k"

  # Escape JSON string
  JSON_PROMPT=$(echo "$ENHANCED_PROMPT" | python3 -c "import sys,json; print(json.dumps(sys.stdin.read().strip()))")

  RESPONSE=$(curl -s "https://fal.run/fal-ai/flux/schnell" \
    -H "Authorization: Key $FAL_API_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"prompt\": $JSON_PROMPT, \"image_size\": \"landscape_16_9\", \"num_images\": 1}")

  IMAGE_URL=$(echo "$RESPONSE" | python3 -c "import sys,json; print(json.loads(sys.stdin.read())['images'][0]['url'])" 2>/dev/null)

  if [[ -z "$IMAGE_URL" || "$IMAGE_URL" == "None" ]]; then
    echo "❌ fal.ai API error: $RESPONSE"
    exit 1
  fi

  RAW_IMG="$WORK_DIR/raw.png"
  curl -s "$IMAGE_URL" -o "$RAW_IMG"
  echo "✓ Downloaded fal.ai image"

  # Crop to target aspect ratio (center crop)
  echo "✂️  Cropping to ${WIDTH}x${HEIGHT}..."
  ffmpeg -y -i "$RAW_IMG" \
    -vf "scale=max(${WIDTH}\,iw*${HEIGHT}/ih):max(${HEIGHT}\,ih*${WIDTH}/iw),crop=${WIDTH}:${HEIGHT}" \
    -frames:v 1 -update 1 "$BG_PATH" 2>/dev/null
  echo "✓ Cropped background"
else
  # No background — create a dark solid image with subtle noise
  echo "🖤 Using solid dark background"
  # Create 1px dark image, ffmpeg will scale it
  ffmpeg -y -f lavfi -i "color=c=#0a0a0a:s=${WIDTH}x${HEIGHT}:d=1" \
    -frames:v 1 -update 1 "$BG_PATH" 2>/dev/null 2>&1 || {
    # Fallback: create via python if ffmpeg not available
    python3 -c "
import struct, zlib
def create_png(w, h, r, g, b):
    def chunk(ctype, data):
        c = ctype + data
        return struct.pack('>I', len(data)) + c + struct.pack('>I', zlib.crc32(c) & 0xffffffff)
    raw = b''
    for y in range(h):
        raw += b'\x00' + bytes([r, g, b]) * w
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b'')
with open('$BG_PATH', 'wb') as f:
    f.write(create_png($WIDTH, $HEIGHT, 10, 10, 10))
"
  }
fi

# ── Step 2: Build stats HTML ─────────────────────────────────────────────────
STATS_HTML=""
if [[ -n "$STATS" ]]; then
  IFS=',' read -ra STAT_PAIRS <<< "$STATS"
  for pair in "${STAT_PAIRS[@]}"; do
    LABEL="${pair%%:*}"
    VALUE="${pair#*:}"
    STATS_HTML+="<div class=\"stat\"><span class=\"stat-value\">$VALUE</span><span class=\"stat-label\">$LABEL</span></div>"
  done
fi

# ── Step 3: Build pipeline HTML ──────────────────────────────────────────────
PIPELINE_HTML=""
if [[ -n "$PIPELINE" ]]; then
  IFS=',' read -ra STEPS <<< "$PIPELINE"
  for i in "${!STEPS[@]}"; do
    if [[ $i -gt 0 ]]; then
      PIPELINE_HTML+="<span class=\"pipeline-arrow\">→</span>"
    fi
    PIPELINE_HTML+="<span class=\"pipeline-step\">${STEPS[$i]}</span>"
  done
fi

# ── Step 4: Fill HTML template ────────────────────────────────────────────────
echo "📝 Building HTML from template..."

# Use absolute path for background image in HTML
BG_ABS_PATH="$(cd "$(dirname "$BG_PATH")" && pwd)/$(basename "$BG_PATH")"

# Export values as environment variables for Python (avoids heredoc/interpolation issues)
export _TITLE="$TITLE"
export _SUBTITLE="$SUBTITLE"
export _TAG="$TAG"
export _BG_ABS_PATH="$BG_ABS_PATH"
export _STATS_HTML="$STATS_HTML"
export _PIPELINE_HTML="$PIPELINE_HTML"
export _BRAND="$BRAND"
export _TEMPLATE="$TEMPLATE"
export _OUTPUT_HTML="$WORK_DIR/banner.html"

# Write replacement values to a JSON file (avoids shell interpolation issues with unicode)
python3 -c "
import json, sys, os

replacements = {
    '{{TITLE}}': os.environ.get('_TITLE', ''),
    '{{SUBTITLE}}': os.environ.get('_SUBTITLE', ''),
    '{{TAG}}': os.environ.get('_TAG', ''),
    '{{BG_IMAGE}}': 'file://' + os.environ.get('_BG_ABS_PATH', ''),
    '{{STATS_HTML}}': os.environ.get('_STATS_HTML', ''),
    '{{PIPELINE_HTML}}': os.environ.get('_PIPELINE_HTML', ''),
    '{{BRAND}}': os.environ.get('_BRAND', 'Axiom'),
}

template_path = os.environ['_TEMPLATE']
output_path = os.environ['_OUTPUT_HTML']

with open(template_path, 'r') as f:
    html = f.read()

for key, value in replacements.items():
    html = html.replace(key, value)

with open(output_path, 'w') as f:
    f.write(html)

print('✓ HTML template filled')
" || { echo "❌ Template fill failed"; exit 1; }

# ── Step 5: Screenshot with Playwright ────────────────────────────────────────
echo "📸 Taking screenshot with Playwright..."

HTML_PATH="$WORK_DIR/banner.html"
SCREENSHOT_PATH="$WORK_DIR/screenshot.png"

npx playwright screenshot \
  --browser chromium \
  --viewport-size "${WIDTH},${HEIGHT}" \
  --full-page \
  "file://$HTML_PATH" \
  "$SCREENSHOT_PATH" 2>/dev/null

if [[ ! -f "$SCREENSHOT_PATH" ]]; then
  echo "❌ Playwright screenshot failed"
  exit 1
fi

# ── Step 6: Copy to output ────────────────────────────────────────────────────
mkdir -p "$(dirname "$OUTPUT")"
cp "$SCREENSHOT_PATH" "$OUTPUT"

echo ""
echo "✅ Banner generated: $OUTPUT"
echo "   Size: ${WIDTH}×${HEIGHT}"
ls -lh "$OUTPUT" | awk '{print "   File: "$5}'
