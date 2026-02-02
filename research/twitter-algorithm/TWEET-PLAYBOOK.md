# Twitter Algorithm Playbook for @AxiomBot

*Synthesized from Twitter's open-source algorithm analysis*  
*Last updated: 2026-02-02*

---

## How the Algorithm Actually Works

The For You feed runs a multi-stage pipeline:
1. **Candidate Generation** — ~50% from accounts you follow, ~50% from community matching
2. **Light Ranking** — Fast filter using engagement predictions
3. **Heavy Ranking** — Neural network with ~6,000 features
4. **Mixing** — Balance in-network/out-of-network, inject ads

**The core equation:** Tweets are scored by predicted engagement probability × author reputation × relevance to viewer.

---

## 1. Tweet Structure Rules

### Length
- **Optimal:** 100-200 characters gets engagement without truncation
- **Acceptable:** Up to 280 characters
- **Algorithm impact:** Minimal — length is bucketed (short/medium/long), not scored linearly
- **Reality:** Say what you need to say; don't pad or truncate artificially

### Media
| Type | Algorithm Signal | Recommendation |
|------|-----------------|----------------|
| **Native images** | `HAS_NATIVE_IMAGE` ✅ | Use Twitter's image upload |
| **Native video** | `HAS_NATIVE_VIDEO` ✅ | Upload directly to Twitter |
| **External links** | Neutral to negative | Only if high-value; expect dwell tracking |
| **No media** | Neutral | Fine for text-first content |
| **Multiple images** | `HAS_MULTIPLE_MEDIA` ✅ | Good for visual threads |

**Rule:** When using media, upload natively. Don't link to external image hosts.

### Hashtags
- **0-1 hashtags:** Safe
- **2+ hashtags:** Triggers `HAS_MULTIPLE_HASHTAGS_OR_TRENDS` — potential spam signal
- **Trending hashtags:** Only if genuinely relevant; algorithm tracks trend exploitation

**Rule:** Use hashtags sparingly or not at all. Your content should reach people through engagement, not hashtag discovery.

### Links
- **Algorithm tracks:** `IS_GOOD_OPEN_LINK` — did users spend time on the linked content?
- **Risk:** Links without engagement (people click away quickly) hurt reach
- **Safe:** Links to high-quality content that people actually read

**Rule:** Link only to genuinely valuable resources. If linking to your own content, make sure it's worth the click.

### Text Formatting
| Signal | Algorithm Treatment |
|--------|---------------------|
| Excessive caps (`NUM_CAPS`) | Quality penalty |
| Normal punctuation | Neutral |
| Questions (`HAS_QUESTION`) | Tracked (can indicate engagement bait) |
| Emojis | Neutral, use naturally |

**Rule:** Write like a human, not a marketer. No ALL CAPS HYPE.

---

## 2. Timing Strategy

### The 8-Hour Half-Life

**Critical insight:** Tweet embeddings decay with an 8-hour half-life. This means:
- Hour 0-1: 100% of engagement value
- Hour 8: 50% of engagement value  
- Hour 16: 25% of engagement value
- Hour 24: 12.5% of engagement value

**Implication:** Early engagement compounds. A tweet that gets 10 likes in the first hour is weighted more than one that gets 50 likes across 24 hours.

### Optimal Posting Windows

Based on decay mechanics, post when:
1. **Your audience is most active** — Check Twitter Analytics for your followers' peak hours
2. **You can engage with responses** — First 1-2 hours matter most
3. **There's time for engagement to compound** — Don't post right before you sleep

For AI/tech audience (US-centric):
- **Morning burst:** 8-10am PT (11am-1pm ET)
- **Afternoon engagement:** 12-2pm PT (3-5pm ET)
- **Evening scroll:** 6-8pm PT (9-11pm ET)

### Reply Timing

Replies to your own tweets extend engagement windows:
- **Quick replies** to early commenters shows you're present
- **Don't reply-spam** your own tweet — looks desperate
- **Quality replies** that add value can trigger new engagement cycles

### Thread Pacing

For multi-tweet threads:
1. Post thread sequentially (not all at once)
2. **First tweet must stand alone** — it's the hook
3. Leave ~30-60 seconds between tweets
4. Engage with the thread replies before posting more content

---

## 3. Engagement Optimization

### Engagement Hierarchy (by weight)

| Tier | Action | Why It Matters |
|------|--------|----------------|
| **Tier 1** | Reply | High investment, creates conversation |
| **Tier 1** | Quote Tweet | Public endorsement + commentary |
| **Tier 1** | Retweet | Public endorsement, spreads to RT'er's followers |
| **Tier 2** | Like | Core metric, tracked heavily |
| **Tier 2** | Bookmark | Strong intent signal (algorithm sees this) |
| **Tier 3** | Profile click | Interest signal |
| **Tier 3** | Dwell time | Implicit engagement (pausing on tweet) |

### How to Encourage High-Value Engagement

**For replies:**
- Share genuine insights that invite discussion
- Ask specific questions (not "what do you think?")
- Leave something unsaid that experts will want to add

**For quote tweets:**
- Make bold claims worth responding to
- Share frameworks others can apply to their work
- Say something slightly controversial but defensible

**For retweets:**
- Create genuinely useful reference material
- Share surprising data or insights
- Make something that helps people look smart for sharing

### RealGraph: The Relationship Multiplier

Engagement from users you have a **strong relationship with** (mutual follows, past interactions) weighs more than engagement from strangers.

**Building RealGraph strength:**
- Reply thoughtfully to accounts you respect
- Like their content when genuinely interested
- Quote tweet with real value-adds
- Don't follow/unfollow game — it degrades relationships

### Engagement Quality Filter

The algorithm weights engagement by engager reputation:
- `InNetworkFavoritesAvgRealGraphWeight` — average reputation of likers
- Verified/high-Tweepcred accounts' engagement counts more

**Implication:** 10 likes from respected builders > 100 likes from low-quality accounts.

---

## 4. Content Strategy for AI/Tech

### SimClusters: How Topics Spread

Twitter clusters users into ~145,000 communities based on who they follow. Your content spreads when:
1. Your followers engage (in-network)
2. Those engagers' interest vectors get added to your tweet's embedding
3. People with similar interests (but who don't follow you) see it via "For You"

**Strategy:** Be specific enough to resonate with a community. "AI" is too broad. "AI agents," "autonomous AI," "agentic systems" — more specific communities.

### Topics That Perform Well

Based on AI/tech audience patterns:

| Topic Type | Why It Works |
|------------|--------------|
| **Build logs** | Authenticity, specificity, shows real work |
| **Technical insights** | Demonstrates expertise, reference-worthy |
| **Tool recommendations** | Utility, people share useful resources |
| **Problem → solution stories** | Narrative engagement, relatable |
| **Contrarian takes (backed by experience)** | Provokes thought, invites debate |
| **Demos/screenshots of work** | Visual engagement + credibility |

### Content Formats That Work

1. **The insight tweet** — One clear, novel observation
2. **The thread** — Deep dive on a topic you know well
3. **The screenshot** — Code, metrics, or UX that shows real work
4. **The question** — Genuine curiosity that invites expert responses
5. **The resource** — Tools, papers, links that help others

### Language Matching

Algorithm tracks: `MATCH_UI_LANG`, `MATCH_SEARCHER_MAIN_LANG`

**Rule:** Tweet in the language your audience uses. For global tech audience, English is default. Don't switch languages mid-thread.

---

## 5. Author Reputation (TweepCred)

### How Your Reputation Score Works

Twitter uses a PageRank-based system (TweepCred) scoring 0-100:

**Boosts reputation:**
- Verified status (automatic 100)
- High follower/following ratio
- Account age
- Valid device usage
- Low block/report history

**Kills reputation:**
- High following, low followers (up to **50x penalty**)
- Spam/abuse flags
- High block/mute rate
- Restricted account status

### The Follower/Following Ratio Rule

From the code:
```
if followings > 2500 AND ratio > 0.6:
    penalty = exponential based on how bad the ratio is
    reputation = reputation / min(penalty, 50)
```

**Translation:** 
- Following 5,000, followers 100 = massive penalty
- Following 500, followers 1,000 = fine
- Following 200, followers 10,000 = great

**Rule:** Unfollow accounts you don't actually read. Maintain a healthy ratio naturally.

---

## 6. Anti-Patterns: What Hurts Reach

### Spam Signals

| Signal | Consequence |
|--------|-------------|
| Multiple hashtags | `HighSpammyTweetContentScore` |
| Excessive caps | Quality penalty |
| Duplicate/repetitive content | Spam flag |
| Link-heavy tweets | Trust penalty |
| Follow/unfollow patterns | Reputation damage |

### Ratio Triggers

The algorithm flags suspicious engagement ratios:

- **High reply-to-like ratio** — Indicates controversial/problematic content
- **High quote-to-click ratio** — May indicate quote-dunking

**Rule:** If your tweets consistently get ratio'd, the algorithm learns to demote them.

### Negative Feedback Compounding

When users click "See fewer," "Not interested," or "Don't like":
- `FeedbackFatigueScorer` applies **140-day penalty**
- Multiplier ranges from 0.2x to 1.0x based on recency
- Applies to your tweets, your retweets, even tweets you like

**Rule:** Don't annoy people. A few "see fewer" clicks have lasting effects.

### Safety Model Triggers

Four models scan your content:
1. **pToxicity** — Insults, harassment
2. **pAbuse** — ToS violations, hate
3. **pNSFWText** — Adult content
4. **pNSFWMedia** — Adult images

Even if you don't get banned, high scores move you to "low quality" sections.

### New Account Penalty

"NotGraduated" label applies to new accounts without:
- Enough positive engagement history
- Verified status
- Strong reputation signals

**Rule:** New accounts should focus on quality engagement before expecting reach.

---

## 7. The Compound Effect

### How Viral Spreads Actually Work

1. **Post** → Your followers see it (in-network)
2. **Early engagement** → Followers' interest vectors get added to tweet embedding
3. **SimClusters matching** → Tweet surfaces to similar non-followers via "For You"
4. **UTEG** → "Your follow liked" surfaces to their followers
5. **Engagement velocity** → More engagement in first 8 hours = more reach
6. **Compound** → Each new engager adds their vector, expanding audience

### Breaking Out of Your Bubble

Your content reaches non-followers when:
- Multiple people someone follows engage with your tweet (UTEG)
- Your tweet's embedding matches their interest embedding (SimClusters)
- You're in their Follow Recommendations sources

**Strategy:** Don't optimize for followers. Optimize for getting your existing followers to engage, which expands reach.

---

## Quick Reference Card

### Before Posting
- [ ] Does this provide genuine value?
- [ ] Is the first sentence a hook that stands alone?
- [ ] Am I using native media (not external links)?
- [ ] 0-1 hashtags max?
- [ ] No excessive caps or formatting?

### After Posting (First 2 Hours)
- [ ] Am I available to reply to comments?
- [ ] Did I add thoughtful responses (not just "thanks!")?
- [ ] Did I engage with people who quoted/replied thoughtfully?

### Weekly Check
- [ ] Follower/following ratio healthy (not following 5x my followers)?
- [ ] No spam signals (repetitive content, hashtag stuffing)?
- [ ] Building genuine relationships with accounts I respect?

---

*Remember: The algorithm rewards genuine quality and engagement. There are no hacks — just consistent value.*
