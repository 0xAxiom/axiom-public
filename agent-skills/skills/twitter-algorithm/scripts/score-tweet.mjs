#!/usr/bin/env node
/**
 * Score a tweet against Twitter algorithm signals
 * Usage: node score-tweet.mjs "Your tweet text"
 * 
 * Returns JSON with score and recommendations
 */

function scoreTweet(text) {
  const result = {
    text,
    score: 0,
    maxScore: 10,
    checks: [],
    recommendations: [],
    verdict: ''
  };

  // Length check
  const len = text.length;
  if (len < 20) {
    result.checks.push({ name: 'length', status: 'fail', message: `Too short (${len} chars)` });
    result.recommendations.push('Add more substance');
  } else if (len < 100) {
    result.checks.push({ name: 'length', status: 'warn', message: `Short (${len} chars)` });
    result.score += 1;
  } else if (len <= 280) {
    result.checks.push({ name: 'length', status: 'pass', message: `Good length (${len} chars)` });
    result.score += 2;
  } else {
    result.checks.push({ name: 'length', status: 'warn', message: `Long (${len} chars) - will truncate` });
    result.score += 1;
  }

  // Hashtag check
  const hashtags = (text.match(/#/g) || []).length;
  if (hashtags === 0) {
    result.checks.push({ name: 'hashtags', status: 'pass', message: 'No hashtags (clean)' });
    result.score += 2;
  } else if (hashtags === 1) {
    result.checks.push({ name: 'hashtags', status: 'pass', message: 'Single hashtag (acceptable)' });
    result.score += 1;
  } else {
    result.checks.push({ name: 'hashtags', status: 'fail', message: `${hashtags} hashtags (SPAM SIGNAL)` });
    result.recommendations.push('Remove extra hashtags - 0-1 max');
  }

  // ALL CAPS check
  const capsWords = (text.match(/\b[A-Z]{4,}\b/g) || []).length;
  if (capsWords > 2) {
    result.checks.push({ name: 'caps', status: 'fail', message: `Excessive caps (${capsWords} words)` });
    result.recommendations.push('Reduce ALL CAPS words');
  } else {
    result.checks.push({ name: 'caps', status: 'pass', message: 'Normal capitalization' });
    result.score += 1;
  }

  // Link check
  const links = (text.match(/https?:\/\//g) || []).length;
  if (links === 0) {
    result.checks.push({ name: 'links', status: 'pass', message: 'No external links' });
    result.score += 1;
  } else if (links === 1) {
    result.checks.push({ name: 'links', status: 'warn', message: 'Contains link (neutral-negative)' });
  } else {
    result.checks.push({ name: 'links', status: 'fail', message: `${links} links - may hurt reach` });
    result.recommendations.push('Reduce to 1 link maximum');
  }

  // Question check
  if (text.includes('?')) {
    result.checks.push({ name: 'question', status: 'pass', message: 'Contains question (drives replies)' });
    result.score += 1;
  }

  // Engagement bait detection
  const baitPatterns = /like if|retweet if|share if|follow for|rt to|like to|comment if/i;
  if (baitPatterns.test(text)) {
    result.checks.push({ name: 'bait', status: 'fail', message: 'ENGAGEMENT BAIT DETECTED' });
    result.recommendations.push('Remove engagement bait - algorithm penalizes this');
    result.score -= 2;
  } else {
    result.checks.push({ name: 'bait', status: 'pass', message: 'No engagement bait' });
    result.score += 1;
  }

  // First line hook
  const firstLine = text.split('\n')[0];
  if (firstLine.length > 10 && firstLine.length < 80) {
    result.checks.push({ name: 'hook', status: 'pass', message: `Good first line hook (${firstLine.length} chars)` });
    result.score += 1;
  }

  // Media suggestion
  result.checks.push({ name: 'media', status: 'info', message: 'Consider adding native image (+15-20% reach)' });
  result.recommendations.push('Add native image/video for algorithm boost');

  // Cap score
  result.score = Math.max(0, Math.min(result.maxScore, result.score));

  // Verdict
  if (result.score >= 8) {
    result.verdict = 'GOOD_TO_POST';
  } else if (result.score >= 5) {
    result.verdict = 'ACCEPTABLE';
  } else {
    result.verdict = 'REVISE';
  }

  return result;
}

// CLI
if (process.argv[1].endsWith('score-tweet.mjs')) {
  const text = process.argv.slice(2).join(' ');
  if (!text) {
    console.log('Usage: node score-tweet.mjs "Your tweet text"');
    process.exit(1);
  }
  
  const result = scoreTweet(text);
  
  console.log(`\n═══════════════════════════════════════════`);
  console.log(`  TWEET SCORE: ${result.score}/${result.maxScore}`);
  console.log(`═══════════════════════════════════════════\n`);
  
  console.log('📝 Checks:');
  for (const check of result.checks) {
    const icon = check.status === 'pass' ? '✅' : check.status === 'fail' ? '❌' : check.status === 'warn' ? '⚠️' : 'ℹ️';
    console.log(`  ${icon} ${check.message}`);
  }
  
  if (result.recommendations.length > 0) {
    console.log('\n💡 Recommendations:');
    for (const rec of result.recommendations) {
      console.log(`  - ${rec}`);
    }
  }
  
  console.log(`\n${result.verdict === 'GOOD_TO_POST' ? '✅' : result.verdict === 'ACCEPTABLE' ? '⚠️' : '❌'} ${result.verdict}`);
  console.log('\nRemember: Post when you can engage for 1-2 hours after!');
}

export { scoreTweet };
export default scoreTweet;
