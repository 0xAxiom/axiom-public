#!/bin/bash
# Run a full outreach campaign: discover → enrich → save
# Usage: campaign.sh "query" [max_results] [context]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
QUERY="${1:?Usage: campaign.sh \"query\" [max_results] [context]}"
MAX="${2:-10}"
CONTEXT="${3:-}"
CAMPAIGN_ID=$(date +%Y%m%d-%H%M%S)

DATA_DIR="${HOME}/.outreach"
CAMPAIGN_DIR="${DATA_DIR}/campaigns/${CAMPAIGN_ID}"
DRAFTS_DIR="${DATA_DIR}/drafts"

mkdir -p "$CAMPAIGN_DIR" "$DRAFTS_DIR"

echo "🎯 Starting campaign: $CAMPAIGN_ID"
echo "   Query: $QUERY"
echo "   Max results: $MAX"
echo ""

# Step 1: Discover repos
echo "📡 Discovering repos..."
REPOS=$(bash "$SCRIPT_DIR/discover.sh" "$QUERY" "$MAX")
echo "$REPOS" > "${CAMPAIGN_DIR}/discovered.json"

REPO_COUNT=$(echo "$REPOS" | jq 'length')
echo "   Found $REPO_COUNT repos"
echo ""

# Step 2: Extract unique owners
OWNERS=$(echo "$REPOS" | jq -r '[.[].owner] | unique | .[]')

# Step 3: Enrich each owner
echo "🔍 Enriching profiles..."
ENRICHED="[]"
for OWNER in $OWNERS; do
  echo "   → $OWNER"
  
  # Skip if already contacted
  EXISTING=$(bash "$SCRIPT_DIR/track.sh" status "$OWNER" 2>/dev/null)
  if echo "$EXISTING" | jq -e '.status == "sent"' > /dev/null 2>&1; then
    echo "     (already contacted, skipping)"
    continue
  fi
  
  PROFILE=$(bash "$SCRIPT_DIR/enrich.sh" "$OWNER" 2>/dev/null || echo '{"error": "failed to enrich"}')
  
  # Save individual profile
  echo "$PROFILE" > "${CAMPAIGN_DIR}/${OWNER}.json"
  
  # Add to enriched list
  ENRICHED=$(echo "$ENRICHED" | jq --argjson p "$PROFILE" '. + [$p]')
  
  # Track as discovered
  bash "$SCRIPT_DIR/track.sh" add "$OWNER" "discovered" > /dev/null
  
  # Rate limit (GitHub API)
  sleep 1
done

echo "$ENRICHED" > "${CAMPAIGN_DIR}/enriched.json"
echo ""

# Step 4: Generate summary
SUMMARY=$(echo "$ENRICHED" | jq '[.[] | {
  username: .profile.login,
  name: .profile.name,
  email: .profile.email,
  blog: .profile.blog,
  twitter: .profile.twitter,
  bio: .profile.bio,
  top_repo: (.top_repos[0].name // "none"),
  followers: .profile.followers
}]')

echo "$SUMMARY" > "${CAMPAIGN_DIR}/summary.json"

echo "✅ Campaign complete: $CAMPAIGN_ID"
echo "   Profiles enriched: $(echo "$ENRICHED" | jq 'length')"
echo "   Data saved to: $CAMPAIGN_DIR"
echo ""
echo "📋 Summary:"
echo "$SUMMARY" | jq -r '.[] | "  \(.username) | \(.name // "?") | \(.email // "no email") | \(.followers) followers"'
echo ""
echo "Next steps:"
echo "  1. Review profiles in $CAMPAIGN_DIR/"
echo "  2. Use an LLM to draft personalized emails from enriched data"
echo "  3. Send via himalaya: himalaya send -f draft.eml"
echo "  4. Track: bash track.sh sent \"username\""
