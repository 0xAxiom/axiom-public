#!/usr/bin/env node
// verify-trigger.js — verify a cron fire is legitimate, not a stale gateway replay.
// Exit 0 = legitimate fire, exit 1 = phantom (caller should SKIP).
//
// Usage:
//   node verify-trigger.js --cron-id <id> --jobs <jobs.json> [--gateway-log <path>] [--json]

const fs = require('fs');

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    if (k.startsWith('--')) {
      const key = k.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) {
        args[key] = true;
      } else {
        args[key] = next;
        i++;
      }
    }
  }
  return args;
}

function findCron(jobs, cronId) {
  if (!Array.isArray(jobs)) {
    jobs = jobs.jobs || jobs.crons || Object.values(jobs);
  }
  return jobs.find((j) => j.id === cronId || j.cronId === cronId || j.name === cronId);
}

function inferLegitimacy(cron, now) {
  const reasons = [];
  let legitimate = true;

  if (!cron) {
    return { legitimate: false, reason: 'cron-not-found', reasons: ['cron id missing from jobs.json'] };
  }

  const consecutiveErrors = cron.consecutiveErrors ?? cron.state?.consecutiveErrors ?? 0;
  const lastStatus = cron.lastStatus ?? cron.state?.lastStatus ?? null;
  const nextRunAtMs = cron.nextRunAtMs ?? cron.state?.nextRunAtMs ?? null;
  const lastRunAtMs = cron.lastRunAtMs ?? cron.state?.lastRunAtMs ?? null;

  if (consecutiveErrors >= 3) {
    legitimate = false;
    reasons.push(`consecutiveErrors=${consecutiveErrors}`);
  }
  if (lastStatus && /auth|error|denied/i.test(lastStatus)) {
    legitimate = false;
    reasons.push(`lastStatus=${lastStatus}`);
  }
  if (nextRunAtMs && nextRunAtMs < now - 6 * 60 * 60 * 1000) {
    // nextRun is more than 6 hours behind wall clock → scheduler is stuck
    legitimate = false;
    const staleHours = ((now - nextRunAtMs) / 36e5).toFixed(1);
    reasons.push(`nextRunAtMs stale by ${staleHours}h`);
  }
  if (lastRunAtMs && now - lastRunAtMs < 60 * 1000) {
    // fired less than a minute ago — likely a same-tick replay
    legitimate = false;
    reasons.push('lastRunAtMs within 60s — same-tick replay');
  }

  return {
    legitimate,
    reason: legitimate ? 'ok' : (reasons[0] || 'unknown'),
    reasons,
    state: { consecutiveErrors, lastStatus, nextRunAtMs, lastRunAtMs },
  };
}

function checkGatewayLog(logPath, cronId, withinSec = 30) {
  if (!logPath || !fs.existsSync(logPath)) return { matched: false };
  try {
    const stat = fs.statSync(logPath);
    const readBytes = Math.min(stat.size, 256 * 1024);
    const fd = fs.openSync(logPath, 'r');
    const buf = Buffer.alloc(readBytes);
    fs.readSync(fd, buf, 0, readBytes, stat.size - readBytes);
    fs.closeSync(fd);
    const tail = buf.toString('utf8');
    const lines = tail.split('\n').reverse();
    for (const line of lines) {
      if (line.includes(cronId) && /skipping stale delivery/.test(line)) {
        const tsMatch = line.match(/scheduled at ([0-9T:.\-Z]+)/);
        return {
          matched: true,
          line: line.trim(),
          scheduledFor: tsMatch ? tsMatch[1] : null,
        };
      }
    }
  } catch (err) {
    return { matched: false, error: err.message };
  }
  return { matched: false };
}

function main() {
  const args = parseArgs(process.argv);
  const cronId = args['cron-id'] || args.cron;
  const jobsPath = args.jobs || `${process.env.HOME}/.openclaw/cron/jobs.json`;
  const logPath = args['gateway-log'] || `${process.env.HOME}/.openclaw/logs/gateway.log`;
  const wantJson = !!args.json;

  if (!cronId) {
    console.error('usage: verify-trigger.js --cron-id <id> [--jobs <path>] [--gateway-log <path>] [--json]');
    process.exit(2);
  }
  if (!fs.existsSync(jobsPath)) {
    console.error(`jobs file not found: ${jobsPath}`);
    process.exit(2);
  }

  const jobs = JSON.parse(fs.readFileSync(jobsPath, 'utf8'));
  const cron = findCron(jobs, cronId);
  const now = Date.now();

  const stateCheck = inferLegitimacy(cron, now);
  const logCheck = checkGatewayLog(logPath, cronId);

  let legitimate = stateCheck.legitimate;
  if (logCheck.matched) legitimate = false;

  const result = {
    cronId,
    name: cron?.name ?? null,
    legitimate,
    reason: legitimate ? 'ok' : (logCheck.matched ? 'phantom-replay' : stateCheck.reason),
    evidence: {
      now: new Date(now).toISOString(),
      state: stateCheck.state,
      stateReasons: stateCheck.reasons,
      gatewayLog: logCheck,
    },
    action: legitimate ? 'PROCEED' : 'SKIP',
  };

  if (wantJson) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } else {
    process.stdout.write(`${result.action}: ${result.reason}\n`);
    if (!legitimate) {
      for (const r of stateCheck.reasons) process.stdout.write(`  - ${r}\n`);
      if (logCheck.matched) process.stdout.write(`  - gateway: ${logCheck.line}\n`);
    }
  }

  process.exit(legitimate ? 0 : 1);
}

main();
