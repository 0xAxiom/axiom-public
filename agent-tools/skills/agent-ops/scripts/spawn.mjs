#!/usr/bin/env node

/**
 * Agent Ops - Sub-Agent Spawning Helper
 * 
 * Usage:
 *   node spawn.mjs <agent-name> "<task-description>" [options]
 * 
 * Examples:
 *   node spawn.mjs scout "Research Uniswap V4 hooks"
 *   node spawn.mjs builder "Create Discord price bot"
 *   node spawn.mjs watcher "Check LP position health"
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workspaceDir = process.cwd();

// ANSI colors for output
const colors = {
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  red: '\x1b[31m',
  reset: '\x1b[0m',
  bold: '\x1b[1m'
};

function log(color, message) {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function loadRegistry() {
  const registryPath = path.join(workspaceDir, 'agents', 'registry.json');
  
  if (!fs.existsSync(registryPath)) {
    log('red', '❌ agents/registry.json not found. Run agent-ops init first.');
    process.exit(1);
  }
  
  try {
    return JSON.parse(fs.readFileSync(registryPath, 'utf8'));
  } catch (error) {
    log('red', `❌ Error reading registry: ${error.message}`);
    process.exit(1);
  }
}

function loadState() {
  const statePath = path.join(workspaceDir, 'agents', 'state.json');
  
  if (!fs.existsSync(statePath)) {
    log('red', '❌ agents/state.json not found. Run agent-ops init first.');
    process.exit(1);
  }
  
  try {
    return JSON.parse(fs.readFileSync(statePath, 'utf8'));
  } catch (error) {
    log('red', `❌ Error reading state: ${error.message}`);
    process.exit(1);
  }
}

function updateState(state) {
  const statePath = path.join(workspaceDir, 'agents', 'state.json');
  
  try {
    state.meta.updatedAt = new Date().toISOString();
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
  } catch (error) {
    log('red', `❌ Error writing state: ${error.message}`);
    process.exit(1);
  }
}

function generateTaskId(description) {
  return description
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .slice(0, 3)
    .join('-');
}

function buildSpawnCommand(agent, task) {
  const registry = loadRegistry();
  const agentDef = registry.agents[agent];
  
  if (!agentDef) {
    log('red', `❌ Agent '${agent}' not found in registry`);
    process.exit(1);
  }
  
  // Build the sessions_spawn command for Moltbot
  const spawnCmd = {
    task: `${agentDef.systemPrompt}\n\nTask: ${task}`,
    label: agentDef.label,
    model: agentDef.model,
    runTimeoutSeconds: 300
  };
  
  return spawnCmd;
}

function main() {
  const args = process.argv.slice(2);
  
  if (args.length < 2) {
    console.log(`
${colors.bold}Agent Ops - Sub-Agent Spawning Helper${colors.reset}

${colors.blue}Usage:${colors.reset}
  node spawn.mjs <agent-name> "<task-description>" [options]

${colors.blue}Examples:${colors.reset}
  node spawn.mjs scout "Research Uniswap V4 hooks"
  node spawn.mjs builder "Create Discord price bot"
  node spawn.mjs watcher "Check LP position health"

${colors.blue}Available Agents:${colors.reset}`);

    try {
      const registry = loadRegistry();
      for (const [name, agent] of Object.entries(registry.agents)) {
        console.log(`  ${colors.green}${name}${colors.reset} - ${agent.description}`);
      }
    } catch (error) {
      log('yellow', '  (Run agent-ops init to set up registry)');
    }

    process.exit(1);
  }
  
  const [agentName, taskDescription, ...options] = args;
  
  log('blue', `🤖 Spawning ${agentName} for task: ${taskDescription}`);
  
  // Load registry and validate agent
  const registry = loadRegistry();
  const agent = registry.agents[agentName];
  
  if (!agent) {
    log('red', `❌ Unknown agent: ${agentName}`);
    log('yellow', 'Available agents: ' + Object.keys(registry.agents).join(', '));
    process.exit(1);
  }
  
  // Load and update state
  const state = loadState();
  const taskId = generateTaskId(taskDescription);
  const timestamp = new Date().toISOString();
  
  // Check if agent is already busy
  if (state.agentStatus[agentName]?.status === 'busy') {
    log('yellow', `⚠️  Agent ${agentName} is already busy with: ${state.agentStatus[agentName].lastTask}`);
    log('yellow', '   Continuing anyway...');
  }
  
  // Update state with new task
  state.activeTasks[taskId] = {
    status: 'spawning',
    assignee: agentName,
    started: timestamp,
    description: taskDescription
  };
  
  state.agentStatus[agentName] = {
    status: 'busy',
    lastTask: taskId,
    lastSpawned: timestamp
  };
  
  updateState(state);
  
  // Build spawn command
  const spawnCmd = buildSpawnCommand(agentName, taskDescription);
  
  log('green', '✅ Task registered in state.json');
  log('blue', '📋 Spawn command for Moltbot:');
  console.log('');
  
  // Output the JavaScript command to spawn the agent
  console.log(`${colors.bold}sessions_spawn(${JSON.stringify(spawnCmd, null, 2)});${colors.reset}`);
  
  console.log('');
  log('yellow', '💡 Tips:');
  log('yellow', '   - Copy the command above and run it in your Moltbot session');
  log('yellow', '   - Check agents/state.json to monitor progress');
  log('yellow', '   - Agent will report back when task is complete');
  
  console.log('');
  log('blue', `📊 Agent Status:`);
  console.log(`   Model: ${agent.model}`);
  console.log(`   Workspace: ${agent.workspace}`);
  console.log(`   Capabilities: ${agent.capabilities.join(', ')}`);
}

// Handle errors gracefully
process.on('uncaughtException', (error) => {
  log('red', `❌ Unexpected error: ${error.message}`);
  process.exit(1);
});

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}