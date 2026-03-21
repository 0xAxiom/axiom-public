#!/usr/bin/env node

/**
 * Log AI model usage for cost tracking and optimization
 */

const ModelOptimizer = require('./optimizer');

function parseArgs() {
  const args = {};
  for (let i = 2; i < process.argv.length; i += 2) {
    const key = process.argv[i].replace('--', '');
    const value = process.argv[i + 1];
    args[key] = isNaN(value) ? value : parseFloat(value);
  }
  return args;
}

async function logUsage() {
  const args = parseArgs();
  
  if (!args.provider || !args.model) {
    console.error('Usage: node log-usage.js --provider openai --model gpt-4 --input-tokens 150 --output-tokens 75 --cost 0.002 [--task code-review] [--latency 1200]');
    process.exit(1);
  }

  const optimizer = new ModelOptimizer();
  
  const recommendation = {
    provider: args.provider,
    model: args.model
  };

  const result = {
    input_tokens: args['input-tokens'] || 0,
    output_tokens: args['output-tokens'] || 0,
    cost: args.cost || 0,
    latency: args.latency || 0,
    task: args.task || 'manual',
    success: true
  };

  await optimizer.logUsage(recommendation, result);
  
  console.log('✅ Usage logged successfully');
  console.log(`Provider: ${args.provider}`);
  console.log(`Model: ${args.model}`);
  console.log(`Tokens: ${result.input_tokens + result.output_tokens}`);
  console.log(`Cost: $${result.cost.toFixed(4)}`);
  
  // Show budget status
  const budget = optimizer.checkBudget('daily');
  console.log(`\nDaily budget: $${budget.spent.toFixed(2)}/$${budget.budget} (${budget.utilization.toFixed(1)}%)`);
  
  if (budget.over_budget) {
    console.log('⚠️  OVER BUDGET');
  } else if (budget.utilization > 80) {
    console.log('⚠️  Approaching budget limit');
  }
}

logUsage().catch(console.error);