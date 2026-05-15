#!/usr/bin/env node
// Pop the next pending job and run it (or print it). Marks running -> done/failed automatically.
// Usage: node dequeue.mjs [--handler ./handler.mjs] [--json] [--dry-run]

import { execSync, spawnSync } from 'child_process';
import { resolve } from 'path';
import { acquireLock, releaseLock, parseArgs, readQueue, writeQueue } from './lib.mjs';

const args = parseArgs(process.argv.slice(2));
const QUEUE_FILE = resolve(args['queue'] || 'queue.ndjson');
const JSON_OUT = args['json'] || false;
const DRY_RUN = args['dry-run'] || false;
const HANDLER = args['handler'] ? resolve(args['handler']) : null;

const lockFile = QUEUE_FILE + '.lock';
acquireLock(lockFile);

let selectedJob = null;
let jobs = [];

try {
  jobs = readQueue(QUEUE_FILE);

  const now = Math.floor(Date.now() / 1000);

  // Find next job: pending, not expired, sorted by priority desc then createdAt asc
  const candidates = jobs
    .filter((j) => j.status === 'pending' && now < j.createdAt + j.ttl)
    .sort((a, b) => b.priority - a.priority || a.createdAt - b.createdAt);

  if (candidates.length === 0) {
    if (JSON_OUT) {
      console.log(JSON.stringify(null));
    } else {
      console.log('Queue empty (no pending jobs)');
    }
    process.exit(0);
  }

  selectedJob = candidates[0];

  if (DRY_RUN) {
    if (JSON_OUT) {
      console.log(JSON.stringify(selectedJob));
    } else {
      console.log(`Next job: [${selectedJob.type}] id=${selectedJob.id} key="${selectedJob.key}"`);
    }
    process.exit(0);
  }

  // Mark as running
  const now2 = Math.floor(Date.now() / 1000);
  jobs = jobs.map((j) =>
    j.id === selectedJob.id ? { ...j, status: 'running', updatedAt: now2, attempts: j.attempts + 1 } : j
  );
  writeQueue(QUEUE_FILE, jobs);
} finally {
  releaseLock(lockFile);
}

// Outside lock: run handler or print job
const jobJson = JSON.stringify(selectedJob);

if (!HANDLER) {
  // No handler: print job and exit 0 (caller processes it)
  if (JSON_OUT || !process.stdout.isTTY) {
    console.log(jobJson);
  } else {
    console.log(`Dequeued: [${selectedJob.type}] id=${selectedJob.id}`);
    console.log(JSON.stringify(selectedJob, null, 2));
  }
  // Mark done immediately (caller is responsible for their own error handling)
  markJob(selectedJob.id, QUEUE_FILE, 'done');
  process.exit(0);
}

// Run handler with job JSON on stdin
const result = spawnSync('node', [HANDLER], {
  input: jobJson,
  encoding: 'utf8',
  stdio: ['pipe', 'inherit', 'inherit'],
});

if (result.status === 0) {
  markJob(selectedJob.id, QUEUE_FILE, 'done');
  if (!JSON_OUT) console.log(`Done: [${selectedJob.type}] id=${selectedJob.id}`);
} else {
  const isFinal = selectedJob.attempts >= selectedJob.maxAttempts;
  markJob(selectedJob.id, QUEUE_FILE, isFinal ? 'failed' : 'pending');
  const msg = isFinal
    ? `Failed (max attempts): [${selectedJob.type}] id=${selectedJob.id}`
    : `Failed (will retry, attempt ${selectedJob.attempts}/${selectedJob.maxAttempts}): id=${selectedJob.id}`;
  console.error(msg);
  process.exit(result.status || 1);
}

function markJob(id, queueFile, status) {
  const lock = queueFile + '.lock';
  acquireLock(lock);
  try {
    const current = readQueue(queueFile);
    const updated = current.map((j) =>
      j.id === id ? { ...j, status, updatedAt: Math.floor(Date.now() / 1000) } : j
    );
    writeQueue(queueFile, updated);
  } finally {
    releaseLock(lock);
  }
}
