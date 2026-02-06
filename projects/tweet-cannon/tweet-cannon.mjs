#!/usr/bin/env node
/**
 * Tweet Cannon 🎯
 * Converts system descriptions into ASCII architecture diagrams for tweets
 * 
 * Usage: node tweet-cannon.mjs "Your system description"
 */

import { execSync } from 'child_process';
import { writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCORE_SCRIPT = join(process.env.HOME, 'Github/axiom-public/agent-tools/skills/twitter-algorithm/scripts/score-tweet.sh');

// === PlantUML Generation ===

function systemDescriptionToPlantUML(description) {
  // Parse the description to extract components and relationships
  const components = new Set();
  const relationships = [];
  
  // Common patterns to detect
  const patterns = {
    orchestrates: /(\w+)\s+orchestrates?\s+(.+?)(?:\.|who|that|which|$)/gi,
    connects: /(\w+)\s+connects?\s+to\s+(.+?)(?:\.|$)/gi,
    sends: /(\w+)\s+sends?\s+(?:to\s+)?(.+?)(?:\.|$)/gi,
    goesTo: /(?:results?|data|output)\s+(?:goes?|flows?)\s+to\s+(.+?)(?:\.|$)/gi,
    subAgents: /sub-?agents?\s*\(([^)]+)\)/gi,
    parenthetical: /\(([^)]+)\)/g,
    actions: /(\w+)\s+(?:who\s+)?(\w+(?:es|s)?)\b/gi,
  };

  // Extract orchestration relationships
  let match;
  const orchestrateMatches = description.matchAll(patterns.orchestrates);
  for (const m of orchestrateMatches) {
    const parent = m[1].trim();
    components.add(parent);
    
    // Check for sub-agents in parentheses first
    const subAgentMatch = m[2].match(/sub-?agents?\s*\(([^)]+)\)/i);
    if (subAgentMatch) {
      const agents = subAgentMatch[1].split(/,|\s+and\s+/).map(a => a.trim()).filter(a => a);
      agents.forEach(agent => {
        components.add(agent);
        relationships.push({ from: parent, to: agent });
      });
    } else {
      // Parse the targets (could be comma or "and" separated)
      const targets = m[2].split(/,|\s+and\s+/).map(t => {
        // Extract just the name, removing parentheticals and punctuation
        return t.trim().replace(/\([^)]*\)/g, '').replace(/[^a-zA-Z]/g, '').trim();
      }).filter(t => t && t.length > 1);
      
      targets.forEach(target => {
        if (target.match(/^[A-Z]/)) {
          components.add(target);
          relationships.push({ from: parent, to: target });
        }
      });
    }
  }

  // Extract sub-agents from parentheticals (standalone)
  const subAgentMatches = description.matchAll(patterns.subAgents);
  for (const m of subAgentMatches) {
    const agents = m[1].split(/,|\s+and\s+/).map(a => a.trim()).filter(a => a);
    agents.forEach(agent => components.add(agent));
  }

  // Extract "results go to X and Y"
  const resultsMatch = description.match(/results?\s+(?:go|flow)s?\s+to\s+([^.]+)/i);
  if (resultsMatch) {
    const destinations = resultsMatch[1].split(/,|\s+and\s+/).map(d => d.trim().replace(/\.$/, '')).filter(d => d);
    // Find the main orchestrator
    const mainComponent = Array.from(components)[0] || 'System';
    destinations.forEach(dest => {
      if (dest.match(/^[A-Z]/)) {
        components.add(dest);
        relationships.push({ from: mainComponent, to: dest });
      }
    });
  }

  // Extract action relationships (Scout -> Research, Builder -> Code, etc.)
  const actionMap = {
    'research': 'Research',
    'build': 'Code',
    'audit': 'Audit',
    'analyze': 'Analysis',
    'monitor': 'Monitoring',
    'deploy': 'Deploy',
    'test': 'Testing',
  };

  // Escape special regex characters
  const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  
  // Map actions to components based on explicit mentions in description
  // E.g., "Scout who researches" or "Builder builds"
  const actionPatterns = [
    { pattern: /Scout[^.]*research/i, from: 'Scout', to: 'Research' },
    { pattern: /Builder[^.]*build/i, from: 'Builder', to: 'Code' },
    { pattern: /Analyst[^.]*audit/i, from: 'Analyst', to: 'Audit' },
    { pattern: /Analyst[^.]*analyz/i, from: 'Analyst', to: 'Analysis' },
  ];

  // Only add action relationships if there's clear context
  for (const ap of actionPatterns) {
    if (description.match(ap.pattern)) {
      if (components.has(ap.from)) {
        components.add(ap.to);
        relationships.push({ from: ap.from, to: ap.to });
      }
    }
  }
  
  // Also check for "who X, Y, and Z" patterns after agent list
  // E.g., "(Scout, Builder, Analyst) who research, build, and audit"
  const parentheticalWhoPattern = /\(([^)]+)\)\s*who\s+([^.]+)/i;
  const pwMatch = description.match(parentheticalWhoPattern);
  if (pwMatch) {
    const agents = pwMatch[1].split(/,|\s+and\s+/).map(a => a.trim()).filter(a => a);
    const actions = pwMatch[2].split(/,|\s+and\s+/).map(a => a.trim().toLowerCase()).filter(a => a);
    
    // Track what we've already added
    const addedRels = new Set(relationships.map(r => `${r.from}->${r.to}`));
    
    // Pair agents with actions
    agents.forEach((agent, idx) => {
      if (actions[idx]) {
        const actionTarget = actionMap[actions[idx]];
        if (actionTarget && components.has(agent)) {
          const relKey = `${agent}->${actionTarget}`;
          if (!addedRels.has(relKey)) {
            components.add(actionTarget);
            relationships.push({ from: agent, to: actionTarget });
            addedRels.add(relKey);
          }
        }
      }
    });
  }

  // Build PlantUML
  let plantuml = '@startuml\n';
  plantuml += 'skinparam monochrome true\n';
  plantuml += 'skinparam defaultFontName monospace\n\n';
  
  // Add relationships (also adds components implicitly)
  const seenRelationships = new Set();
  for (const rel of relationships) {
    const key = `${rel.from}->${rel.to}`;
    if (!seenRelationships.has(key)) {
      plantuml += `[${rel.from}] --> [${rel.to}]\n`;
      seenRelationships.add(key);
    }
  }
  
  plantuml += '@enduml';
  
  return plantuml;
}

// === Kroki API ===

async function getAsciiDiagram(plantuml) {
  // Kroki accepts PlantUML and returns ASCII text
  const response = await fetch('https://kroki.io/plantuml/txt', {
    method: 'POST',
    headers: {
      'Content-Type': 'text/plain',
    },
    body: plantuml,
  });

  if (!response.ok) {
    throw new Error(`Kroki API error: ${response.status} ${response.statusText}`);
  }

  return await response.text();
}

// === Tweet Formatting ===

function formatTweet(description, asciiDiagram) {
  // Create a concise caption
  const caption = generateCaption(description);
  
  // Trim the ASCII diagram for tweet formatting
  const trimmedDiagram = asciiDiagram
    .split('\n')
    .map(line => line.trimEnd())
    .filter(line => line) // Remove empty lines
    .join('\n');

  // Format the final tweet
  const tweet = `${caption}

\`\`\`
${trimmedDiagram}
\`\`\``;

  return tweet;
}

function generateCaption(description) {
  // Extract the main subject and create a punchy caption
  const words = description.split(/\s+/);
  const mainSubject = words.find(w => w.match(/^[A-Z][a-z]+$/)) || 'System';
  
  const captions = [
    `How ${mainSubject} works 👇`,
    `${mainSubject} architecture, visualized:`,
    `Inside ${mainSubject}:`,
    `The ${mainSubject} system:`,
  ];
  
  return captions[Math.floor(Math.random() * captions.length)];
}

// === Scoring ===

function scoreTweet(tweet) {
  if (!existsSync(SCORE_SCRIPT)) {
    console.log('\n⚠️  Score script not found, skipping scoring');
    return;
  }

  try {
    // Escape the tweet for shell
    const escapedTweet = tweet.replace(/'/g, "'\\''");
    const result = execSync(`bash '${SCORE_SCRIPT}' '${escapedTweet}'`, {
      encoding: 'utf-8',
      maxBuffer: 1024 * 1024,
    });
    console.log('\n' + result);
  } catch (error) {
    console.error('Scoring failed:', error.message);
  }
}

// === Main ===

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    console.log(`
🎯 Tweet Cannon - Architecture Diagrams for Twitter

Usage:
  node tweet-cannon.mjs "Your system description"

Example:
  node tweet-cannon.mjs "Axiom orchestrates sub-agents (Scout, Builder, Analyst) who research, build, and audit. Results go to Twitter and Moltbook."

Options:
  --plantuml-only    Output just the PlantUML code
  --ascii-only       Output just the ASCII diagram
  --no-score         Skip tweet scoring
  --help, -h         Show this help
`);
    process.exit(0);
  }

  const plantumlOnly = args.includes('--plantuml-only');
  const asciiOnly = args.includes('--ascii-only');
  const noScore = args.includes('--no-score');
  
  // Get the description (first non-flag argument)
  const description = args.find(arg => !arg.startsWith('--'));
  
  if (!description) {
    console.error('Error: Please provide a system description');
    process.exit(1);
  }

  console.log('🎯 Tweet Cannon\n');
  console.log('📝 Input:', description);
  console.log('');

  // Step 1: Generate PlantUML
  const plantuml = systemDescriptionToPlantUML(description);
  
  if (plantumlOnly) {
    console.log(plantuml);
    process.exit(0);
  }

  console.log('📊 Generated PlantUML:');
  console.log('─'.repeat(40));
  console.log(plantuml);
  console.log('─'.repeat(40));
  console.log('');

  // Step 2: Get ASCII diagram from Kroki
  console.log('🌐 Fetching ASCII diagram from Kroki...');
  let asciiDiagram;
  try {
    asciiDiagram = await getAsciiDiagram(plantuml);
  } catch (error) {
    console.error('Error getting ASCII diagram:', error.message);
    process.exit(1);
  }

  if (asciiOnly) {
    console.log(asciiDiagram);
    process.exit(0);
  }

  console.log('');
  console.log('🖼️  ASCII Diagram:');
  console.log('─'.repeat(40));
  console.log(asciiDiagram);
  console.log('─'.repeat(40));
  console.log('');

  // Step 3: Format as tweet
  const tweet = formatTweet(description, asciiDiagram);
  
  console.log('🐦 Tweet-Ready Output:');
  console.log('═'.repeat(40));
  console.log(tweet);
  console.log('═'.repeat(40));

  // Step 4: Score the tweet
  if (!noScore) {
    scoreTweet(tweet);
  }

  // Save outputs
  const outputDir = __dirname;
  writeFileSync(join(outputDir, 'last-plantuml.txt'), plantuml);
  writeFileSync(join(outputDir, 'last-ascii.txt'), asciiDiagram);
  writeFileSync(join(outputDir, 'last-tweet.txt'), tweet);
  console.log('\n💾 Saved to: last-plantuml.txt, last-ascii.txt, last-tweet.txt');
}

main().catch(console.error);
