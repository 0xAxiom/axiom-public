# Twitter Algorithm Skill

Optimize tweets for organic reach using insights from Twitter's open-source algorithm.

## Overview

This skill provides evidence-based strategies for maximizing tweet visibility without engagement bait or gimmicks. Based on analysis of [twitter/the-algorithm](https://github.com/twitter/the-algorithm) source code.

## Quick Reference

### The Golden Rules

1. **8-hour half-life** — Early engagement compounds. Post when you can engage.
2. **Replies > Quotes > RTs > Likes** — Prioritize high-signal engagement.
3. **Native media wins** — Upload images/video directly to Twitter.
4. **0-1 hashtags** — More triggers spam detection.
5. **Ratio matters** — High following/low followers = reputation penalty.

### Pre-Post Checklist

```
[ ] Genuine value for my audience?
[ ] First line works as standalone hook?
[ ] Native media (not external links)?
[ ] 0-1 hashtags maximum?
[ ] Available to engage for next 1-2 hours?
[ ] Specific topic (not generic)?
```

## How It Works

### SimClusters (Virality Engine)
Twitter groups users into **145K interest communities**. When followers engage, your tweet inherits their interest vectors and gets recommended to similar non-followers.

**Implication:** Specific topics spread better. "AI agents on Base" > "technology is cool"

### TweepCred (Reputation Score)
PageRank-based reputation. Quality of followers matters more than quantity.

**The ratio penalty:**
```
following=5000, followers=100 → reputation ÷ 50x
following=200, followers=2000 → strong reputation signal
```

### Engagement Decay
```
Half-life: 8 hours
Hour 1: 100% weight
Hour 8: 50% weight  
Hour 16: 25% weight
```

Early engagement compounds. A tweet with 10 replies in hour 1 massively outperforms 10 replies spread over 8 hours.

## Content Guidelines

### What Gets Boosted
- `HAS_NATIVE_IMAGE` / `HAS_NATIVE_VIDEO` (explicit signals in code)
- High engagement velocity
- Engagement from high-reputation accounts
- Content matching follower interest clusters
- Replies and conversations

### What Gets Killed
| Signal | Impact |
|--------|--------|
| 2+ hashtags | Spam flag |
| High reply:like ratio | "Ratio'd" = suspicious |
| "See fewer" feedback | 0.2x for 140 days |
| External links | Neutral to negative |
| ALL CAPS | Quality penalty |
| New account | "NotGraduated" demotion |

## Timing Strategy

### Best Windows (US Tech Audience)
- **Morning:** 8-10am PT
- **Lunch:** 12-2pm PT  
- **Evening:** 6-8pm PT

### The 2-Hour Rule
First 2 hours determine a tweet's trajectory. Stay present to:
- Reply to early commenters (boosts their engagement + yours)
- Answer questions (drives more replies)
- Thank people thoughtfully (encourages more interaction)

## Scripts

### Tweet Scorer
Score a draft tweet against algorithm signals:

```bash
./scripts/score-tweet.sh "Your tweet text here"
```

Output:
```
Structure Score: 8/10
- Length: ✅ Good (156 chars)
- Hashtags: ✅ None
- Caps: ✅ Normal
- Media: ⚠️ Consider adding image

Timing Score: 7/10
- Current time: 2pm PT ✅ Good window
- Day: Monday ✅ Weekday

Recommendations:
- Add native image for +15-20% reach
- Post now and engage for next 2 hours
```

### Engagement Analyzer
Analyze a posted tweet's performance:

```bash
./scripts/analyze-tweet.sh <tweet_id>
```

### Optimal Time Calculator
Find best posting time for your audience:

```bash
./scripts/best-time.sh
```

## Integration

### With Cron Jobs
Add to your twitter posting cron:
```
Read ~/path/to/skills/twitter-algorithm/SKILL.md before composing tweets.
Run score-tweet.sh on drafts before posting.
```

### Pre-Post Validation
```javascript
import { scoreTweet } from './scripts/score-tweet.mjs';

const score = scoreTweet(draft);
if (score.total < 6) {
  console.log('Revise:', score.recommendations);
}
```

## Anti-Patterns

**Never do these:**
- "Like if you agree" (engagement bait, algorithm tracks this)
- Multiple hashtags (spam signal)
- Follow/unfollow games (kills reputation)
- Posting and disappearing (wastes the 8-hour window)
- ALL CAPS (quality penalty)
- Repetitive content (spam flag)

## References

- `references/ranking-signals.md` — Full engagement weight analysis
- `references/virality-mechanics.md` — SimClusters and For You algorithm
- `references/full-playbook.md` — Complete strategic playbook

## Source

Based on analysis of:
- `twitter/the-algorithm` (open source)
- `src/scala/com/twitter/home_mixer/` (home timeline ranking)
- `src/scala/com/twitter/cr_mixer/` (content recommendations)
- `src/scala/com/twitter/simclusters_v2/` (interest clustering)

---

*No gimmicks. The algorithm rewards quality because quality drives engagement.*
