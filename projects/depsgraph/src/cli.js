#!/usr/bin/env node

/**
 * depsgraph CLI
 * 
 * Usage:
 *   depsgraph <package>         Analyze and open web dashboard
 *   depsgraph <package> --json  Output JSON only
 *   depsgraph <package> --risk  Output risk report to terminal
 *   depsgraph --port <n>        Custom port
 */

const { Command } = require('commander');
const { resolveFromRegistry } = require('./resolver');
const { analyzeTree, generateRiskReport, getRiskColor } = require('./analyzer');
const { treeToGraph, formatBytes } = require('./graph');
const { startServer } = require('./server');

const program = new Command();

// ---- Terminal colors (no dependencies) ----
const c = {
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
  gray: '\x1b[90m',
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
};

function riskColor(level) {
  switch (level) {
    case 'low': return c.green;
    case 'medium': return c.yellow;
    case 'high': return `\x1b[38;5;208m`; // orange
    case 'critical': return c.red;
    default: return c.gray;
  }
}

function riskBadge(level, score) {
  const color = riskColor(level);
  return `${color}${c.bold}${score}${c.reset} ${color}${level}${c.reset}`;
}

function printBar(score, width = 20) {
  const filled = Math.round((score / 100) * width);
  const empty = width - filled;
  const color = score <= 25 ? c.green : score <= 50 ? c.yellow : score <= 75 ? `\x1b[38;5;208m` : c.red;
  return `${color}${'█'.repeat(filled)}${c.gray}${'░'.repeat(empty)}${c.reset}`;
}

function printHeader() {
  console.log(`
${c.bold}  ◈ depsgraph${c.reset} ${c.gray}— Dependency Topology Visualizer${c.reset}
`);
}

async function runAnalysis(packageName, options) {
  printHeader();

  const startTime = Date.now();
  let resolvedCount = 0;

  process.stdout.write(`${c.gray}  Resolving ${c.white}${packageName}${c.gray}…${c.reset}`);

  try {
    const tree = await resolveFromRegistry(packageName, {
      maxDepth: options.depth || 10,
      onProgress: (name, depth) => {
        resolvedCount++;
        if (resolvedCount % 10 === 0) {
          process.stdout.write(`\r${c.gray}  Resolving ${c.white}${packageName}${c.gray}… ${resolvedCount} packages${c.reset}`);
        }
      },
    });

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    process.stdout.write(`\r${c.green}  ✓${c.reset} Resolved ${c.white}${packageName}${c.reset} in ${elapsed}s\n\n`);

    // Analyze risks
    analyzeTree(tree);

    // Generate graph
    const graph = treeToGraph(tree);

    // Generate risk report
    const riskReport = generateRiskReport(tree);

    if (options.json) {
      // JSON output
      console.log(JSON.stringify({ graph, riskReport }, null, 2));
      return;
    }

    if (options.risk) {
      // Risk report
      printRiskReport(graph, riskReport);
      return;
    }

    // Default: print summary + open web dashboard
    printSummary(graph, riskReport);

    const port = options.port || 3847;
    const server = await startServer(port);

    // Open browser
    try {
      const open = (await import('open')).default;
      const url = `http://localhost:${port}?package=${encodeURIComponent(packageName)}`;
      console.log(`${c.gray}  Opening ${c.cyan}${url}${c.reset}\n`);
      await open(url);
    } catch {
      console.log(`${c.gray}  Open ${c.cyan}http://localhost:${port}${c.reset} in your browser\n`);
    }

    console.log(`${c.gray}  Press Ctrl+C to stop the server${c.reset}\n`);
  } catch (err) {
    console.error(`\n${c.red}  ✕ Error:${c.reset} ${err.message}\n`);
    process.exit(1);
  }
}

function printSummary(graph, riskReport) {
  const s = graph.stats;
  
  console.log(`${c.bold}  Summary${c.reset}`);
  console.log(`${c.gray}  ${'─'.repeat(44)}${c.reset}`);
  console.log(`  Packages      ${c.bold}${s.totalPackages}${c.reset}`);
  console.log(`  Total Size    ${c.bold}${s.totalSizeFormatted}${c.reset}`);
  console.log(`  Max Depth     ${c.bold}${s.maxDepth}${c.reset}`);
  console.log(`  Direct Deps   ${c.bold}${s.directDeps}${c.reset}`);
  console.log(`  Transitive    ${c.bold}${s.transitiveDeps}${c.reset}`);
  console.log(`  Avg Risk      ${riskBadge(riskReport.overallLevel, riskReport.averageRisk)}`);
  console.log();
  
  // Risk distribution
  const d = s.riskDistribution;
  console.log(`  ${c.green}● ${d.low} low${c.reset}  ${c.yellow}● ${d.medium} medium${c.reset}  ${`\x1b[38;5;208m`}● ${d.high} high${c.reset}  ${c.red}● ${d.critical} critical${c.reset}`);
  console.log();
}

function printRiskReport(graph, riskReport) {
  const s = graph.stats;
  
  // Summary
  console.log(`${c.bold}  Risk Report${c.reset}`);
  console.log(`${c.gray}  ${'─'.repeat(44)}${c.reset}`);
  console.log(`  Total Packages:  ${c.bold}${s.totalPackages}${c.reset}`);
  console.log(`  Average Risk:    ${riskBadge(riskReport.overallLevel, riskReport.averageRisk)}`);
  console.log();

  // Distribution
  const d = s.riskDistribution;
  console.log(`  ${c.green}● Low:     ${d.low}${c.reset}`);
  console.log(`  ${c.yellow}● Medium:  ${d.medium}${c.reset}`);
  console.log(`  ${`\x1b[38;5;208m`}● High:    ${d.high}${c.reset}`);
  console.log(`  ${c.red}● Critical: ${d.critical}${c.reset}`);
  console.log();

  // Top 10 riskiest
  if (riskReport.topRisks.length > 0) {
    console.log(`${c.bold}  Top Riskiest Packages${c.reset}`);
    console.log(`${c.gray}  ${'─'.repeat(44)}${c.reset}`);
    
    for (const pkg of riskReport.topRisks.slice(0, 10)) {
      const bar = printBar(pkg.riskScore);
      const nameStr = `${pkg.name}@${pkg.version}`.padEnd(30);
      console.log(`  ${riskColor(pkg.riskLevel)}${nameStr}${c.reset} ${bar} ${c.gray}${pkg.riskScore}${c.reset}`);
    }
    console.log();
  }

  // Deprecated packages
  if (riskReport.deprecated.length > 0) {
    console.log(`${c.red}${c.bold}  ⚠ Deprecated Packages${c.reset}`);
    console.log(`${c.gray}  ${'─'.repeat(44)}${c.reset}`);
    for (const pkg of riskReport.deprecated) {
      console.log(`  ${c.red}✕${c.reset} ${pkg.name}@${pkg.version} ${c.gray}(depth ${pkg.depth})${c.reset}`);
    }
    console.log();
  }
}

// ---- Program setup ----
program
  .name('depsgraph')
  .description('Dependency topology visualizer for npm packages')
  .version('1.0.0')
  .argument('[package]', 'npm package name to analyze')
  .option('--json', 'Output analysis as JSON')
  .option('--risk', 'Output risk report to terminal')
  .option('-p, --port <number>', 'Custom server port', parseInt)
  .option('-d, --depth <number>', 'Max resolution depth', parseInt)
  .action(async (packageName, options) => {
    if (!packageName) {
      // No package: just start the server with the dashboard
      printHeader();
      const port = options.port || 3847;
      await startServer(port);
      try {
        const open = (await import('open')).default;
        await open(`http://localhost:${port}`);
      } catch {}
      console.log(`${c.gray}  Press Ctrl+C to stop${c.reset}\n`);
      return;
    }

    await runAnalysis(packageName, options);
  });

program.parse(process.argv);
