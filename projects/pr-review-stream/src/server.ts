// PR Review Stream - Main Server

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { createHmac } from 'crypto';
import { config } from './config.js';
import { parseDiff, getTotalChanges } from './diff.js';
import { selectModel } from './router.js';
import { review, isLGTM } from './review.js';
import { fetchPullRequestDiff, createReview, addComment, checkRateLimit } from './github.js';
import type { PullRequestEvent, ReviewResult } from './types.js';

const app = new Hono();

// Middleware
app.use('*', cors());
app.use('*', logger());

// In-memory store for review status (use SQLite in production)
const reviews = new Map<string, ReviewResult>();
const queue: Array<{ owner: string; repo: string; pr: number; sha: string }> = [];
let processing = false;

// Webhook signature verification
function verifySignature(payload: string, signature: string | null): boolean {
  if (!signature || !config.github.webhookSecret) return false;
  
  const expected = 'sha256=' + createHmac('sha256', config.github.webhookSecret)
    .update(payload)
    .digest('hex');
    
  return signature === expected;
}

// Process review queue
async function processQueue() {
  if (processing || queue.length === 0) return;
  processing = true;
  
  while (queue.length > 0) {
    const job = queue.shift()!;
    const key = `${job.owner}/${job.repo}#${job.pr}`;
    
    try {
      reviews.set(key, {
        prNumber: job.pr,
        repo: `${job.owner}/${job.repo}`,
        status: 'reviewing',
        comments: [],
        summary: '',
        tokensUsed: 0,
        duration: 0,
        model: '',
      });
      
      console.log(`🔍 Starting review for ${key}`);
      const startTime = Date.now();
      
      // Fetch diff
      const diff = await fetchPullRequestDiff(job.owner, job.repo, job.pr);
      const files = parseDiff(diff);
      const { additions, deletions } = getTotalChanges(files);
      
      console.log(`📄 ${files.length} files, +${additions} -${deletions} lines`);
      
      // Skip empty diffs
      if (files.length === 0) {
        await addComment(job.owner, job.repo, job.pr,
          '🔍 **PR Review Stream**: No reviewable changes detected.');
        reviews.set(key, { ...reviews.get(key)!, status: 'completed', summary: 'No changes' });
        continue;
      }
      
      // Select model based on complexity
      const { model, reason } = selectModel(files);
      console.log(`🤖 Using ${model}: ${reason}`);
      
      // Run review
      const result = await review(files, model);
      const duration = Date.now() - startTime;
      
      console.log(`✅ Review complete: ${result.comments.length} comments, ${result.tokensUsed} tokens, ${duration}ms`);
      
      // Determine review event type
      const hasCritical = result.comments.some(c => c.severity === 'critical');
      const event = hasCritical ? 'REQUEST_CHANGES' : 
                    result.comments.length === 0 ? 'APPROVE' : 'COMMENT';
      
      // Build summary
      const summary = buildSummary(files, result.comments, model, duration);
      
      // Post review to GitHub
      if (result.comments.length > 0) {
        await createReview(
          job.owner,
          job.repo,
          job.pr,
          job.sha,
          result.comments,
          summary,
          event
        );
      } else {
        await addComment(job.owner, job.repo, job.pr, summary);
      }
      
      reviews.set(key, {
        prNumber: job.pr,
        repo: `${job.owner}/${job.repo}`,
        status: 'completed',
        comments: result.comments,
        summary,
        tokensUsed: result.tokensUsed,
        duration,
        model,
      });
      
    } catch (error) {
      console.error(`❌ Review failed for ${key}:`, error);
      reviews.set(key, {
        prNumber: job.pr,
        repo: `${job.owner}/${job.repo}`,
        status: 'failed',
        comments: [],
        summary: `Review failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        tokensUsed: 0,
        duration: 0,
        model: '',
      });
      
      // Post failure comment
      try {
        await addComment(job.owner, job.repo, job.pr,
          `🔍 **PR Review Stream**: Review failed - ${error instanceof Error ? error.message : 'Unknown error'}`);
      } catch {}
    }
  }
  
  processing = false;
}

function buildSummary(
  files: ReturnType<typeof parseDiff>,
  comments: ReviewResult['comments'],
  model: string,
  duration: number
): string {
  const { additions, deletions } = getTotalChanges(files);
  const critical = comments.filter(c => c.severity === 'critical').length;
  const warnings = comments.filter(c => c.severity === 'warning').length;
  const suggestions = comments.filter(c => c.severity === 'suggestion').length;
  
  let summary = `## 🔍 AI Code Review\n\n`;
  summary += `**Files reviewed:** ${files.length} (+${additions} -${deletions})\n`;
  summary += `**Model:** \`${model}\`\n`;
  summary += `**Duration:** ${(duration / 1000).toFixed(1)}s\n\n`;
  
  if (comments.length === 0) {
    summary += `✅ **LGTM** - No issues found!\n`;
  } else {
    summary += `### Summary\n\n`;
    if (critical > 0) summary += `- 🚨 **${critical}** critical issue${critical > 1 ? 's' : ''}\n`;
    if (warnings > 0) summary += `- ⚠️ **${warnings}** warning${warnings > 1 ? 's' : ''}\n`;
    if (suggestions > 0) summary += `- 💡 **${suggestions}** suggestion${suggestions > 1 ? 's' : ''}\n`;
  }
  
  summary += `\n---\n*Powered by [PR Review Stream](https://github.com/0xAxiom/daily-builds) • Local LLM review*`;
  
  return summary;
}

// Routes

// Health check
app.get('/health', (c) => c.json({ status: 'ok', queue: queue.length, processing }));

// GitHub webhook
app.post('/webhook/github', async (c) => {
  const signature = c.req.header('x-hub-signature-256');
  const event = c.req.header('x-github-event');
  const body = await c.req.text();
  
  // Verify signature (skip in dev)
  if (config.github.webhookSecret !== 'dev-secret' && !verifySignature(body, signature || null)) {
    return c.json({ error: 'Invalid signature' }, 401);
  }
  
  if (event !== 'pull_request') {
    return c.json({ status: 'ignored', reason: 'Not a PR event' });
  }
  
  const payload: PullRequestEvent = JSON.parse(body);
  
  // Only review on open/synchronize
  if (!['opened', 'synchronize', 'reopened'].includes(payload.action)) {
    return c.json({ status: 'ignored', reason: `Action ${payload.action} not reviewed` });
  }
  
  // Add to queue
  const job = {
    owner: payload.repository.owner.login,
    repo: payload.repository.name,
    pr: payload.pull_request.number,
    sha: payload.pull_request.head.sha,
  };
  
  queue.push(job);
  console.log(`📬 Queued review for ${job.owner}/${job.repo}#${job.pr}`);
  
  // Start processing
  processQueue();
  
  return c.json({ status: 'queued', position: queue.length });
});

// Manual review trigger
app.post('/api/review', async (c) => {
  const { owner, repo, pr } = await c.req.json();
  
  if (!owner || !repo || !pr) {
    return c.json({ error: 'Missing owner, repo, or pr' }, 400);
  }
  
  // Fetch PR to get SHA
  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/pulls/${pr}`,
    {
      headers: {
        Authorization: `Bearer ${config.github.token}`,
        Accept: 'application/vnd.github.v3+json',
      },
    }
  );
  
  if (!response.ok) {
    return c.json({ error: 'PR not found' }, 404);
  }
  
  const data = await response.json() as { head: { sha: string } };
  
  queue.push({ owner, repo, pr, sha: data.head.sha });
  processQueue();
  
  return c.json({ status: 'queued', position: queue.length });
});

// Get review status
app.get('/api/reviews/:owner/:repo/:pr', (c) => {
  const { owner, repo, pr } = c.req.param();
  const key = `${owner}/${repo}#${pr}`;
  const result = reviews.get(key);
  
  if (!result) {
    return c.json({ error: 'Review not found' }, 404);
  }
  
  return c.json(result);
});

// List all reviews
app.get('/api/reviews', (c) => {
  return c.json(Array.from(reviews.values()).slice(-50));
});

// Rate limit status
app.get('/api/rate-limit', async (c) => {
  const limit = await checkRateLimit();
  return c.json(limit);
});

// Dashboard
app.get('/', (c) => {
  return c.html(`<!DOCTYPE html>
<html>
<head>
  <title>PR Review Stream</title>
  <meta charset="utf-8">
  <style>
    * { box-sizing: border-box; }
    body { 
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      max-width: 1200px; margin: 0 auto; padding: 2rem;
      background: #0d1117; color: #c9d1d9;
    }
    h1 { color: #58a6ff; }
    .status { display: flex; gap: 2rem; margin: 1rem 0; }
    .status-card { 
      background: #161b22; padding: 1rem 1.5rem; border-radius: 8px;
      border: 1px solid #30363d;
    }
    .status-card h3 { margin: 0 0 0.5rem; color: #8b949e; font-size: 0.9rem; }
    .status-card .value { font-size: 2rem; font-weight: bold; color: #58a6ff; }
    table { width: 100%; border-collapse: collapse; margin-top: 2rem; }
    th, td { text-align: left; padding: 0.75rem; border-bottom: 1px solid #30363d; }
    th { color: #8b949e; font-weight: 500; }
    .badge { 
      padding: 0.25rem 0.75rem; border-radius: 20px; font-size: 0.8rem;
      display: inline-block;
    }
    .completed { background: #238636; color: white; }
    .reviewing { background: #1f6feb; color: white; }
    .failed { background: #da3633; color: white; }
    .pending { background: #6e7681; color: white; }
    a { color: #58a6ff; text-decoration: none; }
    a:hover { text-decoration: underline; }
    .refresh { float: right; }
    button {
      background: #238636; color: white; border: none;
      padding: 0.5rem 1rem; border-radius: 6px; cursor: pointer;
    }
    button:hover { background: #2ea043; }
    code { background: #161b22; padding: 0.2rem 0.4rem; border-radius: 4px; }
  </style>
</head>
<body>
  <h1>🔍 PR Review Stream</h1>
  <p>AI-powered code review with local LLMs</p>
  
  <div class="status">
    <div class="status-card">
      <h3>Queue</h3>
      <div class="value" id="queue">${queue.length}</div>
    </div>
    <div class="status-card">
      <h3>Reviews Today</h3>
      <div class="value" id="total">${reviews.size}</div>
    </div>
    <div class="status-card">
      <h3>Status</h3>
      <div class="value" id="status">${processing ? '🔄' : '✅'}</div>
    </div>
  </div>
  
  <h2>Recent Reviews <button class="refresh" onclick="location.reload()">↻ Refresh</button></h2>
  <table>
    <thead>
      <tr>
        <th>PR</th>
        <th>Status</th>
        <th>Comments</th>
        <th>Model</th>
        <th>Duration</th>
      </tr>
    </thead>
    <tbody id="reviews">
      ${Array.from(reviews.values()).reverse().slice(0, 20).map(r => `
        <tr>
          <td><a href="https://github.com/${r.repo}/pull/${r.prNumber}" target="_blank">${r.repo}#${r.prNumber}</a></td>
          <td><span class="badge ${r.status}">${r.status}</span></td>
          <td>${r.comments.length}</td>
          <td><code>${r.model || '-'}</code></td>
          <td>${r.duration ? (r.duration / 1000).toFixed(1) + 's' : '-'}</td>
        </tr>
      `).join('')}
    </tbody>
  </table>
  
  <h2>Manual Review</h2>
  <p>Trigger a review: <code>curl -X POST http://localhost:3456/api/review -H "Content-Type: application/json" -d '{"owner":"...", "repo":"...", "pr": 123}'</code></p>
  
  <script>
    setInterval(async () => {
      const res = await fetch('/api/reviews');
      const reviews = await res.json();
      document.getElementById('total').textContent = reviews.length;
      
      const health = await fetch('/health').then(r => r.json());
      document.getElementById('queue').textContent = health.queue;
      document.getElementById('status').textContent = health.processing ? '🔄' : '✅';
    }, 5000);
  </script>
</body>
</html>`);
});

// Start server
import { serve } from '@hono/node-server';

const port = parseInt(process.env.PORT || '3456');

serve({
  fetch: app.fetch,
  port,
}, (info) => {
  console.log(`🚀 PR Review Stream running on http://localhost:${info.port}`);
});

export default app;
