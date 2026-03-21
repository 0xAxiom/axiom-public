#!/usr/bin/env node

/**
 * Check budget status and send alerts if needed
 */

const ModelOptimizer = require('./optimizer');
const https = require('https');

function parseArgs() {
  const args = {};
  for (let i = 2; i < process.argv.length; i += 2) {
    const key = process.argv[i].replace('--', '');
    const value = process.argv[i + 1];
    args[key] = value;
  }
  return args;
}

async function sendWebhook(url, message) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ text: message });
    
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || 443,
      path: urlObj.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': data.length
      }
    };

    const req = https.request(options, (res) => {
      resolve(res.statusCode);
    });

    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function checkBudget() {
  const args = parseArgs();
  const optimizer = new ModelOptimizer();
  
  const periods = ['daily', 'weekly', 'monthly'];
  const alerts = [];
  
  for (const period of periods) {
    const budget = optimizer.checkBudget(period);
    
    console.log(`${period.charAt(0).toUpperCase() + period.slice(1)} Budget:`);
    console.log(`  Spent: $${budget.spent.toFixed(2)}`);
    console.log(`  Budget: $${budget.budget}`);
    console.log(`  Remaining: $${budget.remaining.toFixed(2)}`);
    console.log(`  Utilization: ${budget.utilization.toFixed(1)}%`);
    
    if (budget.over_budget) {
      console.log('  🚨 OVER BUDGET');
      alerts.push(`🚨 ${period} budget EXCEEDED: $${budget.spent.toFixed(2)}/$${budget.budget}`);
    } else if (budget.utilization > 90) {
      console.log('  🟠 Critical usage');
      alerts.push(`⚠️ ${period} budget critical: ${budget.utilization.toFixed(1)}% used`);
    } else if (budget.utilization > 75) {
      console.log('  🟡 High usage');
      alerts.push(`📊 ${period} budget warning: ${budget.utilization.toFixed(1)}% used`);
    } else {
      console.log('  ✅ Normal usage');
    }
    
    console.log();
  }
  
  // Send webhook alerts if configured
  if (args['alert-webhook'] && alerts.length > 0) {
    const message = `AI Model Budget Alert:\n${alerts.join('\n')}`;
    try {
      await sendWebhook(args['alert-webhook'], message);
      console.log('✅ Alert sent to webhook');
    } catch (error) {
      console.error('❌ Failed to send webhook:', error.message);
    }
  }
  
  // Exit with error code if over budget
  const dailyBudget = optimizer.checkBudget('daily');
  if (dailyBudget.over_budget) {
    process.exit(1);
  }
}

checkBudget().catch(console.error);