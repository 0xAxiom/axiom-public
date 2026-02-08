---
name: outreach-automator
description: GitHub-based developer outreach. Find repos, enrich maintainer profiles, draft personalized emails, track contacts. Zero paid APIs.
metadata: {"clawdbot":{"emoji":"🎯","requires":{"tools":["gh"]}}}
---

# Outreach Automator 🎯

Find developers building relevant projects on GitHub. Enrich their profiles. Draft personalized outreach. Track everything.

## Why

Manual developer outreach takes hours: searching repos, finding emails, reading READMEs, writing personal messages. This automates the boring parts so you can focus on genuine connection.

## Setup

```bash
# Just need gh CLI (authenticated)
gh auth status
```

## Commands

### Discover repos
```bash
bash scripts/discover.sh "topic or query" [max_results]
```
Searches GitHub for repos matching your query. Outputs structured JSON with repo + owner data.

### Enrich a profile
```bash
bash scripts/enrich.sh "github-username"
```
Pulls public profile data: bio, company, email, blog, recent activity, top repos, contribution patterns.

### Draft outreach
```bash
bash scripts/draft.sh "github-username" "your-project-context"
```
Generates a personalized email draft based on their profile and recent work.

### Run a campaign
```bash
bash scripts/campaign.sh "query" [max_results] [context]
```
Full pipeline: discover → enrich → draft → save to queue.

### Track contacts
```bash
bash scripts/track.sh list                    # Show all contacts
bash scripts/track.sh add "username" "status"  # Add/update contact
bash scripts/track.sh sent "username"          # Mark as sent
```

## Data

All data stored in `~/.outreach/`:
- `contacts.json` - Contact database with status tracking
- `drafts/` - Generated email drafts
- `campaigns/` - Campaign history

## Integration

Works with himalaya skill for actual email sending:
```bash
# Generate draft, then send
bash scripts/draft.sh "octocat" "We built X" > /tmp/draft.md
# Review draft, then send via himalaya
```
