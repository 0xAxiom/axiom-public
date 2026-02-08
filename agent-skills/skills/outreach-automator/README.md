# Outreach Automator 🎯

GitHub-based developer outreach pipeline. Find repos, enrich maintainer profiles, draft personalized emails, track contacts. Zero paid APIs required.

## Problem

Developer outreach is tedious. You search GitHub for repos, click through profiles, hunt for emails, read READMEs to personalize your message, then track who you contacted in a spreadsheet. This takes hours for 20 people.

## Solution

Four scripts that automate the boring parts:

1. **discover.sh** - Search GitHub repos by topic, language, stars
2. **enrich.sh** - Pull full profile data for any GitHub user (bio, email, blog, twitter, top repos, recent activity)
3. **campaign.sh** - Run the full pipeline: discover → enrich → save → track
4. **track.sh** - CRM-lite contact tracking with status history

## Quick Start

```bash
# Prerequisites: gh CLI authenticated
gh auth status

# Discover repos about a topic
bash scripts/discover.sh "uniswap v4 hooks" 10

# Enrich a specific developer
bash scripts/enrich.sh "haydenAdams"

# Run a full campaign
bash scripts/campaign.sh "solana agent kit" 20

# Check your contacts
bash scripts/track.sh list
bash scripts/track.sh stats
```

## Data Storage

All data lives in `~/.outreach/`:
```
~/.outreach/
  contacts.json          # Contact database
  campaigns/
    20260208-140000/
      discovered.json    # Raw repo search results
      enriched.json      # Full profile data
      summary.json       # Quick reference
      username.json      # Individual profiles
  drafts/                # Email drafts
```

## Integration with AI Agents

The real power is combining this with an LLM. The enriched profile data gives your agent everything it needs to write genuinely personalized outreach:

```bash
# 1. Run campaign
bash scripts/campaign.sh "openclaw skills" 20

# 2. Feed enriched data to your agent for draft generation
# (The JSON includes bio, top repos, recent activity, blog URL)

# 3. Send via himalaya
himalaya send -f draft.eml

# 4. Track
bash scripts/track.sh sent "username"
```

## Requirements

- `gh` CLI (authenticated)
- `jq`
- That's it. No paid APIs.

## License

MIT
