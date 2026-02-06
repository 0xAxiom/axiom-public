#!/usr/bin/env node
/**
 * GitHub Pulse - Real-time GitHub activity dashboard
 * 
 * Usage:
 *   GITHUB_TOKEN=xxx npm start
 *   GITHUB_TOKEN=xxx node server.mjs
 */

import express from 'express';
import { createServer } from 'http';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync, existsSync } from 'fs';

import { createGitHubClient } from './lib/github.mjs';
import { 
  addEvent, 
  getEvents, 
  getRepoEvents, 
  registerClient, 
  getClientCount,
  parseWebhookEvent 
} from './lib/events.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load config
const configPath = join(__dirname, 'config.json');
const config = existsSync(configPath) 
  ? JSON.parse(readFileSync(configPath, 'utf-8'))
  : { repos: [], port: 3456, pollIntervalMs: 300000 };

// Initialize GitHub client
const token = process.env.GITHUB_TOKEN;
if (!token) {
  console.error('⚠️  GITHUB_TOKEN not set. API rate limits will be very low (60 req/hr).');
  console.error('   Set GITHUB_TOKEN for 5000 req/hr.');
}
const github = createGitHubClient(token);

// Parse repos from config
const repos = config.repos.map(r => {
  const [owner, repo] = r.split('/');
  return { owner, repo, fullName: r };
});

// Activity data cache
const activityCache = new Map();

// Create Express app
const app = express();
app.use(express.json());
app.use(express.static(join(__dirname, 'public')));

// CORS for local dev
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

/**
 * API: List configured repos
 */
app.get('/api/repos', (req, res) => {
  res.json({
    repos: repos.map(r => r.fullName),
    pollIntervalMs: config.pollIntervalMs
  });
});

/**
 * API: Get activity for all repos
 */
app.get('/api/activity', async (req, res) => {
  try {
    const results = {};
    for (const { owner, repo, fullName } of repos) {
      // Use cache if fresh
      const cached = activityCache.get(fullName);
      if (cached && Date.now() - cached.timestamp < 60_000) {
        results[fullName] = cached.data;
      } else {
        const data = await github.getRepoActivity(owner, repo);
        activityCache.set(fullName, { data, timestamp: Date.now() });
        results[fullName] = data;
      }
    }
    res.json(results);
  } catch (e) {
    console.error('Error fetching activity:', e.message);
    res.status(500).json({ error: e.message });
  }
});

/**
 * API: Get activity for specific repo
 */
app.get('/api/activity/:owner/:repo', async (req, res) => {
  const { owner, repo } = req.params;
  const fullName = `${owner}/${repo}`;
  
  // Verify repo is configured
  if (!repos.some(r => r.fullName === fullName)) {
    return res.status(404).json({ error: 'Repo not configured' });
  }
  
  try {
    const data = await github.getRepoActivity(owner, repo);
    activityCache.set(fullName, { data, timestamp: Date.now() });
    res.json(data);
  } catch (e) {
    console.error(`Error fetching ${fullName}:`, e.message);
    res.status(500).json({ error: e.message });
  }
});

/**
 * API: Get recent events
 */
app.get('/api/events', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 100);
  const repo = req.query.repo;
  
  if (repo) {
    res.json(getRepoEvents(repo, limit));
  } else {
    res.json(getEvents(limit));
  }
});

/**
 * API: SSE stream for real-time updates
 */
app.get('/api/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  
  registerClient(res);
  
  // Keep-alive ping every 30s
  const keepAlive = setInterval(() => {
    res.write(': keepalive\n\n');
  }, 30000);
  
  res.on('close', () => {
    clearInterval(keepAlive);
  });
});

/**
 * API: GitHub webhook handler
 */
app.post('/webhook', (req, res) => {
  const eventType = req.headers['x-github-event'];
  const payload = req.body;
  
  if (!eventType || !payload) {
    return res.status(400).json({ error: 'Invalid webhook' });
  }
  
  // Parse and broadcast event
  const event = parseWebhookEvent(eventType, payload);
  addEvent(event);
  
  console.log(`📨 Webhook: ${eventType} on ${event.repo}`);
  res.json({ received: true, event: event.type });
});

/**
 * API: Rate limit info
 */
app.get('/api/rate-limit', async (req, res) => {
  try {
    const limit = await github.getRateLimit();
    res.json(limit);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * API: Server status
 */
app.get('/api/status', (req, res) => {
  res.json({
    uptime: process.uptime(),
    repos: repos.length,
    clients: getClientCount(),
    cacheSize: activityCache.size
  });
});

/**
 * Polling refresh
 */
async function pollRepos() {
  console.log('🔄 Polling repos...');
  for (const { owner, repo, fullName } of repos) {
    try {
      const data = await github.getRepoActivity(owner, repo);
      activityCache.set(fullName, { data, timestamp: Date.now() });
      
      // Check for new commits and emit events
      const commits = data.commits.recent || [];
      for (const commit of commits.slice(0, 3)) {
        // Only emit if commit is < 5 min old
        if (new Date() - new Date(commit.date) < 5 * 60 * 1000) {
          addEvent({
            type: 'commit',
            repo: fullName,
            sha: commit.sha,
            message: commit.message,
            author: commit.author,
            url: commit.url
          });
        }
      }
    } catch (e) {
      console.error(`Failed to poll ${fullName}:`, e.message);
    }
  }
}

// Start server
const PORT = config.port || 3456;
const server = createServer(app);

server.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════════════════════════╗
║                      GITHUB PULSE                              ║
║               Real-time Activity Dashboard                     ║
╠═══════════════════════════════════════════════════════════════╣
║                                                                ║
║   Dashboard:  http://localhost:${PORT}                          ║
║   API:        http://localhost:${PORT}/api/activity             ║
║   Stream:     http://localhost:${PORT}/api/stream               ║
║   Webhook:    http://localhost:${PORT}/webhook                  ║
║                                                                ║
║   Repos: ${repos.map(r => r.fullName).join(', ').padEnd(49)}║
║                                                                ║
╚═══════════════════════════════════════════════════════════════╝
  `);
  
  // Initial poll
  pollRepos();
  
  // Set up polling interval
  setInterval(pollRepos, config.pollIntervalMs);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n👋 Shutting down...');
  server.close();
  process.exit(0);
});
