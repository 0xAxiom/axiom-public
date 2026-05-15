#!/usr/bin/env node
// Show queue state: counts by status, list jobs (optionally filtered).
// Usage: node status.mjs [--json] [--failed] [--pending] [--running]

import { resolve } from 'path';
import { parseArgs, readQueue } from './lib.mjs';

const args = parseArgs(process.argv.slice(2));
const QUEUE_FILE = resolve(args['queue'] || 'queue.ndjson');
const JSON_OUT = args['json'] || false;

const filterStatus = args['failed']
  ? 'failed'
  : args['pending']
  ? 'pending'
  : args['running']
  ? 'running'
  : args['done']
  ? 'done'
  : null;

const jobs = readQueue(QUEUE_FILE);
const now = Math.floor(Date.now() / 1000);

const counts = { pending: 0, running: 0, done: 0, failed: 0, expired: 0 };
for (const j of jobs) {
  if (j.status === 'pending' && now >= j.createdAt + j.ttl) {
    counts.expired++;
  } else {
    counts[j.status] = (counts[j.status] || 0) + 1;
  }
}

const filtered = filterStatus ? jobs.filter((j) => j.status === filterStatus) : jobs;

if (JSON_OUT) {
  console.log(JSON.stringify({ counts, jobs: filtered }, null, 2));
  process.exit(0);
}

// Human-readable
console.log(`Queue: ${QUEUE_FILE}`);
console.log(
  `  pending=${counts.pending}  running=${counts.running}  done=${counts.done}  failed=${counts.failed}  expired=${counts.expired}`
);

if (filtered.length === 0) {
  console.log('  (no jobs to show)');
  process.exit(0);
}

console.log('');
const header = filterStatus ? `[${filterStatus.toUpperCase()}]` : '[ALL]';
console.log(`${header} ${filtered.length} job(s):\n`);

for (const j of filtered) {
  const age = Math.floor((now - j.createdAt) / 60);
  const expired = j.status === 'pending' && now >= j.createdAt + j.ttl ? ' [EXPIRED]' : '';
  console.log(
    `  ${j.status.padEnd(8)} [${j.type}] id=${j.id.slice(0, 8)}.. key="${j.key}" attempts=${j.attempts}/${j.maxAttempts} age=${age}m${expired}`
  );
}
