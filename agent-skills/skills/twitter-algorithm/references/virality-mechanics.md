# Twitter/X Algorithm: Virality Mechanics Deep Dive

**Analysis Date:** 2026-02-02  
**Source:** https://github.com/twitter/the-algorithm  

---

## Executive Summary

Twitter's recommendation algorithm operates through a multi-stage pipeline: **Candidate Generation → Filtering → Ranking → Mixing**. Virality (spreading beyond followers) is primarily driven by **SimClusters community matching**, **real-time engagement velocity**, and **author reputation scores**. Content spreads when it matches interest embeddings of non-followers and demonstrates strong early engagement signals.

---

## 1. Viral Mechanics: How Content Spreads Beyond Followers

### The Core Engine: SimClusters

SimClusters is the foundation of Twitter's out-of-network recommendations. It clusters users into ~145,000 communities based on follow relationships.

**How it works:**
1. **KnownFor** - Producers (accounts you follow) are assigned to communities they're "known for"
2. **InterestedIn** - Consumers get an embedding based on which communities they follow
3. **Tweet Embeddings** - Tweets inherit embeddings from users who engage with them

**Key insight:** When you like a tweet, your InterestedIn vector is added to that tweet's embedding, making it more likely to be shown to similar users.

```
Tweet Embedding = Σ (InterestedIn vectors of users who favorited)
```

**Real-time updates:** Tweet embeddings are updated with an **8-hour half-life decay** (`HalfLife: Duration = 8.hours`). Early engagement compounds because those vectors carry more weight.

### UTEG (User Tweet Entity Graph)

The "XXX Liked" tweets you see come from UTEG—a collaborative filtering system that:
- Maintains a graph of user-tweet interactions from the past 24-48 hours
- Takes your weighted follow graph as input
- Returns tweets engaged by users you follow, weighted by engagement count

**Virality mechanism:** If multiple people you follow engage with a tweet from someone you don't follow, UTEG surfaces it to you.

---

## 2. For You Algorithm: Recommendation Pipeline

### Candidate Sources (~50% In-Network, ~50% Out-of-Network)

| Source | Type | Description |
|--------|------|-------------|
| **Earlybird Search Index** | In-Network | ~50% of tweets. Reverse chronological + light ranking |
| **UTEG** | Out-of-Network | "XXX Liked" collaborative filtering |
| **SimClusters ANN** | Out-of-Network | Community-based similarity matching |
| **Tweet Mixer / CR-Mixer** | Out-of-Network | Coordinates multiple OON candidate sources |
| **FRS (Follow Recommendations)** | Out-of-Network | Tweets from accounts you might want to follow |

### Scoring Pipeline

Tweets go through two ranking stages:

**Light Ranker (Earlybird):**
- Logistic regression predicting engagement likelihood
- Runs on ~1000s of candidates
- Key features: engagement counts, author reputation, tweet age, media type

**Heavy Ranker (Neural Network):**
- Multi-task learning model (~6000 features)
- Predicts: clicks, likes, replies, retweets, video playback
- Final score is a weighted combination of predicted engagement probabilities

### The Scoring Formula

From the codebase, the combined score uses weighted features:

```scala
combinedScore = Σ (predicted_score × weight)
```

Negative weights exist to penalize certain signals (e.g., "See fewer" feedback).

**Key multipliers found in code:**
- `OutOfNetworkScaleFactorParam` default: **0.75** (OON tweets slightly downranked)
- `ReplyScaleFactorParam` default: **0.75** (replies slightly downranked)
- `LiveContentScaleFactorParam`: up to **10000x** boost for live content
- `ControlAiShowMoreScaleFactorParam`: up to **20x** boost
- `ControlAiShowLessScaleFactorParam`: **0.05** (95% reduction)

---

## 3. Negative Signals: What Gets Demoted

### Safety Labels That Trigger Downranking

From `DownrankingRules.scala`:

| Label | Effect |
|-------|--------|
| `HighToxicityScore` | Moved to low/abusive quality section |
| `HighSpammyTweetContentScore` | Moved to abusive quality section |
| `HighCryptospamScore` | Demoted |
| `UntrustedUrl` | Moved to abusive quality section |
| `DownrankSpamReply` | Sectioned as abusive |
| `HighPSpammyTweetScore` | Moved to low quality |
| `HighProactiveTosScore` | Sectioned as abusive |
| `RitoActionedTweet` | Moved to low quality |

### User-Level Penalties

| Label | Description |
|-------|-------------|
| `NotGraduated` | New accounts without enough positive signals |
| `DownrankSpamReply` | Users flagged for spam replies |
| Low `user_reputation` (TweepCred) | Accounts with poor follower/following ratio |

### Feedback Fatigue

The `FeedbackFatigueScorer` applies multipliers based on user feedback:
- "See Fewer" feedback triggers score reduction for 140 days
- Multiplier ranges from **0.2 to 1.0** based on time since feedback
- Applies to: authors, likers, followers, retweeters

### Trust & Safety Models

Four models filter content:
1. **pNSFWMedia** - Detects adult/porn images
2. **pNSFWText** - Detects adult/sexual text
3. **pToxicity** - Detects insults, marginal harassment
4. **pAbuse** - Detects ToS violations, hate speech

### Engagement Ratio Filters

```scala
// High reply-to-like ratio = suspicious
if (replyCount > threshold && replyToLikeRatio > upperBound) {
  filter = true
}

// High quote-to-click ratio = suspicious
if (ntabClickCount >= 1000 && quoteRate < threshold) {
  filter = true
}
```

---

## 4. Cluster/Community Detection

### SimClusters Architecture

**Scale:** ~145,000 communities covering 20M producers

**Process:**
1. Build producer-producer similarity graph (cosine similarity of followers)
2. Run Metropolis-Hastings community detection
3. Each producer assigned to max 1 community (KnownFor)
4. Consumers get multi-community embeddings (InterestedIn)

**Producer Embeddings:** Unlike KnownFor (1 community), producer embeddings capture multiple topics a user is "known" in.

### Topic Embeddings

Topics get embeddings from:
- Cosine similarity between users interested in a topic
- Aggregated favorites on topic-annotated tweets (with time decay)

---

## 5. Real-Time Signals

### Engagement Velocity

The system prioritizes **early engagement** through multiple mechanisms:

**8-Hour Half-Life Decay:**
```scala
final val HalfLife: Duration = 8.hours
final val HalfLifeInMs: Long = HalfLife.inMilliseconds
```

**Tweet Age Filters:**
- Oldest tweet in light index: **1 hour**
- Oldest fav event considered: **3 days**

**Weighted Engagement Counts:**
From feature configs, these "weighted" versions account for recency and user quality:
- `weighted_favorite_count`
- `weighted_reply_count`
- `weighted_retweet_count`
- `weighted_quote_count`

Also "decayed" versions for out-of-network ranking:
- `decayed_favorite_count`
- `decayed_retweet_count`
- etc.

### Real-Time Feature Updates

The TweetJob (Heron/Storm topology) updates tweet embeddings in real-time:
- Every favorite triggers an embedding update
- Embeddings are stored in MemCache, persisted to Manhattan
- Index refreshes include cluster→tweet mappings

### TweepCred (Author Reputation)

PageRank-based score (0-100) that considers:
- Follow graph structure
- Account age
- Device usage patterns
- Safety status (restricted, suspended, verified)
- Follower/following ratio adjustment

```scala
// Penalty for low followers but high followings
if (followings > followers) {
  divisionFactor = followings / max(followers, 1)
  adjustedRank = pageRank / divisionFactor
}
```

---

## 6. Actionable Insights

### To Maximize Reach:

1. **Match community interests** - Content that resonates with a specific SimCluster community spreads within that cluster
2. **Drive early engagement** - First 8 hours are critical due to half-life decay; engagement compounds
3. **Quality over quantity** - High follower/following ratio boosts TweepCred
4. **Avoid ratio triggers** - Extreme reply-to-like or quote-to-click ratios trigger filters
5. **Visual content helps** - Media features are explicit ranking signals
6. **Verified accounts matter** - `from_verified_account_flag` is a positive signal

### What Kills Virality:

1. **Spam signals** - Multiple hashtags, link-heavy content, duplicate content
2. **Low engagement velocity** - Tweets need early engagement or they decay
3. **Negative feedback history** - "See fewer" compounds over 140 days
4. **Safety model flags** - Toxicity, abuse, NSFW scores
5. **New account status** - "NotGraduated" users get demoted
6. **Untrusted URLs** - Links to suspicious domains

### The Blue Verified Factor

From the code, there's explicit tracking of Blue Verified tweets:
```scala
val blueVerifiedTweets = postRankFilterCandidates.partition(
  _.tweetInfo.hasBlueVerifiedAnnotation.contains(true))
```

And a parameter `EnableBlueVerifiedTopK` that can prioritize them in top results.

---

## Architecture Summary

```
User Request
     ↓
┌─────────────────────────────────────────┐
│         CANDIDATE GENERATION            │
│  • Earlybird (in-network ~50%)          │
│  • UTEG (collaborative filtering)       │
│  • SimClusters ANN (community match)    │
│  • Tweet Mixer (OON coordination)       │
│  • FRS (follow recommendations)         │
└─────────────────────────────────────────┘
     ↓
┌─────────────────────────────────────────┐
│         PRE-RANK FILTERING              │
│  • Visibility rules                     │
│  • Safety model scores                  │
│  • Block/mute lists                     │
│  • Deduplication                        │
└─────────────────────────────────────────┘
     ↓
┌─────────────────────────────────────────┐
│         LIGHT RANKING                   │
│  • Logistic regression                  │
│  • ~50 features                         │
│  • Fast, runs on 1000s of candidates    │
└─────────────────────────────────────────┘
     ↓
┌─────────────────────────────────────────┐
│         HEAVY RANKING                   │
│  • Neural network (ClemNet)             │
│  • ~6000 features                       │
│  • Multi-task: click, like, RT, etc.    │
└─────────────────────────────────────────┘
     ↓
┌─────────────────────────────────────────┐
│         POST-RANK FILTERING             │
│  • Author diversity                     │
│  • Feedback fatigue                     │
│  • Content balance (in/out network)     │
└─────────────────────────────────────────┘
     ↓
┌─────────────────────────────────────────┐
│         MIXING                          │
│  • Ads injection                        │
│  • Who-to-follow modules                │
│  • Prompts                              │
└─────────────────────────────────────────┘
     ↓
Timeline Response
```

---

## Key Files Reference

| File | Purpose |
|------|---------|
| `simclusters_v2/README.md` | Community detection algorithm |
| `home-mixer/README.md` | For You pipeline architecture |
| `visibilitylib/rules/DownrankingRules.scala` | Negative signal rules |
| `graph/batch/job/tweepcred/` | Author reputation (PageRank) |
| `cr-mixer/` | Out-of-network candidate coordination |
| `trust_and_safety_models/` | Content safety models |
| `timelines/configs/*/feature_config.py` | Ranking features |

---

*Analysis by Analyst, Axiom's data specialist*
