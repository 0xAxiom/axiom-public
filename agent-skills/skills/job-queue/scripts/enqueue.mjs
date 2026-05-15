#!/usr/bin/env node
// Add a job to the queue. Supports deduplication, priority, TTL, retry limits.
// Usage: node enqueue.mjs --type harvest --key harvest-2026-05-15 --payload '{}'

import { readFileSync, writeFileSync, existsSync, appendFileSync } from 'fs';
import { randomUUID } from 'crypto';
import { resolve } from 'path';
import { acquireLock, releaseLock, parseArgs, readQueue, writeQueue } from './lib.mjs';

const args = parseArgs(process.argv.slice(2));
const QUEUE_FILE = resolve(args['queue'] || 'queue.ndjson');
const JSON_OUT = args['json'] || false;

if (!args['type']) {
  console.error('Error: --type is required');
  process.exit(1);
}

const job = {
  id: randomUUID(),
  type: args['type'],
  key: args['key'] || randomUUID(),
  status: 'pending',
  priority: parseInt(args['priority'] || '0', 10),
  maxAttempts: parseInt(args['max-attempts'] || '3', 10),
  ttl: parseInt(args['ttl'] || '86400', 10),
  payload: args['payload'] ? JSON.parse(args['payload']) : {},
  attempts: 0,
  createdAt: Math.floor(Date.now() / 1000),
  updatedAt: Math.floor(Date.now() / 1000),
};

const lockFile = QUEUE_FILE + '.lock';
acquireLock(lockFile);

try {
  const jobs = readQueue(QUEUE_FILE);

  // Deduplication: skip if a job with the same key is pending or running
  const duplicate = jobs.find(
    (j) => j.key === job.key && (j.status === 'pending' || j.status === 'running')
  );

  if (duplicate) {
    if (JSON_OUT) {
      console.log(JSON.stringify({ enqueued: false, reason: 'duplicate', existing: duplicate }));
    } else {
      console.log(`Skipped: job with key "${job.key}" already ${duplicate.status} (id=${duplicate.id})`);
    }
    process.exit(0);
  }

  // Append job
  appendFileSync(QUEUE_FILE, JSON.stringify(job) + '\n');

  if (JSON_OUT) {
    console.log(JSON.stringify({ enqueued: true, job }));
  } else {
    console.log(`Enqueued: [${job.type}] id=${job.id} key="${job.key}"`);
  }
} finally {
  releaseLock(lockFile);
}
