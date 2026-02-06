#!/usr/bin/env node

/**
 * Cron Fleet Manager CLI
 * 
 * Usage:
 *   cronfleet report     — Full fleet health report (Telegram format)
 *   cronfleet health     — Quick health check (just problems)
 *   cronfleet dupes      — Check for duplicate jobs
 *   cronfleet cost       — Cost breakdown by job
 *   cronfleet detail     — Full markdown report (for files)
 *   cronfleet json       — Raw JSON report
 *   cronfleet list       — Simple list of all jobs with status
 *   cronfleet stale      — Show only stale/overdue jobs
 *   cronfleet expensive  — Show jobs costing >$1/day
 * 
 * Options:
 *   --file <path>    Path to jobs.json (default: ~/.openclaw/cron/jobs.json)
 *   --output <path>  Write report to file instead of stdout
 *   --quiet          Suppress output if no issues found
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import {
  parseJobsFile,
  generateReport,
  formatTelegramReport,
  formatDetailedReport,
  classifyHealth,
  estimateCost,
  describeSchedule,
  detectDuplicates,
  formatMs,
} from './analyzer.mjs';

const DEFAULT_JOBS_PATH = join(homedir(), '.openclaw', 'cron', 'jobs.json');
const FALLBACK_JOBS_PATH = join(homedir(), '.clawdbot', 'cron', 'jobs.json');

function findJobsFile(customPath) {
  if (customPath) {
    if (!existsSync(customPath)) {
      console.error(`Error: File not found: ${customPath}`);
      process.exit(1);
    }
    return customPath;
  }
  
  if (existsSync(DEFAULT_JOBS_PATH)) return DEFAULT_JOBS_PATH;
  if (existsSync(FALLBACK_JOBS_PATH)) return FALLBACK_JOBS_PATH;
  
  console.error('Error: No jobs.json found. Try --file <path>');
  console.error(`Checked: ${DEFAULT_JOBS_PATH}`);
  console.error(`Checked: ${FALLBACK_JOBS_PATH}`);
  process.exit(1);
}

function loadJobs(filePath) {
  const raw = readFileSync(filePath, 'utf-8');
  const data = JSON.parse(raw);
  return parseJobsFile(data);
}

// Parse args
const args = process.argv.slice(2);
const command = args.find(a => !a.startsWith('--')) || 'report';
const flags = {};
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--file' && args[i + 1]) flags.file = args[++i];
  if (args[i] === '--output' && args[i + 1]) flags.output = args[++i];
  if (args[i] === '--quiet') flags.quiet = true;
}

const jobsPath = findJobsFile(flags.file);
const jobs = loadJobs(jobsPath);
const now = Date.now();

function output(text) {
  if (flags.output) {
    writeFileSync(flags.output, text, 'utf-8');
    console.log(`Report written to ${flags.output}`);
  } else {
    console.log(text);
  }
}

switch (command) {
  case 'report': {
    const report = generateReport(jobs, now);
    output(formatTelegramReport(report));
    break;
  }
  
  case 'health': {
    const problems = [];
    for (const job of jobs) {
      if (job.enabled === false) continue;
      const health = classifyHealth(job, now);
      if (health.severity === 'critical' || health.severity === 'warning') {
        problems.push({ name: job.name || job.id.slice(0, 8), ...health });
      }
    }
    
    if (problems.length === 0) {
      if (!flags.quiet) console.log('✅ All cron jobs healthy');
      process.exit(0);
    }
    
    console.log(`⚠️ ${problems.length} issue(s) found:\n`);
    for (const p of problems) {
      console.log(`  ${p.emoji} ${p.name}: ${p.detail}`);
    }
    process.exit(1);
    break;
  }
  
  case 'dupes': {
    const dupes = detectDuplicates(jobs);
    if (dupes.length === 0) {
      if (!flags.quiet) console.log('✅ No duplicates detected');
    } else {
      console.log(`🔄 ${dupes.length} potential duplicate(s):\n`);
      for (const d of dupes) {
        console.log(`  ${d.type}: ${d.detail}`);
        console.log(`    Jobs: ${d.jobs.join(' ↔ ')}`);
      }
    }
    break;
  }
  
  case 'cost': {
    const entries = [];
    for (const job of jobs) {
      if (job.enabled === false) continue;
      const cost = estimateCost(job);
      entries.push({ name: job.name || job.id.slice(0, 8), ...cost });
    }
    
    entries.sort((a, b) => b.dailyCostUsd - a.dailyCostUsd);
    
    let total = 0;
    console.log('💰 Cost Breakdown (enabled jobs only):\n');
    console.log(`${'Job'.padEnd(25)} ${'Model'.padEnd(20)} ${'Runs/Day'.padEnd(10)} ${'Duration'.padEnd(10)} ${'$/Day'.padEnd(8)} $/Mo`);
    console.log('-'.repeat(90));
    
    for (const e of entries) {
      total += e.dailyCostUsd;
      console.log(
        `${e.name.padEnd(25)} ${e.model.padEnd(20)} ${String(e.runsPerDay).padEnd(10)} ${(e.durationSec + 's').padEnd(10)} ${('$' + e.dailyCostUsd).padEnd(8)} $${e.monthlyCostUsd}`
      );
    }
    
    console.log('-'.repeat(90));
    console.log(`${'TOTAL'.padEnd(25)} ${''.padEnd(20)} ${''.padEnd(10)} ${''.padEnd(10)} ${('$' + Math.round(total * 100) / 100).padEnd(8)} $${Math.round(total * 30 * 100) / 100}`);
    break;
  }
  
  case 'detail': {
    const report = generateReport(jobs, now);
    output(formatDetailedReport(report));
    break;
  }
  
  case 'json': {
    const report = generateReport(jobs, now);
    output(JSON.stringify(report, null, 2));
    break;
  }
  
  case 'list': {
    console.log(`📋 All Cron Jobs (${jobs.length} total):\n`);
    
    const sorted = [...jobs].sort((a, b) => {
      // Enabled first, then by name
      if ((a.enabled !== false) !== (b.enabled !== false)) {
        return a.enabled === false ? 1 : -1;
      }
      return (a.name || '').localeCompare(b.name || '');
    });
    
    for (const job of sorted) {
      const health = classifyHealth(job, now);
      const schedule = describeSchedule(job.schedule);
      const disabled = job.enabled === false ? ' [DISABLED]' : '';
      console.log(`  ${health.emoji} ${(job.name || job.id.slice(0, 8)).padEnd(25)} ${schedule.padEnd(40)}${disabled}`);
    }
    break;
  }
  
  case 'stale': {
    const stale = [];
    for (const job of jobs) {
      if (job.enabled === false) continue;
      const health = classifyHealth(job, now);
      if (health.status === 'stale') {
        stale.push({ name: job.name || job.id.slice(0, 8), ...health });
      }
    }
    
    if (stale.length === 0) {
      if (!flags.quiet) console.log('✅ No stale jobs');
    } else {
      console.log(`🟠 ${stale.length} stale job(s):\n`);
      for (const s of stale) {
        console.log(`  ${s.emoji} ${s.name}: ${s.detail}`);
      }
    }
    break;
  }
  
  case 'expensive': {
    const expensive = [];
    for (const job of jobs) {
      if (job.enabled === false) continue;
      const cost = estimateCost(job);
      if (cost.dailyCostUsd >= 1) {
        expensive.push({ name: job.name || job.id.slice(0, 8), ...cost });
      }
    }
    
    expensive.sort((a, b) => b.dailyCostUsd - a.dailyCostUsd);
    
    if (expensive.length === 0) {
      if (!flags.quiet) console.log('✅ No jobs costing >$1/day');
    } else {
      console.log(`💰 ${expensive.length} expensive job(s):\n`);
      for (const e of expensive) {
        console.log(`  ${e.name}: $${e.dailyCostUsd}/day ($${e.monthlyCostUsd}/mo) — ${e.model}, ${e.runsPerDay}x/day`);
      }
    }
    break;
  }
  
  case 'help':
  default:
    console.log(`
Cron Fleet Manager — Health monitor for OpenClaw cron jobs

Commands:
  report     Full fleet health report (Telegram-friendly)
  health     Quick health check (exit 1 if problems)
  dupes      Detect duplicate/similar jobs
  cost       Cost breakdown by job
  detail     Full markdown report
  json       Raw JSON report
  list       Simple list of all jobs
  stale      Show only stale/overdue jobs
  expensive  Show jobs costing >$1/day

Options:
  --file <path>    Path to jobs.json (default: ~/.openclaw/cron/jobs.json)
  --output <path>  Write report to file
  --quiet          Suppress output if no issues

Examples:
  cronfleet report                    # Quick fleet overview
  cronfleet health --quiet            # CI/cron health gate
  cronfleet cost                      # See where the money goes
  cronfleet detail --output report.md # Full markdown report
`);
}
