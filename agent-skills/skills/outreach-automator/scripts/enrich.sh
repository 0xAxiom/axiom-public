#!/bin/bash
# Enrich a GitHub user profile with public data
# Usage: enrich.sh "username"

set -euo pipefail

USERNAME="${1:?Usage: enrich.sh \"username\"}"

# Get user profile
PROFILE=$(gh api "users/$USERNAME" --jq '{
  login: .login,
  name: .name,
  bio: .bio,
  company: .company,
  location: .location,
  email: .email,
  blog: .blog,
  twitter: .twitter_username,
  followers: .followers,
  following: .following,
  public_repos: .public_repos,
  created: .created_at
}')

# Get recent repos (top 5 by stars)
REPOS=$(gh api "users/$USERNAME/repos?sort=stars&per_page=5" --jq '[.[] | {
  name: .name,
  description: .description,
  stars: .stargazers_count,
  language: .language,
  updated: .updated_at,
  url: .html_url
}]')

# Get recent activity (last 10 events)
EVENTS=$(gh api "users/$USERNAME/events/public?per_page=10" --jq '[.[] | {
  type: .type,
  repo: .repo.name,
  created: .created_at
}]' 2>/dev/null || echo '[]')

# Combine
jq -n \
  --argjson profile "$PROFILE" \
  --argjson repos "$REPOS" \
  --argjson events "$EVENTS" \
  '{profile: $profile, top_repos: $repos, recent_activity: $events}'
