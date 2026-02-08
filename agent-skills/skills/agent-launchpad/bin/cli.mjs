#!/usr/bin/env node
/**
 * Agent Launchpad CLI
 * 
 * Usage:
 *   npx @0xaxiom/agent-launchpad launch --name "Scout" --symbol "SCOUT" --admin 0x...
 *   npx @0xaxiom/agent-launchpad serve --port 3000
 *   npx @0xaxiom/agent-launchpad status --token 0x...
 */

import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const scriptsDir = join(__dirname, '..', 'scripts');
const apiDir = join(__dirname, '..', 'api');

const command = process.argv[2];
const args = process.argv.slice(3);

const commands = {
  setup: () => run(join(__dirname, 'setup.mjs'), args),
  launch: () => run(join(scriptsDir, 'deploy-token.mjs'), args),
  deploy: () => run(join(scriptsDir, 'deploy-token.mjs'), args),
  serve: () => run(join(apiDir, 'server.mjs'), args),
  server: () => run(join(apiDir, 'server.mjs'), args),
  status: () => run(join(scriptsDir, 'claim-rewards.mjs'), ['--check-only', ...args]),
  claim: () => run(join(scriptsDir, 'claim-rewards.mjs'), args),
  'full-launch': () => run(join(scriptsDir, 'launch.mjs'), args),
  help: showHelp,
};

function run(script, args) {
  const child = spawn('node', [script, ...args], {
    stdio: 'inherit',
    env: process.env,
  });
  child.on('close', (code) => process.exit(code));
}

function showHelp() {
  console.log(`
🚀 Agent Launchpad — Take any AI agent onchain

Commands:
  setup     Interactive guided setup (recommended for first launch)
  launch    Deploy a token via Clanker API (free, no wallet needed)
  serve     Start the API server
  claim     Claim accumulated LP fees
  status    Check token status
  help      Show this help

Quick Start:
  npx @axiombot/agent-launchpad setup

  Or with flags:
  npx @axiombot/agent-launchpad launch \\
    --name "Scout" \\
    --symbol "SCOUT" \\
    --admin 0xYOUR_WALLET

  That's it. Token deploys on Base for free.
  You get 75% of all LP trading fees.

Environment:
  CLANKER_API_KEY    Clanker V4 API key (required for launch)

Docs: https://github.com/axiombot/axiom-public
`);
}

if (!command || command === '--help' || command === '-h') {
  showHelp();
} else if (commands[command]) {
  commands[command]();
} else {
  console.error(`Unknown command: ${command}`);
  console.error('Run with --help for usage');
  process.exit(1);
}
