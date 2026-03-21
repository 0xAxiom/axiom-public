#!/usr/bin/env node

/**
 * Recommend optimal model for a given task
 */

const ModelOptimizer = require('./optimizer');

function parseArgs() {
  const args = {};
  for (let i = 2; i < process.argv.length; i += 2) {
    const key = process.argv[i].replace('--', '');
    let value = process.argv[i + 1];
    
    if (key === 'budget-limit' || key === 'max-latency' || key === 'tokens') {
      value = parseFloat(value);
    }
    
    args[key] = value;
  }
  return args;
}

async function recommendModel() {
  const args = parseArgs();
  
  if (!args.task) {
    console.error('Usage: node recommend-model.js --task code-generation [--budget-limit 0.01] [--max-latency 3000] [--tokens 1000]');
    process.exit(1);
  }

  const optimizer = new ModelOptimizer();
  
  const options = {
    tokens: args.tokens || 1000,
    maxLatency: args['max-latency'],
    budgetLimit: args['budget-limit']
  };

  const recommendation = await optimizer.recommend(args.task, options);
  
  if (!recommendation) {
    console.log('❌ No suitable model found for the given constraints');
    return;
  }

  console.log('🤖 Model Recommendation');
  console.log('='.repeat(25));
  console.log(`Task: ${args.task}`);
  console.log(`Provider: ${recommendation.provider}`);
  console.log(`Model: ${recommendation.model}`);
  console.log(`Estimated Cost: $${recommendation.estimated_cost.toFixed(4)}`);
  console.log(`Avg Latency: ${recommendation.latency_avg}ms`);
  console.log(`Score: ${recommendation.score.toFixed(1)}/100`);
  console.log(`Context Limit: ${recommendation.context_limit.toLocaleString()} tokens`);
  console.log(`Strengths: ${recommendation.strengths.join(', ')}`);
  
  // Check budget
  if (options.budgetLimit && recommendation.estimated_cost > options.budgetLimit) {
    console.log('⚠️  Cost exceeds budget limit');
  }
  
  if (options.maxLatency && recommendation.latency_avg > options.maxLatency) {
    console.log('⚠️  Latency exceeds maximum');
  }
  
  // Check current budget status
  const budget = optimizer.checkBudget('daily');
  const newTotal = budget.spent + recommendation.estimated_cost;
  
  if (newTotal > budget.budget) {
    console.log('🚨 This call would exceed daily budget');
    console.log(`Current: $${budget.spent.toFixed(2)}/$${budget.budget}`);
    console.log(`After call: $${newTotal.toFixed(2)}/$${budget.budget}`);
  }

  // Output JSON for programmatic use
  if (args.json) {
    console.log('\n' + JSON.stringify(recommendation, null, 2));
  }
}

recommendModel().catch(console.error);