# Twitter/X Algorithm Ranking Signals Analysis

> Analysis of Twitter's open-source recommendation algorithm  
> Repository: https://github.com/twitter/the-algorithm  
> Analyzed: February 2026

---

## Executive Summary

Twitter's For You timeline is powered by a multi-stage ranking pipeline:
1. **Candidate Sourcing** — Narrow ~1B tweets to ~1,500 candidates
2. **Light Ranker** — Fast logistic regression to filter to ~300
3. **Heavy Ranker** — Neural network scoring with ~6,000 features
4. **Filters & Mixing** — Diversity, visibility rules, ads integration

The algorithm heavily favors **engagement probability** (likes, retweets, replies), **author reputation** (Tweepcred/PageRank), and **relevance to viewer** (RealGraph relationship strength).

---

## 1. Ranking Signals Overview

### Core Engagement Predictions

The Heavy Ranker predicts probabilities for multiple engagement types:

```
File: src/scala/com/twitter/timelines/prediction/features/recap/RecapFeatures.scala
```

| Signal | Feature Name | Description |
|--------|--------------|-------------|
| **Like (Fav)** | `PREDICTED_IS_FAVORITED` | P(user likes tweet) |
| **Retweet** | `PREDICTED_IS_RETWEETED` | P(user retweets) |
| **Reply** | `PREDICTED_IS_REPLIED` | P(user replies) |
| **Quote Tweet** | `PREDICTED_IS_QUOTED` | P(user quote tweets) |
| **Click** | `PREDICTED_IS_CLICKED` | P(user clicks tweet) |
| **Profile Click** | `PREDICTED_IS_PROFILE_CLICKED` | P(user clicks author profile) |
| **Video Playback 50%** | `PREDICTED_IS_VIDEO_PLAYBACK_50` | P(user watches 50% of video) |
| **Bookmark** | `PREDICTED_IS_BOOKMARKED` | P(user bookmarks) |
| **Share** | `PREDICTED_IS_SHARED` | P(user shares) |

### Negative Engagement Predictions (Penalties)

```
File: src/scala/com/twitter/timelines/prediction/features/recap/RecapFeatures.scala
```

| Signal | Feature Name | Impact |
|--------|--------------|--------|
| **Don't Like** | `PREDICTED_IS_DONT_LIKE` | Downrank |
| **Block** | `IS_BLOCK_CLICKED` / `IS_BLOCK_DIALOG_BLOCKED` | Heavy penalty |
| **Mute** | `IS_MUTE_DIALOG_MUTED` | Penalty |
| **Report** | `PREDICTED_IS_REPORT_TWEET_CLICKED` | Heavy penalty |
| **Negative Feedback** | `PREDICTED_IS_NEGATIVE_FEEDBACK` | Downrank |
| **"Not Interested"** | `IS_NOT_INTERESTED_IN` | Downrank |
| **See Fewer** | `IS_SEE_FEWER` | Downrank author |

---

## 2. Engagement Weight Hierarchy

Based on the code structure and feature prominence, here's the implied engagement hierarchy:

### Tier 1 — Highest Weight (Public + Strong Signal)
1. **Retweet** — Strongest endorsement, public action
2. **Reply** — High investment engagement
3. **Quote Tweet** — Retweet + commentary

### Tier 2 — High Weight (Public/Semi-public)
4. **Like (Favorite)** — Core engagement metric
5. **Bookmark** — Strong intent signal (private)
6. **Share** — Distribution intent

### Tier 3 — Medium Weight (Implicit)
7. **Profile Click** — Interest in author
8. **Click/Detail Expand** — Content interest
9. **Video Playback** — Attention metric
10. **Dwell Time** — Passive engagement

### Code Evidence

```scala
// File: src/scala/com/twitter/timelines/prediction/features/engagement_features/EngagementFeatures.scala

case class EngagementFeatures(
  favoritedBy: Seq[Long] = Nil,      // Who liked
  retweetedBy: Seq[Long] = Nil,      // Who retweeted  
  repliedBy: Seq[Long] = Nil,        // Who replied
  realGraphWeightByUser: Map[Long, Double] = Map.empty  // Relationship strength
)
```

### Weighted Engagement Counts

The algorithm uses **decayed** and **weighted** counts that factor in recency and engager quality:

```scala
// File: src/scala/com/twitter/timelines/prediction/features/common/TimelinesSharedFeatures.scala

val WEIGHTED_FAV_COUNT       // Quality-adjusted like count
val WEIGHTED_RETWEET_COUNT   // Quality-adjusted RT count  
val WEIGHTED_REPLY_COUNT     // Quality-adjusted reply count
val WEIGHTED_QUOTE_COUNT     // Quality-adjusted quote count

val DECAYED_FAVORITE_COUNT   // Time-decayed likes
val DECAYED_RETWEET_COUNT    // Time-decayed RTs
val DECAYED_REPLY_COUNT      // Time-decayed replies
```

### RealGraph Weight Multiplier

Engagements from users with **high RealGraph weight** (strong relationship to viewer) count more:

```scala
// File: src/scala/com/twitter/timelines/prediction/features/engagement_features/EngagementFeatures.scala

val InNetworkFavoritesAvgRealGraphWeight    // Avg relationship strength of likers
val InNetworkFavoritesMaxRealGraphWeight    // Max relationship strength
val InNetworkRetweetsAvgRealGraphWeight     // Avg for retweeters
val InNetworkRepliesAvgRealGraphWeight      // Avg for repliers
```

---

## 3. Time Decay / Freshness

```
File: src/scala/com/twitter/timelines/prediction/features/time_features/TimeDataRecordFeatures.scala
```

### Key Time Features

| Feature | Description |
|---------|-------------|
| `TIME_SINCE_TWEET_CREATION` | Hours/minutes since posted |
| `TIME_SINCE_SOURCE_TWEET_CREATION` | For RTs, age of original |
| `TWEET_AGE_RATIO` | Tweet age relative to timeline range |
| `IS_TWEET_RECYCLED` | Was this shown before? |
| `LAST_FAVORITE_SINCE_CREATION_HRS` | Time since last like |
| `LAST_RETWEET_SINCE_CREATION_HRS` | Time since last RT |
| `TIME_SINCE_LAST_FAVORITE_HRS` | Recency of engagement |

### Engagement Velocity Signals

The algorithm tracks **when** engagements happen relative to tweet age:

```scala
val LAST_FAVORITE_SINCE_CREATION_HRS    // Last like relative to creation
val LAST_RETWEET_SINCE_CREATION_HRS     // Last RT relative to creation
val LAST_REPLY_SINCE_CREATION_HRS       // Last reply relative to creation
val LAST_QUOTE_SINCE_CREATION_HRS       // Last quote relative to creation
```

**Key insight**: A tweet with recent engagement velocity gets boosted even if it's older.

---

## 4. User Reputation (Tweepcred)

```
File: src/scala/com/twitter/graph/batch/job/tweepcred/
```

### PageRank-Based Reputation

Twitter uses a modified PageRank algorithm called **Tweepcred** to score user reputation:

```scala
// File: src/scala/com/twitter/graph/batch/job/tweepcred/Reputation.scala

def scaledReputation(raw: Double): Byte = {
  // Convert PageRank to 0-100 scale
  // Formula: 130 + 5.21 * log(pagerank)
  val e: Double = 130d + 5.21 * scala.math.log(raw)
  val pos = scala.math.rint(e)
  // Clamp to 0-100
  if (pos > 100) 100.0 else if (pos < 0) 0.0 else pos
}
```

### Follower/Following Ratio Penalty

Users with **high following but low followers** get penalized:

```scala
// File: src/scala/com/twitter/graph/batch/job/tweepcred/Reputation.scala

def adjustReputationsPostCalculation(mass: Double, numFollowers: Int, numFollowings: Int) = {
  if (numFollowings > 2500) {  // threshAbsNumFriendsReps
    val friendsToFollowersRatio = (1.0 + numFollowings) / (1.0 + numFollowers)
    // Exponential penalty for high ratio
    val divFactor = exp(3.0 * (ratio - 0.6) * log(log(numFollowings)))
    mass / (min(divFactor, 50) max 1.0)
  }
}
```

**Translation**: If you follow 5000 people but have 100 followers, your reputation gets divided by up to 50x.

### User Mass Calculation

```scala
// File: src/scala/com/twitter/graph/batch/job/tweepcred/UserMass.scala

// Mass calculation factors:
// - Verified users: score = 100 (max)
// - Suspended users: score = 0
// - Has valid device: +0.5
// - Account age (normalized for first 30 days)
// - Restricted accounts: 0.1x multiplier

// Friends-to-followers ratio penalty kicks in when:
// numFollowings > 500 AND ratio > 0.6
```

### Reputation Features Used in Ranking

```scala
// File: src/scala/com/twitter/timelines/prediction/features/recap/RecapFeatures.scala

val USER_REP             // Author's Tweepcred score
val SOURCE_AUTHOR_REP    // For RTs, original author's score
val FROM_VERIFIED_ACCOUNT // Verified badge
val IS_AUTHOR_NEW        // New account flag
val IS_AUTHOR_NSFW       // NSFW flag
val IS_AUTHOR_SPAM       // Spam flag  
val IS_AUTHOR_BOT        // Bot flag
```

---

## 5. Content Signals

### Media Presence

```scala
// File: src/scala/com/twitter/timelines/prediction/features/recap/RecapFeatures.scala

// BOOST signals
val HAS_IMAGE            // Contains image
val HAS_VIDEO            // Contains video
val HAS_NATIVE_VIDEO     // Twitter-hosted video
val HAS_NATIVE_IMAGE     // Twitter-hosted image
val HAS_CONSUMER_VIDEO   // User-generated video
val HAS_CARD             // Rich preview card
val HAS_QUOTE            // Quote tweet
val CONTAINS_MEDIA       // Any media

// Media quality signals
val HAS_MULTIPLE_MEDIA   // Multiple images/videos
val VIDEO_VIEW_COUNT     // Video views
val VIDEO_DURATION       // Video length
```

### Links

```scala
// Neutral to negative signals
val HAS_LINK             // Contains URL
val HAS_VISIBLE_LINK     // Display URL shown
val LINK_COUNT           // Number of links
val URL_DOMAINS          // Domain features

// Quality link signals  
val HAS_NEWS             // News domain
val IS_GOOD_OPEN_LINK    // User spent time on link
```

### Hashtags

```scala
val NUM_HASHTAGS         // Count of hashtags
val HAS_HASHTAG          // Boolean
val HAS_TREND            // Contains trending hashtag
val HAS_MULTIPLE_HASHTAGS_OR_TRENDS  // Potential spam signal
```

### Text Features

```scala
// File: src/scala/com/twitter/timelines/prediction/features/common/TimelinesSharedFeatures.scala

val TWEET_LENGTH         // Character count
val TWEET_LENGTH_TYPE    // Short/Medium/Long bucket
val NUM_CAPS             // Excessive caps = spam signal
val NUM_NEWLINES         // Formatting
val NUM_WHITESPACES      // Formatting
val HAS_QUESTION         // Question format (engagement bait?)
val NUM_EMOJIS           // Emoji usage
val NUM_EMOTICONS        // :) usage
```

### Language Matching

```scala
val MATCH_UI_LANG              // Tweet language matches user's UI
val MATCH_SEARCHER_MAIN_LANG   // Matches user's primary language
val MATCH_SEARCHER_LANGS       // Matches any user language
val LANGUAGE                   // Tweet language code
```

---

## 6. RealGraph (Relationship Strength)

```
File: src/scala/com/twitter/timelines/prediction/features/real_graph/RealGraphDataRecordFeatures.scala
```

RealGraph predicts how likely a user is to interact with another user based on their history.

### Interaction Types Tracked

| Interaction | Feature Prefix | Weight Direction |
|-------------|----------------|------------------|
| Retweets | `NUM_RETWEETS_*` | Strong positive |
| Favorites | `NUM_FAVORITES_*` | Positive |
| Mentions | `NUM_MENTIONS_*` | Positive |
| Direct Messages | `NUM_DIRECT_MESSAGES_*` | Strong positive |
| Tweet Clicks | `NUM_TWEET_CLICKS_*` | Positive |
| Link Clicks | `NUM_LINK_CLICKS_*` | Positive |
| Profile Views | `NUM_PROFILE_VIEWS_*` | Positive |
| Dwell Time | `TOTAL_DWELL_TIME_*` | Positive |
| Photo Tags | `NUM_PHOTO_TAGS_*` | Strong positive |
| Follow | `NUM_FOLLOW_*` | Baseline |
| Mutual Follow | `NUM_MUTUAL_FOLLOW_*` | Strong positive |
| Blocks | `NUM_BLOCKS_*` | Strong negative |
| Mutes | `NUM_MUTES_*` | Strong negative |
| Reports | `NUM_REPORTS_AS_*` | Strong negative |

### Statistical Aggregations

For each interaction type, multiple stats are computed:

```scala
val NUM_FAVORITES_MEAN           // Average over time
val NUM_FAVORITES_EWMA           // Exponentially weighted moving average
val NUM_FAVORITES_VARIANCE       // Consistency
val NUM_FAVORITES_NON_ZERO_DAYS  // How many days with activity
val NUM_FAVORITES_ELAPSED_DAYS   // Total days tracked
val NUM_FAVORITES_DAYS_SINCE_LAST // Recency
val NUM_FAVORITES_IS_MISSING     // No data flag
```

---

## 7. Downranking Rules

```
File: visibilitylib/src/main/scala/com/twitter/visibility/rules/DownrankingRules.scala
```

### Toxicity Downranking

```scala
// High toxicity scores trigger downranking
object HighToxicityScoreDownrankAbusiveQualitySectionRule
object HighToxicityScoreDownrankLowQualitySectionRule
object HighToxicityScoreDownrankHighQualitySectionRule
```

### Spam Downranking

```scala
object DownrankSpamReplyConversationsTweetLabelRule
object DownrankSpamReplyConversationsAuthorLabelRule
object HighSpammyTweetContentScoreConvoDownrankAbusiveQualityRule
object HighCryptospamScoreConvoDownrankAbusiveQualityRule
object HighPSpammyTweetScoreDownrankLowQualitySectionRule
```

### New Account Penalty

```scala
object NotGraduatedConversationsAuthorLabelRule
// "NotGraduated" users get downranked in conversations
```

### Health Model Scores

```scala
// File: src/scala/com/twitter/timelines/prediction/features/common/TimelinesSharedFeatures.scala

val PBLOCK_SCORE           // Probability of being blocked
val TOXICITY_SCORE         // Toxicity model score
val PSPAMMY_TWEET_SCORE    // Spam probability
val PREPORTED_TWEET_SCORE  // Report probability
```

---

## 8. SimClusters (Topic Embeddings)

```
File: src/scala/com/twitter/simclusters_v2/README.md
```

Twitter builds **145,000 topic clusters** based on follow relationships.

### How It Works

1. Build producer-producer similarity from shared followers
2. Run community detection → ~145k clusters
3. Each user gets an "InterestedIn" embedding (what topics they like)
4. Each tweet gets an embedding based on who engaged with it
5. Match user interests to tweet topics for relevance scoring

### Topic Features

```scala
val TOPIC_SIM_SEARCHER_INTERSTED_IN_AUTHOR_KNOWN_FOR
val TOPIC_SIM_SEARCHER_AUTHOR_BOTH_INTERESTED_IN
val TOPIC_SIM_SEARCHER_AUTHOR_BOTH_KNOWN_FOR
val TOPIC_SIM_SEARCHER_INTERESTED_IN_TWEET
```

---

## 9. Dwell Time (Attention)

Dwell time is a key implicit signal:

```scala
// File: src/scala/com/twitter/timelines/prediction/features/recap/RecapFeatures.scala

val IS_DWELLED              // User paused on tweet
val IS_DWELLED_1S through IS_DWELLED_10S  // Duration buckets
val DWELL_NORMALIZED_OVERALL // Normalized dwell
val DWELL_CDF               // Percentile of dwell

// Tweet detail dwell
val IS_TWEET_DETAIL_DWELLED_8_SEC
val IS_TWEET_DETAIL_DWELLED_15_SEC
val IS_TWEET_DETAIL_DWELLED_25_SEC
val IS_TWEET_DETAIL_DWELLED_30_SEC

// Profile dwell (clicked profile, stayed)
val IS_PROFILE_DWELLED_10_SEC
val IS_PROFILE_DWELLED_20_SEC
val IS_PROFILE_DWELLED_30_SEC

// Video dwell
val IS_FULLSCREEN_VIDEO_DWELLED_5_SEC
val IS_FULLSCREEN_VIDEO_DWELLED_10_SEC
val IS_FULLSCREEN_VIDEO_DWELLED_20_SEC
val IS_FULLSCREEN_VIDEO_DWELLED_30_SEC
```

---

## 10. Practical Takeaways

### What BOOSTS Visibility

1. **Get engagement from high-reputation accounts** — Engagement from verified/high-Tweepcred users counts more
2. **Generate replies and quote tweets** — Highest-weight engagements
3. **Use native media** — Images/videos hosted on Twitter perform better
4. **Match your audience's language** — Language matching is a feature
5. **Build genuine relationships** — RealGraph rewards repeated interaction
6. **Post when your audience is active** — Engagement velocity matters
7. **Get saved/bookmarked** — Strong intent signal

### What HURTS Visibility

1. **High following, low followers** — Up to 50x reputation penalty
2. **Excessive hashtags** — Spam signal
3. **Excessive caps** — Quality penalty
4. **"Don't like" / "Not interested" feedback** — Direct downrank
5. **Getting muted/blocked** — Heavy RealGraph penalty
6. **Being reported** — Toxicity/spam model increases
7. **New account without verification** — "NotGraduated" penalty
8. **Links without engagement** — External links with no dwell = bad

### Neutral / Minimal Impact

- Tweet length (within reason)
- Emoji usage
- Post timing (beyond engagement velocity)
- Number of replies you make (unless blocked/muted)

---

## Source Files Referenced

| Category | Path |
|----------|------|
| Engagement Features | `src/scala/com/twitter/timelines/prediction/features/engagement_features/EngagementFeatures.scala` |
| Recap Features | `src/scala/com/twitter/timelines/prediction/features/recap/RecapFeatures.scala` |
| Time Features | `src/scala/com/twitter/timelines/prediction/features/time_features/TimeDataRecordFeatures.scala` |
| Shared Features | `src/scala/com/twitter/timelines/prediction/features/common/TimelinesSharedFeatures.scala` |
| RealGraph | `src/scala/com/twitter/timelines/prediction/features/real_graph/RealGraphDataRecordFeatures.scala` |
| Tweepcred | `src/scala/com/twitter/graph/batch/job/tweepcred/Reputation.scala` |
| User Mass | `src/scala/com/twitter/graph/batch/job/tweepcred/UserMass.scala` |
| Downranking | `visibilitylib/src/main/scala/com/twitter/visibility/rules/DownrankingRules.scala` |
| SimClusters | `src/scala/com/twitter/simclusters_v2/README.md` |
| Light Ranker | `src/python/twitter/deepbird/projects/timelines/scripts/models/earlybird/README.md` |
| Home Mixer | `home-mixer/README.md` |
| CR Mixer | `cr-mixer/README.md` |
| Signal Sources | `RETREIVAL_SIGNALS.md` |

---

*Analysis complete. The algorithm prioritizes engagement probability, author reputation, and user-author relationship strength above all else.*
