#!/bin/bash
# Score a tweet draft against Twitter algorithm signals
# Usage: ./score-tweet.sh "Your tweet text"

TEXT="$1"

if [ -z "$TEXT" ]; then
    echo "Usage: ./score-tweet.sh \"Your tweet text\""
    exit 1
fi

# Scoring
SCORE=0
MAX_SCORE=10
ISSUES=""
RECOMMENDATIONS=""

# Length check (optimal: 100-280 chars)
LEN=${#TEXT}
if [ $LEN -lt 20 ]; then
    ISSUES="$ISSUES\n  ❌ Too short ($LEN chars) - add substance"
elif [ $LEN -lt 100 ]; then
    ISSUES="$ISSUES\n  ⚠️ Short ($LEN chars) - could expand"
    SCORE=$((SCORE + 1))
elif [ $LEN -le 280 ]; then
    ISSUES="$ISSUES\n  ✅ Good length ($LEN chars)"
    SCORE=$((SCORE + 2))
else
    ISSUES="$ISSUES\n  ⚠️ Long ($LEN chars) - will be truncated"
    SCORE=$((SCORE + 1))
fi

# Hashtag check (optimal: 0-1)
HASHTAG_COUNT=$(echo "$TEXT" | grep -o '#' | wc -l | tr -d ' ')
if [ "$HASHTAG_COUNT" -eq 0 ]; then
    ISSUES="$ISSUES\n  ✅ No hashtags (clean)"
    SCORE=$((SCORE + 2))
elif [ "$HASHTAG_COUNT" -eq 1 ]; then
    ISSUES="$ISSUES\n  ✅ Single hashtag (acceptable)"
    SCORE=$((SCORE + 1))
else
    ISSUES="$ISSUES\n  ❌ $HASHTAG_COUNT hashtags (SPAM SIGNAL - remove extras)"
    RECOMMENDATIONS="$RECOMMENDATIONS\n- Remove hashtags to avoid spam detection"
fi

# ALL CAPS check
CAPS_WORDS=$(echo "$TEXT" | grep -oE '\b[A-Z]{4,}\b' | wc -l | tr -d ' ')
if [ "$CAPS_WORDS" -gt 2 ]; then
    ISSUES="$ISSUES\n  ❌ Excessive caps ($CAPS_WORDS words) - quality penalty"
    RECOMMENDATIONS="$RECOMMENDATIONS\n- Reduce ALL CAPS words"
else
    ISSUES="$ISSUES\n  ✅ Normal capitalization"
    SCORE=$((SCORE + 1))
fi

# Link check
LINK_COUNT=$(echo "$TEXT" | grep -oE 'https?://' | wc -l | tr -d ' ')
if [ "$LINK_COUNT" -eq 0 ]; then
    ISSUES="$ISSUES\n  ✅ No external links"
    SCORE=$((SCORE + 1))
elif [ "$LINK_COUNT" -eq 1 ]; then
    ISSUES="$ISSUES\n  ⚠️ Contains link (neutral-negative unless high dwell)"
else
    ISSUES="$ISSUES\n  ❌ Multiple links ($LINK_COUNT) - may hurt reach"
    RECOMMENDATIONS="$RECOMMENDATIONS\n- Reduce to 1 link maximum"
fi

# Question check (questions drive replies)
if echo "$TEXT" | grep -q '?'; then
    ISSUES="$ISSUES\n  ✅ Contains question (drives replies)"
    SCORE=$((SCORE + 1))
fi

# Engagement bait detection
BAIT_PATTERNS="like if|retweet if|share if|follow for|rt to|like to|comment if"
if echo "$TEXT" | grep -iE "$BAIT_PATTERNS" > /dev/null; then
    ISSUES="$ISSUES\n  ❌ ENGAGEMENT BAIT DETECTED - algorithm penalizes this"
    RECOMMENDATIONS="$RECOMMENDATIONS\n- Remove engagement bait phrases"
    SCORE=$((SCORE - 2))
else
    SCORE=$((SCORE + 1))
fi

# First line hook check (for truncated previews)
FIRST_LINE=$(echo "$TEXT" | head -1)
FIRST_LEN=${#FIRST_LINE}
if [ $FIRST_LEN -lt 80 ] && [ $FIRST_LEN -gt 10 ]; then
    ISSUES="$ISSUES\n  ✅ First line works as hook ($FIRST_LEN chars)"
    SCORE=$((SCORE + 1))
fi

# Timing check
HOUR=$(date +%H)
DOW=$(date +%u)  # 1=Monday, 7=Sunday
TIMING_NOTE=""

if [ $DOW -le 5 ]; then
    TIMING_NOTE="Weekday ✅"
    SCORE=$((SCORE + 1))
else
    TIMING_NOTE="Weekend (lower engagement)"
fi

if [ $HOUR -ge 8 ] && [ $HOUR -lt 10 ]; then
    TIMING_NOTE="$TIMING_NOTE | Morning window ✅"
elif [ $HOUR -ge 12 ] && [ $HOUR -lt 14 ]; then
    TIMING_NOTE="$TIMING_NOTE | Lunch window ✅"
elif [ $HOUR -ge 18 ] && [ $HOUR -lt 20 ]; then
    TIMING_NOTE="$TIMING_NOTE | Evening window ✅"
else
    TIMING_NOTE="$TIMING_NOTE | Off-peak hour"
    RECOMMENDATIONS="$RECOMMENDATIONS\n- Consider posting during 8-10am, 12-2pm, or 6-8pm PT"
fi

# Cap score
if [ $SCORE -gt $MAX_SCORE ]; then
    SCORE=$MAX_SCORE
fi
if [ $SCORE -lt 0 ]; then
    SCORE=0
fi

# Output
echo "═══════════════════════════════════════════"
echo "  TWEET SCORE: $SCORE/$MAX_SCORE"
echo "═══════════════════════════════════════════"
echo ""
echo "📝 Content Analysis:"
echo -e "$ISSUES"
echo ""
echo "⏰ Timing: $TIMING_NOTE"
echo ""

if [ -n "$RECOMMENDATIONS" ]; then
    echo "💡 Recommendations:"
    echo -e "$RECOMMENDATIONS"
    echo ""
fi

# Verdict
if [ $SCORE -ge 8 ]; then
    echo "✅ GOOD TO POST - High algorithm compatibility"
elif [ $SCORE -ge 5 ]; then
    echo "⚠️ ACCEPTABLE - Consider improvements above"
else
    echo "❌ REVISE - Address issues before posting"
fi

echo ""
echo "Remember: Post when you can engage for 1-2 hours after!"
