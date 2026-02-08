// scorer.mjs - Scoring engine for engagement opportunities

/**
 * Score a search result based on relevance, freshness, authority, and context fit
 * @param {Object} result - Search result with title, url, description, published date, domain
 * @param {string} keyword - The keyword that found this result
 * @param {number} keywordWeight - Weight multiplier for this keyword
 * @param {Array} skills - Skills inventory for context matching
 * @returns {Object} Scored result with breakdown
 */
export function scoreResult(result, keyword, keywordWeight, skills) {
  const scores = {
    relevance: scoreRelevance(result, keyword),
    freshness: scoreFreshness(result.published),
    authority: scoreAuthority(result.domain, result.url),
    contextFit: scoreContextFit(result, skills)
  };

  const rawScore = scores.relevance + scores.freshness + scores.authority + scores.contextFit;
  const weightedScore = rawScore * keywordWeight;

  return {
    ...result,
    keyword,
    keywordWeight,
    scores,
    rawScore,
    finalScore: Math.round(weightedScore * 10) / 10
  };
}

/**
 * Score relevance to our domain (0-3)
 * DeFi agents, onchain tools, AI automation
 */
function scoreRelevance(result, keyword) {
  const text = (result.title + ' ' + result.description).toLowerCase();
  
  // High relevance indicators
  const highRelevance = [
    'defi', 'uniswap', 'liquidity', 'agent', 'automation', 'onchain', 'web3',
    'ethereum', 'smart contract', 'dapp', 'yield farming', 'LP', 'MEV'
  ];
  
  // Medium relevance indicators  
  const medRelevance = [
    'blockchain', 'crypto', 'trading', 'protocol', 'token', 'wallet',
    'bot', 'AI', 'machine learning', 'cron', 'monitoring'
  ];

  let score = 0;
  
  // Check for high relevance terms
  for (const term of highRelevance) {
    if (text.includes(term)) {
      score += 0.5;
      if (score >= 3) return 3;
    }
  }

  // Check for medium relevance terms
  for (const term of medRelevance) {
    if (text.includes(term)) {
      score += 0.3;
      if (score >= 3) return 3;
    }
  }

  // Keyword match gives base relevance
  if (text.includes(keyword.toLowerCase())) {
    score += 1;
  }

  return Math.min(score, 3);
}

/**
 * Score freshness (0-2)
 * Last 24h = 2, last week = 1, older = 0
 */
function scoreFreshness(publishedDate) {
  if (!publishedDate) return 0;

  const now = Date.now();
  const published = new Date(publishedDate).getTime();
  const ageMs = now - published;
  
  const day = 24 * 60 * 60 * 1000;
  const week = 7 * day;

  if (ageMs < day) return 2;
  if (ageMs < week) return 1;
  return 0;
}

/**
 * Score authority (0-2)
 * GitHub stars > 100, Twitter followers > 1K, Reddit karma > 10K = 2
 */
function scoreAuthority(domain, url) {
  // High authority domains
  const highAuthority = [
    'github.com', 'medium.com', 'dev.to', 'hackernoon.com',
    'ethereum.org', 'uniswap.org', 'compound.finance'
  ];

  // Medium authority domains
  const medAuthority = [
    'reddit.com', 'twitter.com', 'x.com', 'substack.com',
    'mirror.xyz', 'farcaster.xyz'
  ];

  if (highAuthority.includes(domain)) return 2;
  if (medAuthority.includes(domain)) return 1;

  // For GitHub specifically, could check stars if we had API access
  if (domain === 'github.com' && url.includes('/')) return 1.5;

  return 0.5; // Default for unknown domains
}

/**
 * Score context fit (0-3)
 * Do we have a specific skill that addresses what they're discussing?
 */
function scoreContextFit(result, skills) {
  const text = (result.title + ' ' + result.description).toLowerCase();
  
  let bestMatch = 0;
  
  for (const skill of skills) {
    let skillScore = 0;
    
    for (const keyword of skill.keywords) {
      if (text.includes(keyword.toLowerCase())) {
        skillScore += 1;
      }
    }
    
    // Normalize by keyword count and cap at 3
    const normalizedScore = Math.min((skillScore / skill.keywords.length) * 3, 3);
    bestMatch = Math.max(bestMatch, normalizedScore);
  }

  return bestMatch;
}

/**
 * Filter results by minimum score threshold
 */
export function filterByScore(scoredResults, minScore = 5) {
  return scoredResults.filter(result => result.finalScore >= minScore);
}