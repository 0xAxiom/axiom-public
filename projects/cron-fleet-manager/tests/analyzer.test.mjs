import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseJobsFile,
  classifyHealth,
  detectDuplicates,
  estimateCost,
  describeSchedule,
  generateReport,
  formatTelegramReport,
  formatDetailedReport,
  formatMs,
} from '../src/analyzer.mjs';

// Helper: create a minimal job
function makeJob(overrides = {}) {
  return {
    id: 'test-job-' + Math.random().toString(36).slice(2, 8),
    name: 'test-job',
    enabled: true,
    schedule: { kind: 'every', everyMs: 3600000 },
    payload: { kind: 'agentTurn', message: 'test' },
    state: {
      lastRunAtMs: Date.now() - 1800000, // 30 min ago
      lastStatus: 'ok',
      lastDurationMs: 30000,
      nextRunAtMs: Date.now() + 1800000, // 30 min from now
    },
    ...overrides,
  };
}

describe('parseJobsFile', () => {
  it('parses valid jobs data', () => {
    const jobs = parseJobsFile({ version: 1, jobs: [makeJob()] });
    assert.equal(jobs.length, 1);
  });

  it('throws on missing jobs array', () => {
    assert.throws(() => parseJobsFile({}), /missing "jobs" array/);
  });

  it('throws on null input', () => {
    assert.throws(() => parseJobsFile(null), /Invalid/);
  });
});

describe('classifyHealth', () => {
  const now = Date.now();

  it('classifies healthy job', () => {
    const job = makeJob();
    const health = classifyHealth(job, now);
    assert.equal(health.status, 'healthy');
    assert.equal(health.severity, 'ok');
    assert.equal(health.emoji, '🟢');
  });

  it('classifies never-ran job', () => {
    const job = makeJob({ state: {} });
    const health = classifyHealth(job, now);
    assert.equal(health.status, 'never-ran');
    assert.equal(health.severity, 'warning');
  });

  it('classifies failing job', () => {
    const job = makeJob({
      state: { lastRunAtMs: now - 60000, lastStatus: 'error' }
    });
    const health = classifyHealth(job, now);
    assert.equal(health.status, 'failing');
    assert.equal(health.severity, 'critical');
    assert.equal(health.emoji, '🔴');
  });

  it('classifies skipped job', () => {
    const job = makeJob({
      state: { lastRunAtMs: now - 60000, lastStatus: 'skipped', nextRunAtMs: now + 3600000 }
    });
    const health = classifyHealth(job, now);
    assert.equal(health.status, 'skipped');
    assert.equal(health.severity, 'warning');
  });

  it('classifies stale job (overdue by >1h)', () => {
    const job = makeJob({
      state: {
        lastRunAtMs: now - 7200000, // 2h ago
        lastStatus: 'ok',
        nextRunAtMs: now - 3700000, // 1h+ overdue
      }
    });
    const health = classifyHealth(job, now);
    assert.equal(health.status, 'stale');
    assert.equal(health.severity, 'warning');
    assert.equal(health.emoji, '🟠');
  });

  it('classifies slow job (>10min duration)', () => {
    const job = makeJob({
      state: {
        lastRunAtMs: now - 60000,
        lastStatus: 'ok',
        lastDurationMs: 900000, // 15 minutes
        nextRunAtMs: now + 3600000,
      }
    });
    const health = classifyHealth(job, now);
    assert.equal(health.status, 'slow');
    assert.equal(health.emoji, '🐢');
  });

  it('classifies disabled job', () => {
    const job = makeJob({ enabled: false, state: {} });
    const health = classifyHealth(job, now);
    assert.equal(health.status, 'disabled');
  });
});

describe('detectDuplicates', () => {
  it('finds name-similar duplicates', () => {
    const jobs = [
      makeJob({ name: 'daily-report' }),
      makeJob({ name: 'daily-report-2' }),
    ];
    const dupes = detectDuplicates(jobs);
    assert.ok(dupes.length > 0);
    assert.equal(dupes[0].type, 'name-similar');
  });

  it('finds schedule-overlap duplicates', () => {
    const jobs = [
      makeJob({ name: 'job-a', schedule: { kind: 'cron', expr: '0 9 * * *' } }),
      makeJob({ name: 'job-b', schedule: { kind: 'cron', expr: '0 9 * * *' } }),
    ];
    const dupes = detectDuplicates(jobs);
    const schedDupes = dupes.filter(d => d.type === 'schedule-overlap');
    assert.ok(schedDupes.length > 0);
  });

  it('finds interval-match duplicates', () => {
    const jobs = [
      makeJob({ name: 'monitor-a', schedule: { kind: 'every', everyMs: 1800000 } }),
      makeJob({ name: 'monitor-b', schedule: { kind: 'every', everyMs: 1800000 } }),
    ];
    const dupes = detectDuplicates(jobs);
    const intDupes = dupes.filter(d => d.type === 'interval-match');
    assert.ok(intDupes.length > 0);
  });

  it('returns empty for unique jobs', () => {
    const jobs = [
      makeJob({ name: 'alpha', schedule: { kind: 'cron', expr: '0 9 * * *' } }),
      makeJob({ name: 'beta', schedule: { kind: 'every', everyMs: 7200000 } }),
    ];
    const dupes = detectDuplicates(jobs);
    assert.equal(dupes.length, 0);
  });
});

describe('estimateCost', () => {
  it('estimates cost for interval job', () => {
    const job = makeJob({
      schedule: { kind: 'every', everyMs: 3600000 },
      payload: { kind: 'agentTurn', model: 'anthropic/claude-opus-4-6' },
      state: { lastDurationMs: 60000 },
    });
    const cost = estimateCost(job);
    assert.equal(cost.runsPerDay, 24);
    assert.equal(cost.durationSec, 60);
    assert.ok(cost.dailyCostUsd > 0);
    assert.ok(cost.monthlyCostUsd > cost.dailyCostUsd);
  });

  it('estimates zero cost for disabled job', () => {
    const job = makeJob({ enabled: false });
    const cost = estimateCost(job);
    assert.equal(cost.dailyCostUsd, 0);
  });

  it('uses default model cost when unspecified', () => {
    const job = makeJob({
      payload: { kind: 'agentTurn', message: 'test' },
    });
    const cost = estimateCost(job);
    assert.equal(cost.model, 'sonnet (default)');
  });

  it('estimates cron schedule runs', () => {
    const job = makeJob({
      schedule: { kind: 'cron', expr: '0 9,12,15,18,21 * * *' },
      state: { lastDurationMs: 120000 },
    });
    const cost = estimateCost(job);
    assert.equal(cost.runsPerDay, 5);
  });
});

describe('describeSchedule', () => {
  it('describes interval schedule', () => {
    const desc = describeSchedule({ kind: 'every', everyMs: 1800000 });
    assert.equal(desc, 'every 30m');
  });

  it('describes cron schedule', () => {
    const desc = describeSchedule({ kind: 'cron', expr: '0 9 * * *', tz: 'America/Los_Angeles' });
    assert.ok(desc.includes('0 9 * * *'));
    assert.ok(desc.includes('America/Los_Angeles'));
  });

  it('describes one-shot schedule', () => {
    const desc = describeSchedule({ kind: 'at', at: '2026-02-06T12:00:00Z' });
    assert.ok(desc.includes('once'));
  });

  it('handles unknown schedule', () => {
    const desc = describeSchedule(null);
    assert.equal(desc, 'unknown');
  });
});

describe('generateReport', () => {
  it('generates complete report', () => {
    const jobs = [
      makeJob({ name: 'healthy-job' }),
      makeJob({ name: 'failing-job', state: { lastRunAtMs: Date.now() - 60000, lastStatus: 'error' } }),
      makeJob({ name: 'disabled-job', enabled: false }),
    ];
    const report = generateReport(jobs);
    
    assert.equal(report.summary.total, 3);
    assert.equal(report.summary.enabled, 2);
    assert.equal(report.summary.disabled, 1);
    assert.equal(report.summary.failing, 1);
    assert.ok(report.recommendations.length > 0);
    assert.ok(report.jobs.length === 3);
  });

  it('calculates cost totals', () => {
    const jobs = [
      makeJob({ name: 'job-1', state: { lastDurationMs: 60000, lastRunAtMs: Date.now() - 1000, lastStatus: 'ok', nextRunAtMs: Date.now() + 3600000 } }),
      makeJob({ name: 'job-2', state: { lastDurationMs: 120000, lastRunAtMs: Date.now() - 1000, lastStatus: 'ok', nextRunAtMs: Date.now() + 3600000 } }),
    ];
    const report = generateReport(jobs);
    assert.ok(report.costEstimate.dailyTotal > 0);
    assert.ok(report.costEstimate.monthlyTotal > 0);
    assert.ok(report.costEstimate.topCostJobs.length > 0);
  });

  it('generates recommendations for problems', () => {
    const jobs = [
      makeJob({ name: 'fail-1', state: { lastRunAtMs: Date.now() - 60000, lastStatus: 'error' } }),
      makeJob({ name: 'fail-2', state: { lastRunAtMs: Date.now() - 60000, lastStatus: 'error' } }),
    ];
    const report = generateReport(jobs);
    const failRec = report.recommendations.find(r => r.title.includes('failing'));
    assert.ok(failRec);
    assert.equal(failRec.severity, 'critical');
  });
});

describe('formatTelegramReport', () => {
  it('formats report as text', () => {
    const jobs = [makeJob({ name: 'test-job' })];
    const report = generateReport(jobs);
    const text = formatTelegramReport(report);
    
    assert.ok(text.includes('Cron Fleet Report'));
    assert.ok(text.includes('Fleet:'));
    assert.ok(text.includes('Estimated cost'));
  });

  it('includes problem jobs in output', () => {
    const jobs = [
      makeJob({ name: 'broken', state: { lastRunAtMs: Date.now() - 60000, lastStatus: 'error' } }),
    ];
    const report = generateReport(jobs);
    const text = formatTelegramReport(report);
    assert.ok(text.includes('broken'));
    assert.ok(text.includes('Issues'));
  });
});

describe('formatDetailedReport', () => {
  it('formats as markdown', () => {
    const jobs = [makeJob({ name: 'test-job' })];
    const report = generateReport(jobs);
    const md = formatDetailedReport(report);
    
    assert.ok(md.includes('# Cron Fleet Health Report'));
    assert.ok(md.includes('## Summary'));
    assert.ok(md.includes('## Jobs'));
    assert.ok(md.includes('test-job'));
  });
});

describe('formatMs', () => {
  it('formats seconds', () => assert.equal(formatMs(30000), '30s'));
  it('formats minutes', () => assert.equal(formatMs(180000), '3m'));
  it('formats hours', () => assert.equal(formatMs(7200000), '2.0h'));
  it('formats days', () => assert.equal(formatMs(172800000), '2.0d'));
});

describe('integration: real jobs.json', () => {
  it('loads and analyzes real jobs file if available', async () => {
    const { readFileSync, existsSync } = await import('fs');
    const { join } = await import('path');
    const { homedir } = await import('os');
    
    const jobsPath = join(homedir(), '.openclaw', 'cron', 'jobs.json');
    if (!existsSync(jobsPath)) {
      console.log('  (skipped — no real jobs.json found)');
      return;
    }
    
    const raw = readFileSync(jobsPath, 'utf-8');
    const data = JSON.parse(raw);
    const jobs = parseJobsFile(data);
    
    assert.ok(jobs.length > 0, 'Should have at least 1 job');
    
    const report = generateReport(jobs);
    assert.ok(report.summary.total === jobs.length);
    
    const text = formatTelegramReport(report);
    assert.ok(text.length > 50, 'Report should have content');
    
    console.log(`  (analyzed ${jobs.length} real jobs)`);
  });
});
