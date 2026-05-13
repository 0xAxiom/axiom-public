#!/usr/bin/env node
// scan-stale.js — scan all crons for stuck-queue signatures.
// Prints a report of phantom-replay candidates: crons whose nextRunAtMs is far
// behind wall clock, whose auth has been failing, or whose gateway log shows
// repeated "skipping stale delivery" entries.

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

function loadJobs(jobsPath) {
  const raw = JSON.parse(fs.readFileSync(jobsPath, 'utf8'));
  if (Array.isArray(raw)) return raw;
  return raw.jobs || raw.crons || Object.values(raw);
}

function countStaleLogEntries(logPath, sinceMs) {
  if (!fs.existsSync(logPath)) return {};
  const counts = {};
  const stat = fs.statSync(logPath);
  const readBytes = Math.min(stat.size, 2 * 1024 * 1024);
  const fd = fs.openSync(logPath, 'r');
  const buf = Buffer.alloc(readBytes);
  fs.readSync(fd, buf, 0, readBytes, stat.size - readBytes);
  fs.closeSync(fd);
  const tail = buf.toString('utf8').split('\n');
  for (const line of tail) {
    if (!/skipping stale delivery/.test(line)) continue;
    const idMatch = line.match(/cron[\s:=]+([a-f0-9-]{6,})/i);
    if (idMatch) counts[idMatch[1]] = (counts[idMatch[1]] || 0) + 1;
  }
  return counts;
}

function main() {
  const args = parseArgs(process.argv);
  const jobsPath = args.jobs || `${process.env.HOME}/.openclaw/cron/jobs.json`;
  const logPath = args['gateway-log'] || `${process.env.HOME}/.openclaw/logs/gateway.log`;

  if (!fs.existsSync(jobsPath)) {
    console.error(`jobs file not found: ${jobsPath}`);
    process.exit(2);
  }

  const jobs = loadJobs(jobsPath);
  const now = Date.now();
  const dayAgo = now - 24 * 60 * 60 * 1000;
  const staleCounts = countStaleLogEntries(logPath, dayAgo);

  const findings = [];
  for (const cron of jobs) {
    const id = cron.id ?? cron.cronId ?? cron.name;
    const next = cron.nextRunAtMs ?? cron.state?.nextRunAtMs;
    const errs = cron.consecutiveErrors ?? cron.state?.consecutiveErrors ?? 0;
    const status = cron.lastStatus ?? cron.state?.lastStatus ?? '';
    const replays = staleCounts[id] || 0;
    const staleH = next ? (now - next) / 36e5 : null;

    if (replays >= 3 || errs >= 3 || (staleH && staleH > 24)) {
      findings.push({
        id,
        name: cron.name,
        schedule: cron.schedule,
        consecutiveErrors: errs,
        lastStatus: status,
        nextRunAtStaleH: staleH ? Number(staleH.toFixed(1)) : null,
        gatewayReplays: replays,
      });
    }
  }

  findings.sort((a, b) => b.gatewayReplays - a.gatewayReplays);

  if (findings.length === 0) {
    console.log('OK: no phantom-replay signatures detected');
    process.exit(0);
  }

  console.log(`PHANTOM CANDIDATES (${findings.length}):`);
  for (const f of findings) {
    console.log(
      `  ${f.id} ${f.name || ''} schedule="${f.schedule || '?'}" ` +
      `errs=${f.consecutiveErrors} status=${f.lastStatus || '-'} ` +
      `staleH=${f.nextRunAtStaleH ?? '-'} replays=${f.gatewayReplays}`,
    );
  }
  process.exit(1);
}

main();
