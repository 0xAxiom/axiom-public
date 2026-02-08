#!/usr/bin/env node
// scanner.mjs - Process search results through scoring engine
// Input: JSON array of search results from stdin
// Output: Scored and ranked engagement opportunities

import { scoreResult, filterByScore } from './scorer.mjs';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const configDir = join(__dirname, '..', 'config');

function loadConfig() {
  const keywords = JSON.parse(readFileSync(join(configDir, 'keywords.json'), 'utf-8'));
  const inventory = JSON.parse(readFileSync(join(configDir, 'skills-inventory.json'), 'utf-8'));
  return { keywords, skills: inventory.skills };
}

function dedupeByUrl(results) {
  const seen = new Set();
  return results.filter(r => {
    if (seen.has(r.url)) return false;
    seen.add(r.url);
    return true;
  });
}

function isExcluded(result, excludeTerms) {
  const text = (result.title + ' ' + result.description).toLowerCase();
  return excludeTerms.some(term => text.includes(term.toLowerCase()));
}

/**
 * Score a batch of search results
 * @param {Array} searchResults - Array of {keyword, results: [{title, url, description, published, domain}]}
 * @param {Object} options - {minScore, maxResults}
 * @returns {Array} Ranked opportunities
 */
export function scanResults(searchResults, options = {}) {
  const { minScore = 4, maxResults = 10 } = options;
  const { keywords, skills } = loadConfig();
  
  const keywordMap = new Map(keywords.keywords.map(k => [k.term, k]));
  const excludeTerms = keywords.exclude || [];
  
  let allScored = [];

  for (const batch of searchResults) {
    const kwConfig = keywordMap.get(batch.keyword) || { weight: 1.0 };
    
    for (const result of batch.results) {
      if (isExcluded(result, excludeTerms)) continue;
      
      const scored = scoreResult(result, batch.keyword, kwConfig.weight, skills);
      allScored.push(scored);
    }
  }

  // Dedupe and sort
  allScored = dedupeByUrl(allScored);
  allScored.sort((a, b) => b.finalScore - a.finalScore);

  // Filter by minimum score
  const filtered = filterByScore(allScored, minScore);
  
  return filtered.slice(0, maxResults);
}

/**
 * Format opportunities for display
 */
export function formatOpportunities(opportunities) {
  if (opportunities.length === 0) {
    return 'No high-value engagement opportunities found this scan.';
  }

  let output = `## 🔬 Social Intel Scan Results\n\n`;
  output += `Found **${opportunities.length}** opportunities above threshold.\n\n`;

  for (let i = 0; i < opportunities.length; i++) {
    const opp = opportunities[i];
    const emoji = opp.finalScore >= 8 ? '🔥' : opp.finalScore >= 6 ? '⚡' : '📌';
    
    output += `### ${emoji} #${i + 1} — Score: ${opp.finalScore}/10\n`;
    output += `**${opp.title}**\n`;
    output += `${opp.url}\n`;
    output += `> ${opp.description?.slice(0, 200) || 'No description'}\n\n`;
    output += `Keyword: \`${opp.keyword}\` | `;
    output += `Relevance: ${opp.scores.relevance.toFixed(1)} | `;
    output += `Fresh: ${opp.scores.freshness} | `;
    output += `Authority: ${opp.scores.authority} | `;
    output += `Context: ${opp.scores.contextFit.toFixed(1)}\n\n`;
  }

  return output;
}

// CLI mode: read JSON from stdin
if (process.argv[1] && process.argv[1].includes('scanner.mjs')) {
  let input = '';
  process.stdin.setEncoding('utf-8');
  process.stdin.on('data', chunk => input += chunk);
  process.stdin.on('end', () => {
    try {
      const searchResults = JSON.parse(input);
      const minScore = parseFloat(process.argv[2] || '4');
      const maxResults = parseInt(process.argv[3] || '10');
      const opportunities = scanResults(searchResults, { minScore, maxResults });
      
      if (process.argv.includes('--json')) {
        console.log(JSON.stringify(opportunities, null, 2));
      } else {
        console.log(formatOpportunities(opportunities));
      }
    } catch (err) {
      console.error('Error:', err.message);
      process.exit(1);
    }
  });
}
