#!/usr/bin/env node

/**
 * Generate cost reports for AI model usage
 */

const ModelOptimizer = require('./optimizer');

function parseArgs() {
  const args = { period: 'weekly', provider: 'all' };
  for (let i = 2; i < process.argv.length; i += 2) {
    const key = process.argv[i].replace('--', '');
    const value = process.argv[i + 1];
    args[key] = value;
  }
  return args;
}

function formatCurrency(amount) {
  return `$${amount.toFixed(2)}`;
}

function formatPercentage(value) {
  return `${value.toFixed(1)}%`;
}

async function generateReport() {
  const args = parseArgs();
  const optimizer = new ModelOptimizer();
  
  const days = args.period === 'daily' ? 1 : args.period === 'weekly' ? 7 : 30;
  const usage = optimizer.getUsage(days);
  
  if (usage.length === 0) {
    console.log(`No usage data found for the last ${days} days`);
    return;
  }

  const totalSpend = usage.reduce((sum, entry) => sum + (entry.cost || 0), 0);
  const totalCalls = usage.length;

  console.log(`Model Cost Report (Last ${days} Days)`);
  console.log('='.repeat(40));
  console.log(`Total Spend: ${formatCurrency(totalSpend)}`);
  console.log(`Total Calls: ${totalCalls.toLocaleString()}`);
  console.log();

  // By Provider
  const byProvider = {};
  usage.forEach(entry => {
    const provider = entry.provider;
    if (!byProvider[provider]) {
      byProvider[provider] = { cost: 0, calls: 0 };
    }
    byProvider[provider].cost += entry.cost || 0;
    byProvider[provider].calls += 1;
  });

  console.log('By Provider:');
  Object.entries(byProvider)
    .sort((a, b) => b[1].cost - a[1].cost)
    .forEach(([provider, data]) => {
      const percentage = (data.cost / totalSpend) * 100;
      console.log(`- ${provider.padEnd(12)} ${formatCurrency(data.cost).padEnd(8)} (${formatPercentage(percentage)})`);
    });
  console.log();

  // By Model
  const byModel = {};
  usage.forEach(entry => {
    const model = entry.model;
    if (!byModel[model]) {
      byModel[model] = { cost: 0, calls: 0 };
    }
    byModel[model].cost += entry.cost || 0;
    byModel[model].calls += 1;
  });

  console.log('Top Models:');
  Object.entries(byModel)
    .sort((a, b) => b[1].cost - a[1].cost)
    .slice(0, 5)
    .forEach(([model, data], index) => {
      console.log(`${index + 1}. ${model.padEnd(15)} ${formatCurrency(data.cost).padEnd(8)} (${data.calls.toLocaleString()} calls)`);
    });
  console.log();

  // By Task Type
  const byTask = {};
  usage.forEach(entry => {
    const task = entry.task || 'unknown';
    if (!byTask[task]) {
      byTask[task] = { cost: 0, calls: 0 };
    }
    byTask[task].cost += entry.cost || 0;
    byTask[task].calls += 1;
  });

  console.log('By Task Type:');
  Object.entries(byTask)
    .sort((a, b) => b[1].cost - a[1].cost)
    .forEach(([task, data]) => {
      const percentage = (data.cost / totalSpend) * 100;
      console.log(`- ${task.padEnd(15)} ${formatCurrency(data.cost).padEnd(8)} (${formatPercentage(percentage)})`);
    });
  console.log();

  // Efficiency Metrics
  const avgCostPerCall = totalSpend / totalCalls;
  const totalTokens = usage.reduce((sum, entry) => sum + (entry.input_tokens || 0) + (entry.output_tokens || 0), 0);
  const avgTokensPerCall = totalTokens / totalCalls;
  const failedCalls = usage.filter(entry => !entry.success).length;
  const failureRate = (failedCalls / totalCalls) * 100;

  console.log('Efficiency Metrics:');
  console.log(`- Avg cost per call: ${formatCurrency(avgCostPerCall)}`);
  console.log(`- Avg tokens per call: ${avgTokensPerCall.toFixed(0)}`);
  console.log(`- Failed calls: ${formatPercentage(failureRate)}`);
  console.log();

  // Budget Status
  const budget = optimizer.checkBudget(args.period);
  console.log(`Budget Status: ${formatCurrency(budget.remaining)} remaining this ${args.period}`);
  
  if (budget.over_budget) {
    console.log('🚨 OVER BUDGET');
  } else if (budget.utilization > 80) {
    console.log('⚠️  Approaching budget limit');
  }
}

generateReport().catch(console.error);