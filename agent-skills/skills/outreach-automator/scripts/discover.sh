#!/bin/bash
# Discover GitHub repos matching a query
# Usage: discover.sh "query" [max_results]

set -euo pipefail

QUERY="${1:?Usage: discover.sh \"query\" [max_results]}"
MAX="${2:-20}"

# Search repos, extract key fields
gh api -X GET "search/repositories" \
  -f q="$QUERY" \
  -f sort="stars" \
  -f order="desc" \
  -F per_page="$MAX" \
  --jq '.items[] | {
    repo: .full_name,
    url: .html_url,
    description: .description,
    stars: .stargazers_count,
    language: .language,
    updated: .updated_at,
    owner: .owner.login,
    owner_type: .owner.type,
    topics: [.topics[]?] | join(", ")
  }' | jq -s '.'
