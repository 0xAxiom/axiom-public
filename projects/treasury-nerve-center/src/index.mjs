#!/usr/bin/env node

/**
 * Treasury Nerve Center - CLI Entry Point
 * 
 * Usage: node src/index.mjs <address> [--chain <chain>] [--json] [--summary]
 */

import { aggregateTreasury } from './aggregator.mjs';
import { generateRecommendations } from './recommender.mjs';

// ANSI colors for terminal output
const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
};

/**
 * Parse CLI arguments
 */
function parseArgs(args) {
  const options = {
    address: null,
    chain: 'base',
    json: false,
    summary: false,
    help: false,
  };
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--chain' || arg === '-c') {
      options.chain = args[++i] || 'base';
    } else if (arg === '--json' || arg === '-j') {
      options.json = true;
    } else if (arg === '--summary' || arg === '-s') {
      options.summary = true;
    } else if (arg.startsWith('0x') && arg.length === 42) {
      options.address = arg;
    }
  }
  
  return options;
}

/**
 * Print help message
 */
function printHelp() {
  console.log(`
${colors.bold}Treasury Nerve Center${colors.reset}
One command to understand your entire treasury position.

${colors.bold}Usage:${colors.reset}
  node src/index.mjs <address> [options]

${colors.bold}Options:${colors.reset}
  --chain, -c <chain>   Chain to query (default: base)
  --json, -j            Output raw JSON
  --summary, -s         Output brief summary only
  --help, -h            Show this help message

${colors.bold}Examples:${colors.reset}
  node src/index.mjs 0x523Eff3dB03938eaa31a5a6FBd41E3B9d23edde5
  node src/index.mjs 0x523Eff3dB03938eaa31a5a6FBd41E3B9d23edde5 --chain base --json
  node src/index.mjs 0x523Eff3dB03938eaa31a5a6FBd41E3B9d23edde5 --summary
`);
}

/**
 * Format USD value
 */
function formatUsd(value) {
  if (value >= 1000000) {
    return `$${(value / 1000000).toFixed(2)}M`;
  } else if (value >= 1000) {
    return `$${(value / 1000).toFixed(2)}K`;
  } else if (value >= 1) {
    return `$${value.toFixed(2)}`;
  } else {
    return `$${value.toFixed(4)}`;
  }
}

/**
 * Get color for health status
 */
function healthColor(status) {
  switch (status) {
    case 'healthy': return colors.green;
    case 'warning': return colors.yellow;
    case 'critical': return colors.red;
    default: return colors.white;
  }
}

/**
 * Get color for risk level
 */
function riskColor(level) {
  switch (level) {
    case 'low': return colors.green;
    case 'medium': return colors.yellow;
    case 'high': return colors.red;
    case 'critical': return colors.red + colors.bold;
    default: return colors.white;
  }
}

/**
 * Get color for alert severity
 */
function alertColor(severity) {
  switch (severity) {
    case 'info': return colors.cyan;
    case 'warning': return colors.yellow;
    case 'critical': return colors.red;
    default: return colors.white;
  }
}

/**
 * Get color for urgency
 */
function urgencyColor(urgency) {
  switch (urgency) {
    case 'low': return colors.dim;
    case 'medium': return colors.yellow;
    case 'high': return colors.red;
    default: return colors.white;
  }
}

/**
 * Print formatted report
 */
function printReport(report, recommendations) {
  const { risk, actions, alerts, summary } = recommendations;
  
  console.log('');
  console.log(`${colors.bold}${colors.cyan}═══════════════════════════════════════════════════════════════${colors.reset}`);
  console.log(`${colors.bold}${colors.cyan}                    TREASURY NERVE CENTER                       ${colors.reset}`);
  console.log(`${colors.bold}${colors.cyan}═══════════════════════════════════════════════════════════════${colors.reset}`);
  console.log('');
  
  // Header
  console.log(`${colors.dim}Address:${colors.reset}  ${report.address}`);
  console.log(`${colors.dim}Chain:${colors.reset}    ${report.chain}`);
  console.log(`${colors.dim}Time:${colors.reset}     ${new Date(report.timestamp).toISOString()}`);
  console.log('');
  
  // Portfolio Summary
  console.log(`${colors.bold}📊 PORTFOLIO${colors.reset}`);
  console.log(`${colors.bold}${colors.white}   Total Value: ${formatUsd(report.portfolio.totalValueUsd)}${colors.reset}`);
  
  const change = report.portfolio.change24h;
  const changeColor = change >= 0 ? colors.green : colors.red;
  const changeSign = change >= 0 ? '+' : '';
  console.log(`   24h Change:  ${changeColor}${changeSign}${change.toFixed(2)}%${colors.reset}`);
  
  console.log(`${colors.dim}   ├── Tokens:       ${formatUsd(report.portfolio.breakdown.tokens)}${colors.reset}`);
  console.log(`${colors.dim}   ├── LP Positions: ${formatUsd(report.portfolio.breakdown.lpPositions)}${colors.reset}`);
  console.log(`${colors.dim}   └── Pending Fees: ${formatUsd(report.portfolio.breakdown.pendingFees)}${colors.reset}`);
  console.log('');
  
  // Risk Score
  console.log(`${colors.bold}⚠️  RISK ASSESSMENT${colors.reset}`);
  const riskBar = '█'.repeat(Math.floor(risk.score / 10)) + '░'.repeat(10 - Math.floor(risk.score / 10));
  console.log(`   Score: ${riskColor(risk.level)}${risk.score}/100${colors.reset} [${riskBar}] ${riskColor(risk.level)}${risk.level.toUpperCase()}${colors.reset}`);
  
  if (risk.factors.length > 0) {
    console.log(`${colors.dim}   Factors:${colors.reset}`);
    for (const factor of risk.factors.slice(0, 3)) {
      console.log(`${colors.dim}   └── ${factor.reason}${colors.reset}`);
    }
  }
  console.log('');
  
  // Positions
  console.log(`${colors.bold}💰 POSITIONS${colors.reset}`);
  
  // Token positions
  const tokens = report.positions.filter(p => p.type === 'token');
  if (tokens.length > 0) {
    console.log(`   ${colors.dim}Tokens:${colors.reset}`);
    for (const token of tokens.sort((a, b) => b.valueUsd - a.valueUsd)) {
      const pct = report.portfolio.totalValueUsd > 0 
        ? ((token.valueUsd / report.portfolio.totalValueUsd) * 100).toFixed(1)
        : '0';
      console.log(`   ${colors.cyan}${token.token.padEnd(8)}${colors.reset} ${token.balance.substring(0, 12).padStart(14)} ${colors.dim}@ ${formatUsd(token.price).padStart(10)}${colors.reset} = ${formatUsd(token.valueUsd).padStart(12)} ${colors.dim}(${pct}%)${colors.reset}`);
    }
  }
  
  // LP positions
  const lps = report.positions.filter(p => p.type === 'lp_v3');
  if (lps.length > 0) {
    console.log(`   ${colors.dim}LP Positions:${colors.reset}`);
    for (const lp of lps.sort((a, b) => b.valueUsd - a.valueUsd)) {
      const pairName = `${lp.tokens[0]?.symbol || '?'}/${lp.tokens[1]?.symbol || '?'}`;
      const healthStatus = healthColor(lp.health.status);
      const rangeStatus = lp.health.inRange ? `${colors.green}IN RANGE${colors.reset}` : `${colors.yellow}OUT${colors.reset}`;
      
      console.log(`   ${colors.magenta}#${lp.tokenId.padEnd(7)}${colors.reset} ${pairName.padEnd(12)} ${formatUsd(lp.valueUsd).padStart(12)} ${healthStatus}[${lp.health.status.toUpperCase()}]${colors.reset} ${rangeStatus}`);
      
      if (lp.pendingFees?.totalUsd > 0) {
        console.log(`   ${colors.dim}         └── Pending fees: ${formatUsd(lp.pendingFees.totalUsd)}${colors.reset}`);
      }
    }
  }
  
  if (tokens.length === 0 && lps.length === 0) {
    console.log(`   ${colors.dim}No positions found${colors.reset}`);
  }
  console.log('');
  
  // Alerts
  if (alerts.length > 0) {
    console.log(`${colors.bold}🚨 ALERTS${colors.reset}`);
    for (const alert of alerts) {
      const icon = alert.severity === 'critical' ? '🔴' : alert.severity === 'warning' ? '🟡' : '🔵';
      console.log(`   ${icon} ${alertColor(alert.severity)}${alert.message}${colors.reset}`);
    }
    console.log('');
  }
  
  // Gas
  console.log(`${colors.bold}⛽ GAS${colors.reset}`);
  const gasColor = report.gas.recommendation === 'act_now' ? colors.green : colors.yellow;
  console.log(`   Current: ${report.gas.current} gwei (${report.gas.percentile}th percentile)`);
  console.log(`   Status:  ${gasColor}${report.gas.recommendation.replace('_', ' ').toUpperCase()}${colors.reset}`);
  console.log(`   ${colors.dim}${report.gas.reason}${colors.reset}`);
  console.log('');
  
  // Suggested Actions
  if (actions.length > 0 && actions[0].action !== 'wait') {
    console.log(`${colors.bold}📋 SUGGESTED ACTIONS${colors.reset}`);
    for (const action of actions.slice(0, 5)) {
      if (action.action === 'wait' && actions.indexOf(action) > 0) continue;
      
      const urgencyIcon = action.urgency === 'high' ? '🔥' : action.urgency === 'medium' ? '⚡' : '📌';
      console.log(`   ${urgencyIcon} ${urgencyColor(action.urgency)}[${action.urgency.toUpperCase()}]${colors.reset} ${action.action.replace('_', ' ').toUpperCase()}`);
      console.log(`      ${colors.dim}${action.reason}${colors.reset}`);
      if (action.estimatedValue) {
        console.log(`      ${colors.dim}Value: ${formatUsd(action.estimatedValue)}${colors.reset}`);
      }
    }
    console.log('');
  }
  
  console.log(`${colors.bold}${colors.cyan}═══════════════════════════════════════════════════════════════${colors.reset}`);
  console.log('');
}

/**
 * Print summary only
 */
function printSummary(report, recommendations) {
  console.log(recommendations.summary);
}

/**
 * Main function
 */
async function main() {
  const args = process.argv.slice(2);
  const options = parseArgs(args);
  
  if (options.help || !options.address) {
    printHelp();
    process.exit(options.help ? 0 : 1);
  }
  
  try {
    // Fetch and aggregate data
    console.error(`${colors.dim}Fetching treasury data for ${options.address}...${colors.reset}`);
    
    const report = await aggregateTreasury(options.address, options.chain);
    const recommendations = generateRecommendations(report);
    
    // Add recommendations to report
    const fullReport = {
      ...report,
      recommendations,
    };
    
    // Output based on format option
    if (options.json) {
      console.log(JSON.stringify(fullReport, null, 2));
    } else if (options.summary) {
      printSummary(report, recommendations);
    } else {
      printReport(report, recommendations);
    }
    
  } catch (error) {
    console.error(`${colors.red}Error: ${error.message}${colors.reset}`);
    if (process.env.DEBUG) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

// Run main
main();
