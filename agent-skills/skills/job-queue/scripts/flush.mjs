#!/usr/bin/env node
// Clean up queue: retry failed jobs, prune old done/expired entries, reset stuck running jobs.
// Usage: node flush.mjs [--retry-failed] [--prune] [--reset-stuck] [--age 86400]

import { resolve } from 'path';
import { acquireLock, releaseLock, parseArgs, readQueue, writeQueue } from './lib.mjs';

const args = parseArgs(process.argv.slice(2));
const QUEUE_FILE = resolve(args['queue'] || 'queue.ndjson');
const JSON_OUT = args['json'] || false;
const RETRY_FAILED = args['retry-failed'] || false;
const PRUNE = args['prune'] || false;
const RESET_STUCK = args['reset-stuck'] || false;
const MAX_AGE = parseInt(args['age'] || '86400', 10);
const STUCK_AFTER = parseInt(args['stuck-after'] || '3600', 10); // 1h default

if (!RETRY_FAILED && !PRUNE && !RESET_STUCK) {
  console.error('Usage: flush.mjs [--retry-failed] [--prune [--age <seconds>]] [--reset-stuck [--stuck-after <seconds>]]');
  process.exit(1);
}

const lockFile = QUEUE_FILE + '.lock';
acquireLock(lockFile);

try {
  let jobs = readQueue(QUEUE_FILE);
  const now = Math.floor(Date.now() / 1000);
  const report = { retried: 0, pruned: 0, stuck: 0 };

  if (RETRY_FAILED) {
    jobs = jobs.map((j) => {
      if (j.status === 'failed') {
        report.retried++;
        return { ...j, status: 'pending', updatedAt: now };
      }
      return j;
    });
  }

  if (RESET_STUCK) {
    jobs = jobs.map((j) => {
      if (j.status === 'running' && now - j.updatedAt > STUCK_AFTER) {
        report.stuck++;
        const isFinal = j.attempts >= j.maxAttempts;
        return { ...j, status: isFinal ? 'failed' : 'pending', updatedAt: now };
      }
      return j;
    });
  }

  if (PRUNE) {
    const before = jobs.length;
    jobs = jobs.filter((j) => {
      if (j.status === 'done' && now - j.updatedAt > MAX_AGE) return false;
      if (j.status === 'pending' && now - j.createdAt > j.ttl) return false; // expired
      return true;
    });
    report.pruned = before - jobs.length;
  }

  writeQueue(QUEUE_FILE, jobs);

  if (JSON_OUT) {
    console.log(JSON.stringify(report));
  } else {
    if (RETRY_FAILED) console.log(`Retried: ${report.retried} failed job(s) reset to pending`);
    if (RESET_STUCK) console.log(`Unstuck: ${report.stuck} running job(s) reset (>${STUCK_AFTER}s)`);
    if (PRUNE) console.log(`Pruned: ${report.pruned} done/expired job(s) removed`);
  }
} finally {
  releaseLock(lockFile);
}
