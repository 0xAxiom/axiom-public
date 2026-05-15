// Shared utilities for job-queue scripts. No external dependencies.
import { readFileSync, writeFileSync, existsSync, unlinkSync, mkdirSync } from 'fs';
import { dirname } from 'path';

export function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        out[key] = next;
        i++;
      } else {
        out[key] = true;
      }
    }
  }
  return out;
}

export function readQueue(file) {
  if (!existsSync(file)) return [];
  const lines = readFileSync(file, 'utf8').trim().split('\n').filter(Boolean);
  return lines.map((l) => {
    try { return JSON.parse(l); } catch { return null; }
  }).filter(Boolean);
}

export function writeQueue(file, jobs) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, jobs.map((j) => JSON.stringify(j)).join('\n') + (jobs.length ? '\n' : ''));
}

export function acquireLock(lockFile, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (existsSync(lockFile)) {
    if (Date.now() > deadline) {
      // Stale lock: check if it's older than 30s
      try {
        const stat = readFileSync(lockFile, 'utf8');
        const lockedAt = parseInt(stat, 10);
        if (Date.now() - lockedAt > 30000) {
          unlinkSync(lockFile); // stale, remove
          break;
        }
      } catch { break; }
      throw new Error(`Could not acquire lock: ${lockFile} (held for too long)`);
    }
    // Busy-wait with small sleep (synchronous, queue ops are fast)
    const start = Date.now();
    while (Date.now() - start < 50) {} // 50ms spin
  }
  writeFileSync(lockFile, String(Date.now()));
}

export function releaseLock(lockFile) {
  try { unlinkSync(lockFile); } catch {}
}
