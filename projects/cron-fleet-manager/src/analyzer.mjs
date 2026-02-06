/**
 * Cron Fleet Analyzer — Core engine for analyzing OpenClaw cron job health.
 * 
 * Reads jobs.json and produces structured analysis:
 * - Job health status (healthy, stale, failing, never-ran)
 * - Duplicate detection (similar names, overlapping schedules)
 * - Cost estimation (based on model + duration)
 * - Schedule visualization
 * - Actionable recommendations
 */

const MODEL_COST_PER_SEC = {
  'anthropic/claude-opus-4-6': 0.015,       // ~$54/hr at full utilization
  'anthropic/claude-sonnet-4-20250514': 0.005,  // ~$18/hr
  'claude-sonnet-4-5-20250514': 0.005,
  'claude-sonnet-4-20250514': 0.005,
  'default': 0.005,                            // assume sonnet if unspecified
};

/**
 * Parse the cron jobs.json file and return structured job data
 */
export function parseJobsFile(jobsData) {
  if (!jobsData || !jobsData.jobs) {
    throw new Error('Invalid jobs.json format — missing "jobs" array');
  }
  return jobsData.jobs;
}

/**
 * Classify a job's health status
 */
export function classifyHealth(job, now = Date.now()) {
  // Disabled check first
  if (job.enabled === false) {
    return {
      status: 'disabled',
      severity: 'info',
      detail: 'Job is disabled',
      emoji: '⏸️',
    };
  }

  const state = job.state || {};
  const { lastRunAtMs, lastStatus, nextRunAtMs, lastDurationMs } = state;

  // Never ran
  if (!lastRunAtMs) {
    return {
      status: 'never-ran',
      severity: 'warning',
      detail: 'Job has never executed',
      emoji: '⚪',
    };
  }

  // Failed last run
  if (lastStatus === 'error' || lastStatus === 'failed') {
    return {
      status: 'failing',
      severity: 'critical',
      detail: `Last run failed with status: ${lastStatus}`,
      emoji: '🔴',
    };
  }

  // Skipped
  if (lastStatus === 'skipped') {
    return {
      status: 'skipped',
      severity: 'warning',
      detail: 'Last run was skipped (possibly concurrent execution)',
      emoji: '🟡',
    };
  }

  // Stale — hasn't run when it should have
  if (nextRunAtMs && nextRunAtMs < now - 3600000) {
    const hoursOverdue = ((now - nextRunAtMs) / 3600000).toFixed(1);
    return {
      status: 'stale',
      severity: 'warning',
      detail: `${hoursOverdue}h overdue (expected at ${new Date(nextRunAtMs).toISOString()})`,
      emoji: '🟠',
    };
  }

  // Long-running (took more than 10 minutes)
  if (lastDurationMs && lastDurationMs > 600000) {
    const mins = (lastDurationMs / 60000).toFixed(1);
    return {
      status: 'slow',
      severity: 'info',
      detail: `Last run took ${mins} minutes`,
      emoji: '🐢',
    };
  }

  // Healthy
  const msSinceRun = now - lastRunAtMs;
  const hoursSince = (msSinceRun / 3600000).toFixed(1);
  return {
    status: 'healthy',
    severity: 'ok',
    detail: `Last ran ${hoursSince}h ago — ${lastStatus}`,
    emoji: '🟢',
  };
}

/**
 * Detect duplicate/similar jobs
 */
export function detectDuplicates(jobs) {
  const dupes = [];
  
  // Check by similar names (Levenshtein-like simple check)
  for (let i = 0; i < jobs.length; i++) {
    for (let j = i + 1; j < jobs.length; j++) {
      const a = jobs[i];
      const b = jobs[j];
      
      // Name similarity
      const nameA = (a.name || '').toLowerCase().replace(/[-_\s]/g, '');
      const nameB = (b.name || '').toLowerCase().replace(/[-_\s]/g, '');
      
      if (nameA === nameB || nameA.includes(nameB) || nameB.includes(nameA)) {
        dupes.push({
          type: 'name-similar',
          jobs: [a.name || a.id, b.name || b.id],
          detail: `Similar names: "${a.name}" ↔ "${b.name}"`,
        });
      }

      // Schedule overlap (same cron expression)
      if (a.schedule?.expr && b.schedule?.expr && a.schedule.expr === b.schedule.expr) {
        dupes.push({
          type: 'schedule-overlap',
          jobs: [a.name || a.id, b.name || b.id],
          detail: `Same schedule: ${a.schedule.expr}`,
        });
      }

      // Same interval — only flag if names are also similar (common intervals are expected)
      if (a.schedule?.everyMs && b.schedule?.everyMs && a.schedule.everyMs === b.schedule.everyMs) {
        // Only flag if names share a word (e.g., "monitor-a" and "monitor-b")
        const wordsA = new Set((a.name || '').toLowerCase().split(/[-_\s]/));
        const wordsB = new Set((b.name || '').toLowerCase().split(/[-_\s]/));
        const shared = [...wordsA].filter(w => w.length > 2 && wordsB.has(w));
        if (shared.length > 0) {
          dupes.push({
            type: 'interval-match',
            jobs: [a.name || a.id, b.name || b.id],
            detail: `Same interval (${formatMs(a.schedule.everyMs)}) + shared terms: ${shared.join(', ')}`,
          });
        }
      }
    }
  }
  
  return dupes;
}

/**
 * Estimate cost per job (daily)
 */
export function estimateCost(job) {
  const state = job.state || {};
  const model = job.payload?.model || 'default';
  const costPerSec = MODEL_COST_PER_SEC[model] || MODEL_COST_PER_SEC['default'];
  const durationSec = (state.lastDurationMs || 30000) / 1000;
  
  // Estimate runs per day
  let runsPerDay = 0;
  const schedule = job.schedule || {};
  
  if (schedule.kind === 'every') {
    runsPerDay = (86400000 / schedule.everyMs);
  } else if (schedule.kind === 'cron') {
    runsPerDay = estimateCronRunsPerDay(schedule.expr);
  } else if (schedule.kind === 'at') {
    runsPerDay = 0; // one-shot
  }

  if (job.enabled === false) runsPerDay = 0;

  const dailyCost = runsPerDay * durationSec * costPerSec;
  
  return {
    model: model === 'default' ? 'sonnet (default)' : model.split('/').pop(),
    durationSec: Math.round(durationSec),
    runsPerDay: Math.round(runsPerDay * 10) / 10,
    dailyCostUsd: Math.round(dailyCost * 100) / 100,
    monthlyCostUsd: Math.round(dailyCost * 30 * 100) / 100,
  };
}

/**
 * Rough estimate of cron expression runs per day
 */
function estimateCronRunsPerDay(expr) {
  if (!expr) return 1;
  const parts = expr.split(' ');
  if (parts.length < 5) return 1;
  
  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
  
  // Count hours
  let hoursPerDay = 1;
  if (hour === '*') {
    hoursPerDay = 24;
  } else if (hour.includes(',')) {
    hoursPerDay = hour.split(',').length;
  } else if (hour.includes('/')) {
    const step = parseInt(hour.split('/')[1]);
    hoursPerDay = Math.floor(24 / step);
  }
  
  // Count minutes per hour
  let minutesPerHour = 1;
  if (minute === '*') {
    minutesPerHour = 60;
  } else if (minute.includes(',')) {
    minutesPerHour = minute.split(',').length;
  } else if (minute.includes('/')) {
    const step = parseInt(minute.split('/')[1]);
    minutesPerHour = Math.floor(60 / step);
  }
  
  let total = hoursPerDay * minutesPerHour;
  
  // Day of week filter
  if (dayOfWeek !== '*') {
    const days = dayOfWeek.includes(',') ? dayOfWeek.split(',').length : 1;
    total = total * (days / 7);
  }
  
  return total;
}

/**
 * Generate schedule summary
 */
export function describeSchedule(schedule) {
  if (!schedule) return 'unknown';
  
  if (schedule.kind === 'every') {
    return `every ${formatMs(schedule.everyMs)}`;
  }
  
  if (schedule.kind === 'cron') {
    return `cron: ${schedule.expr}${schedule.tz ? ` (${schedule.tz})` : ''}`;
  }
  
  if (schedule.kind === 'at') {
    return `once at ${new Date(schedule.at).toISOString()}`;
  }
  
  return JSON.stringify(schedule);
}

/**
 * Generate full fleet report
 */
export function generateReport(jobs, now = Date.now()) {
  const report = {
    timestamp: new Date(now).toISOString(),
    summary: {
      total: jobs.length,
      enabled: 0,
      disabled: 0,
      healthy: 0,
      failing: 0,
      stale: 0,
      neverRan: 0,
      slow: 0,
    },
    jobs: [],
    duplicates: detectDuplicates(jobs),
    costEstimate: {
      dailyTotal: 0,
      monthlyTotal: 0,
      topCostJobs: [],
    },
    recommendations: [],
  };

  const costEntries = [];

  for (const job of jobs) {
    const health = classifyHealth(job, now);
    const cost = estimateCost(job);
    const schedule = describeSchedule(job.schedule);
    
    // Update summary counters
    if (job.enabled === false) {
      report.summary.disabled++;
    } else {
      report.summary.enabled++;
    }
    
    if (health.status === 'healthy') report.summary.healthy++;
    if (health.status === 'failing') report.summary.failing++;
    if (health.status === 'stale') report.summary.stale++;
    if (health.status === 'never-ran') report.summary.neverRan++;
    if (health.status === 'slow') report.summary.slow++;

    const entry = {
      name: job.name || job.id.slice(0, 8),
      id: job.id,
      enabled: job.enabled !== false,
      health,
      schedule,
      cost,
      model: cost.model,
      lastRun: job.state?.lastRunAtMs ? new Date(job.state.lastRunAtMs).toISOString() : 'never',
      nextRun: job.state?.nextRunAtMs ? new Date(job.state.nextRunAtMs).toISOString() : 'unknown',
    };
    
    report.jobs.push(entry);
    
    if (job.enabled !== false) {
      costEntries.push({ name: entry.name, ...cost });
      report.costEstimate.dailyTotal += cost.dailyCostUsd;
      report.costEstimate.monthlyTotal += cost.monthlyCostUsd;
    }
  }

  // Top cost jobs
  report.costEstimate.topCostJobs = costEntries
    .sort((a, b) => b.dailyCostUsd - a.dailyCostUsd)
    .slice(0, 5);

  // Round totals
  report.costEstimate.dailyTotal = Math.round(report.costEstimate.dailyTotal * 100) / 100;
  report.costEstimate.monthlyTotal = Math.round(report.costEstimate.monthlyTotal * 100) / 100;

  // Generate recommendations
  report.recommendations = generateRecommendations(report, jobs, now);

  return report;
}

/**
 * Generate actionable recommendations
 */
function generateRecommendations(report, jobs, now) {
  const recs = [];
  
  // Failing jobs
  const failingJobs = report.jobs.filter(j => j.health.status === 'failing');
  if (failingJobs.length > 0) {
    recs.push({
      severity: 'critical',
      title: `${failingJobs.length} job(s) failing`,
      detail: failingJobs.map(j => j.name).join(', '),
      action: 'Check logs and fix root cause, or disable if no longer needed',
    });
  }

  // Stale jobs
  const staleJobs = report.jobs.filter(j => j.health.status === 'stale');
  if (staleJobs.length > 0) {
    recs.push({
      severity: 'warning',
      title: `${staleJobs.length} job(s) overdue`,
      detail: staleJobs.map(j => `${j.name}: ${j.health.detail}`).join('; '),
      action: 'Jobs may have stalled or gateway was down when they were scheduled',
    });
  }

  // Never-ran jobs
  const neverRan = report.jobs.filter(j => j.health.status === 'never-ran' && j.enabled);
  if (neverRan.length > 0) {
    recs.push({
      severity: 'warning',
      title: `${neverRan.length} enabled job(s) never ran`,
      detail: neverRan.map(j => j.name).join(', '),
      action: 'Check schedule configuration or trigger manually',
    });
  }

  // Duplicates
  if (report.duplicates.length > 0) {
    recs.push({
      severity: 'info',
      title: `${report.duplicates.length} potential duplicate(s) detected`,
      detail: report.duplicates.map(d => d.detail).join('; '),
      action: 'Review and consolidate if they serve the same purpose',
    });
  }

  // High-cost jobs
  const expensiveJobs = report.costEstimate.topCostJobs.filter(j => j.dailyCostUsd > 1);
  if (expensiveJobs.length > 0) {
    recs.push({
      severity: 'info',
      title: `${expensiveJobs.length} job(s) costing >$1/day`,
      detail: expensiveJobs.map(j => `${j.name}: ~$${j.dailyCostUsd}/day`).join(', '),
      action: 'Consider switching to cheaper model or reducing frequency',
    });
  }

  // Slow jobs
  const slowJobs = report.jobs.filter(j => j.health.status === 'slow');
  if (slowJobs.length > 0) {
    recs.push({
      severity: 'info',
      title: `${slowJobs.length} job(s) taking >10 minutes`,
      detail: slowJobs.map(j => `${j.name}: ${j.health.detail}`).join('; '),
      action: 'Consider splitting into smaller tasks or increasing timeout',
    });
  }

  // Disabled jobs that might be stale
  const disabled = jobs.filter(j => j.enabled === false);
  if (disabled.length > 3) {
    recs.push({
      severity: 'info',
      title: `${disabled.length} disabled jobs — consider cleanup`,
      detail: disabled.map(j => j.name || j.id.slice(0, 8)).join(', '),
      action: 'Remove jobs that will never be re-enabled to reduce clutter',
    });
  }

  return recs;
}

/**
 * Format a report as a clean text summary for Telegram
 */
export function formatTelegramReport(report) {
  const lines = [];
  
  lines.push(`📊 Cron Fleet Report`);
  lines.push(`${report.timestamp.split('T')[0]}`);
  lines.push('');
  
  // Summary
  const s = report.summary;
  lines.push(`Fleet: ${s.total} jobs (${s.enabled} active, ${s.disabled} disabled)`);
  lines.push(`🟢 ${s.healthy} healthy  🔴 ${s.failing} failing  🟠 ${s.stale} stale  🐢 ${s.slow} slow  ⚪ ${s.neverRan} never-ran`);
  lines.push('');
  
  // Problem jobs
  const problems = report.jobs.filter(j => 
    j.health.severity === 'critical' || j.health.severity === 'warning'
  );
  
  if (problems.length > 0) {
    lines.push(`⚠️ Issues:`);
    for (const j of problems) {
      lines.push(`  ${j.health.emoji} ${j.name}: ${j.health.detail}`);
    }
    lines.push('');
  }
  
  // Cost
  const c = report.costEstimate;
  lines.push(`💰 Estimated cost: ~$${c.dailyTotal}/day (~$${c.monthlyTotal}/mo)`);
  if (c.topCostJobs.length > 0) {
    lines.push(`Top spenders:`);
    for (const j of c.topCostJobs.slice(0, 3)) {
      lines.push(`  ${j.name}: $${j.dailyCostUsd}/day (${j.model}, ${j.runsPerDay}x/day, ~${j.durationSec}s each)`);
    }
  }
  lines.push('');
  
  // Duplicates
  if (report.duplicates.length > 0) {
    lines.push(`🔄 Duplicates: ${report.duplicates.length} found`);
    for (const d of report.duplicates) {
      lines.push(`  ${d.detail}`);
    }
    lines.push('');
  }
  
  // Recommendations
  if (report.recommendations.length > 0) {
    lines.push(`💡 Recommendations:`);
    for (const r of report.recommendations) {
      const icon = r.severity === 'critical' ? '🚨' : r.severity === 'warning' ? '⚠️' : '💡';
      lines.push(`  ${icon} ${r.title}`);
      lines.push(`     → ${r.action}`);
    }
  }
  
  return lines.join('\n');
}

/**
 * Format as full detailed report (for file output)
 */
export function formatDetailedReport(report) {
  const lines = [];
  
  lines.push('# Cron Fleet Health Report');
  lines.push(`Generated: ${report.timestamp}`);
  lines.push('');
  
  // Summary table
  lines.push('## Summary');
  const s = report.summary;
  lines.push(`| Metric | Count |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Total Jobs | ${s.total} |`);
  lines.push(`| Enabled | ${s.enabled} |`);
  lines.push(`| Disabled | ${s.disabled} |`);
  lines.push(`| Healthy | ${s.healthy} |`);
  lines.push(`| Failing | ${s.failing} |`);
  lines.push(`| Stale/Overdue | ${s.stale} |`);
  lines.push(`| Slow (>10m) | ${s.slow} |`);
  lines.push(`| Never Ran | ${s.neverRan} |`);
  lines.push('');
  
  // All jobs
  lines.push('## Jobs');
  lines.push('');
  
  // Sort: problems first, then by name
  const sorted = [...report.jobs].sort((a, b) => {
    const severityOrder = { critical: 0, warning: 1, info: 2, ok: 3 };
    const sa = severityOrder[a.health.severity] ?? 3;
    const sb = severityOrder[b.health.severity] ?? 3;
    if (sa !== sb) return sa - sb;
    return a.name.localeCompare(b.name);
  });
  
  for (const j of sorted) {
    lines.push(`### ${j.health.emoji} ${j.name}`);
    lines.push(`- **Status:** ${j.health.status} — ${j.health.detail}`);
    lines.push(`- **Enabled:** ${j.enabled ? 'yes' : 'no'}`);
    lines.push(`- **Schedule:** ${j.schedule}`);
    lines.push(`- **Model:** ${j.model}`);
    lines.push(`- **Last Run:** ${j.lastRun}`);
    lines.push(`- **Next Run:** ${j.nextRun}`);
    lines.push(`- **Cost:** ~$${j.cost.dailyCostUsd}/day ($${j.cost.monthlyCostUsd}/mo) — ${j.cost.runsPerDay}x/day × ${j.cost.durationSec}s`);
    lines.push('');
  }
  
  // Cost breakdown
  lines.push('## Cost Estimate');
  lines.push(`**Daily total:** ~$${report.costEstimate.dailyTotal}`);
  lines.push(`**Monthly total:** ~$${report.costEstimate.monthlyTotal}`);
  lines.push('');
  
  if (report.costEstimate.topCostJobs.length > 0) {
    lines.push('### Top Spenders');
    lines.push('| Job | Model | Runs/Day | Duration | Daily Cost |');
    lines.push('|-----|-------|----------|----------|------------|');
    for (const j of report.costEstimate.topCostJobs) {
      lines.push(`| ${j.name} | ${j.model} | ${j.runsPerDay} | ${j.durationSec}s | $${j.dailyCostUsd} |`);
    }
    lines.push('');
  }
  
  // Duplicates
  if (report.duplicates.length > 0) {
    lines.push('## Potential Duplicates');
    for (const d of report.duplicates) {
      lines.push(`- **${d.type}:** ${d.detail} (${d.jobs.join(' ↔ ')})`);
    }
    lines.push('');
  }
  
  // Recommendations
  if (report.recommendations.length > 0) {
    lines.push('## Recommendations');
    for (const r of report.recommendations) {
      const icon = r.severity === 'critical' ? '🚨' : r.severity === 'warning' ? '⚠️' : '💡';
      lines.push(`### ${icon} ${r.title}`);
      lines.push(r.detail);
      lines.push(`**Action:** ${r.action}`);
      lines.push('');
    }
  }
  
  return lines.join('\n');
}

/**
 * Format milliseconds to human-readable
 */
export function formatMs(ms) {
  if (ms < 60000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3600000) return `${Math.round(ms / 60000)}m`;
  if (ms < 86400000) return `${(ms / 3600000).toFixed(1)}h`;
  return `${(ms / 86400000).toFixed(1)}d`;
}
