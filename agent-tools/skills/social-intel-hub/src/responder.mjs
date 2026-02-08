#!/usr/bin/env node
// responder.mjs - Generate engagement response suggestions
// Takes scored opportunities and suggests what to say

import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const configDir = join(__dirname, '..', 'config');

function loadSkills() {
  const inventory = JSON.parse(readFileSync(join(configDir, 'skills-inventory.json'), 'utf-8'));
  return inventory.skills;
}

/**
 * Find the best matching skill for an opportunity
 */
function findMatchingSkill(opportunity, skills) {
  const text = (opportunity.title + ' ' + (opportunity.description || '')).toLowerCase();
  
  let bestSkill = null;
  let bestScore = 0;

  for (const skill of skills) {
    let matches = 0;
    for (const kw of skill.keywords) {
      if (text.includes(kw.toLowerCase())) matches++;
    }
    const score = matches / skill.keywords.length;
    if (score > bestScore) {
      bestScore = score;
      bestSkill = skill;
    }
  }

  return bestScore > 0.2 ? bestSkill : null;
}

/**
 * Determine engagement type based on context
 */
function getEngagementType(opportunity) {
  const url = opportunity.url || '';
  const text = (opportunity.title + ' ' + (opportunity.description || '')).toLowerCase();

  // Question or help-seeking
  if (text.includes('how to') || text.includes('help') || text.includes('issue') || text.includes('struggling')) {
    return 'help';
  }
  // Discussion or opinion
  if (text.includes('what do you think') || text.includes('opinion') || text.includes('debate')) {
    return 'discuss';
  }
  // Announcement or launch
  if (text.includes('launch') || text.includes('introducing') || text.includes('announcing') || text.includes('shipped')) {
    return 'congratulate';
  }
  // Technical deep-dive
  if (url.includes('github.com') || text.includes('implementation') || text.includes('architecture')) {
    return 'technical';
  }
  
  return 'share';
}

/**
 * Generate a response suggestion for an opportunity
 */
export function suggestResponse(opportunity) {
  const skills = loadSkills();
  const matchingSkill = findMatchingSkill(opportunity, skills);
  const engagementType = getEngagementType(opportunity);

  const suggestion = {
    url: opportunity.url,
    title: opportunity.title,
    score: opportunity.finalScore,
    engagementType,
    matchingSkill: matchingSkill?.name || null,
    repoLink: matchingSkill ? `github.com/0xAxiom/axiom-public/tree/main/${matchingSkill.repo_path}` : null,
    guidelines: []
  };

  // Add engagement-specific guidelines
  switch (engagementType) {
    case 'help':
      suggestion.guidelines = [
        'Lead with the solution, not self-promotion',
        'Share specific code or commands that solve their problem',
        matchingSkill ? `Reference ${matchingSkill.name}: ${matchingSkill.description}` : 'Share relevant experience',
        'Link to repo only if it directly solves their issue'
      ];
      break;
    case 'discuss':
      suggestion.guidelines = [
        'Share a specific opinion backed by experience',
        'Reference what you built and what you learned',
        'Avoid generic takes. Be specific.',
        matchingSkill ? `Draw from ${matchingSkill.name} experience` : 'Draw from building agent infra'
      ];
      break;
    case 'congratulate':
      suggestion.guidelines = [
        'Genuine congratulations first',
        'Ask a thoughtful question about their approach',
        'Only mention your work if directly related',
        'Keep it short'
      ];
      break;
    case 'technical':
      suggestion.guidelines = [
        'Lead with technical insight',
        'Reference specific implementation details',
        matchingSkill ? `Link to ${matchingSkill.repo_path} with explanation` : 'Share relevant code patterns',
        'Show your work, don\'t just link-drop'
      ];
      break;
    default:
      suggestion.guidelines = [
        'Share something genuinely useful',
        'Be specific about what you built and why',
        matchingSkill ? `Reference ${matchingSkill.name}` : 'Share relevant tools or insights',
        'Avoid link-dropping without context'
      ];
  }

  return suggestion;
}

/**
 * Generate response suggestions for all opportunities
 */
export function generateResponses(opportunities) {
  return opportunities.map(suggestResponse);
}

/**
 * Format response suggestions for Telegram
 */
export function formatResponses(responses) {
  if (responses.length === 0) return 'No engagement opportunities to respond to.';

  let output = '## 💬 Suggested Responses\n\n';

  for (let i = 0; i < responses.length; i++) {
    const r = responses[i];
    output += `### ${i + 1}. ${r.title}\n`;
    output += `🔗 ${r.url}\n`;
    output += `Type: **${r.engagementType}** | Score: ${r.score}\n`;
    if (r.matchingSkill) {
      output += `Skill match: **${r.matchingSkill}** → \`${r.repoLink}\`\n`;
    }
    output += `\n**Guidelines:**\n`;
    for (const g of r.guidelines) {
      output += `- ${g}\n`;
    }
    output += '\n---\n\n';
  }

  return output;
}
