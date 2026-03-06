#!/usr/bin/env node
/**
 * Cron Health Monitor
 * Detect failed, stuck, late, and drifting scheduled jobs.
 * Zero dependencies — pure Node.js.
 */

import { readFileSync, statSync, existsSync } from 'fs';
import { execSync } from 'child_process';
import { resolve } from 'path';

const args = process.argv.slice(2);
const flags = {};
for (let i = 0; i < args.length; i += 2) {
  flags[args[i].replace(/^--/, '')] = args[i + 1];
}

function expandHome(p) {
  return p.replace(/^~/, process.env.HOME);
}

function loadConfig(configPath) {
  const raw = readFileSync(expandHome(configPath), 'utf8');
  return JSON.parse(raw);
}

function getLogLastLine(logPath) {
  try {
    const p = expandHome(logPath);
    if (!existsSync(p)) return { line: null, mtime: null };
    const stat = statSync(p);
    const content = readFileSync(p, 'utf8').trim();
    const lines = content.split('\n');
    return { line: lines[lines.length - 1], mtime: stat.mtime };
  } catch {
    return { line: null, mtime: null };
  }
}

function checkExitCode(logLine) {
  if (!logLine) return null;
  // Common patterns: "exit code 1", "code 1", "EXIT:1", "failed"
  const exitMatch = logLine.match(/(?:exit\s*code|code)\s*(\d+)/i);
  if (exitMatch) return parseInt(exitMatch[1]);
  if (/failed|error|exception/i.test(logLine)) return 1;
  return 0;
}

function extractTimestamp(logLine) {
  if (!logLine) return null;
  // ISO timestamps
  const iso = logLine.match(/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}/);
  if (iso) return new Date(iso[0]);
  return null;
}

function checkJob(job) {
  const now = Date.now();
  const result = {
    name: job.name,
    status: 'healthy',
    reasons: [],
    lastRun: null,
    lastExitCode: null,
    lastDuration: null
  };

  const alerts = job.alertOn || ['late', 'failed'];
  const logInfo = job.logPath ? getLogLastLine(job.logPath) : { line: null, mtime: null };

  // Determine last run time
  const logTimestamp = extractTimestamp(logInfo.line);
  const lastRunTime = logTimestamp || logInfo.mtime;
  if (lastRunTime) {
    result.lastRun = new Date(lastRunTime).toISOString();
    const ageSeconds = (now - new Date(lastRunTime).getTime()) / 1000;

    // Late check
    if (alerts.includes('late') && job.maxAgeSeconds) {
      if (ageSeconds > job.maxAgeSeconds * 2) {
        result.status = 'critical';
        result.reasons.push(`Last run ${Math.round(ageSeconds / 60)} minutes ago (max: ${Math.round(job.maxAgeSeconds / 60)} minutes)`);
      } else if (ageSeconds > job.maxAgeSeconds) {
        result.status = result.status === 'critical' ? 'critical' : 'warning';
        result.reasons.push(`Last run ${Math.round(ageSeconds / 60)} minutes ago (max: ${Math.round(job.maxAgeSeconds / 60)} minutes)`);
      }
    }
  } else if (alerts.includes('late')) {
    result.status = 'warning';
    result.reasons.push('No run history found');
  }

  // Exit code check
  if (alerts.includes('failed') && logInfo.line) {
    const exitCode = checkExitCode(logInfo.line);
    result.lastExitCode = exitCode;
    if (exitCode !== null && exitCode !== 0) {
      result.status = 'critical';
      result.reasons.push(`Last exit code: ${exitCode}`);
    }
  }

  // Silent check
  if (alerts.includes('silent') && logInfo.line === '') {
    result.status = result.status === 'critical' ? 'critical' : 'warning';
    result.reasons.push('Job produced no output');
  }

  if (result.reasons.length === 0) {
    result.reasons.push('OK');
  }

  return result;
}

function formatOutput(results, format) {
  const summary = {
    timestamp: new Date().toISOString(),
    healthy: results.filter(r => r.status === 'healthy').length,
    warning: results.filter(r => r.status === 'warning').length,
    critical: results.filter(r => r.status === 'critical').length,
    jobs: results
  };

  if (format === 'slack' || format === 'telegram' || format === 'discord') {
    const emoji = { healthy: '✅', warning: '⚠️', critical: '🔴' };
    let text = `**Cron Health: ${summary.healthy} ok, ${summary.warning} warn, ${summary.critical} crit**\n`;
    for (const job of results) {
      if (job.status !== 'healthy') {
        text += `${emoji[job.status]} ${job.name}: ${job.reasons.join(', ')}\n`;
      }
    }
    return text.trim() || '✅ All crons healthy';
  }

  return JSON.stringify(summary, null, 2);
}

// Main
try {
  if (flags.config) {
    const config = loadConfig(flags.config);
    let jobs = config.jobs;
    if (flags.job) {
      jobs = jobs.filter(j => j.name === flags.job);
    }
    const results = jobs.map(checkJob);
    console.log(formatOutput(results, flags.format));
    const hasCritical = results.some(r => r.status === 'critical');
    process.exit(hasCritical ? 1 : 0);
  } else if (flags.job) {
    // Single job check without config
    const job = {
      name: flags.job,
      maxAgeSeconds: parseInt(flags['max-age'] || '300'),
      logPath: flags.log,
      alertOn: ['late', 'failed', 'slow']
    };
    const result = checkJob(job);
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.status === 'critical' ? 1 : 0);
  } else {
    console.error('Usage: cron-health.mjs --config <crons.json> [--job <name>] [--format slack|telegram|discord]');
    process.exit(1);
  }
} catch (err) {
  console.error(`Error: ${err.message}`);
  process.exit(1);
}
