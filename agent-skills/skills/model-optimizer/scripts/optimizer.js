#!/usr/bin/env node

/**
 * Model Optimizer - Core optimization logic
 * Pure Node.js, no dependencies
 */

const fs = require('fs');
const path = require('path');

class ModelOptimizer {
  constructor() {
    this.skillDir = path.dirname(__dirname);
    this.dataDir = path.join(this.skillDir, 'data');
    this.configDir = path.join(this.skillDir, 'config');
    this.ensureDirectories();
  }

  ensureDirectories() {
    [this.dataDir, this.configDir].forEach(dir => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    });
  }

  loadConfig() {
    const configPath = path.join(this.configDir, 'models.json');
    if (!fs.existsSync(configPath)) {
      return this.getDefaultConfig();
    }
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  }

  getDefaultConfig() {
    return {
      providers: {
        openai: {
          models: {
            'gpt-4': {
              input_cost: 0.03, output_cost: 0.06, context_limit: 8192,
              strengths: ['reasoning', 'code'], latency_avg: 2000
            },
            'gpt-3.5-turbo': {
              input_cost: 0.0015, output_cost: 0.002, context_limit: 4096,
              strengths: ['speed', 'cost'], latency_avg: 800
            }
          }
        },
        anthropic: {
          models: {
            'claude-3-opus': {
              input_cost: 0.015, output_cost: 0.075, context_limit: 200000,
              strengths: ['analysis', 'long-context'], latency_avg: 3000
            }
          }
        }
      },
      budgets: { daily: 10.0, weekly: 50.0, monthly: 200.0 },
      task_profiles: {
        'code-generation': {
          priority: 'quality', max_cost: 0.05,
          preferred_providers: ['openai', 'anthropic']
        },
        'summarization': {
          priority: 'speed', max_cost: 0.01,
          preferred_providers: ['openai', 'local']
        }
      }
    };
  }

  async recommend(taskType, options = {}) {
    const config = this.loadConfig();
    const profile = config.task_profiles[taskType] || {
      priority: 'balanced', max_cost: 0.02, preferred_providers: ['openai']
    };

    const candidates = [];
    
    for (const [provider, providerData] of Object.entries(config.providers)) {
      for (const [model, modelData] of Object.entries(providerData.models)) {
        if (profile.preferred_providers.includes(provider)) {
          const score = this.calculateScore(modelData, profile, options);
          candidates.push({
            provider, model, score,
            estimated_cost: this.estimateCost(modelData, options.tokens || 1000),
            ...modelData
          });
        }
      }
    }

    candidates.sort((a, b) => b.score - a.score);
    return candidates[0] || null;
  }

  calculateScore(modelData, profile, options) {
    let score = 0;

    // Cost factor
    const estimatedCost = this.estimateCost(modelData, options.tokens || 1000);
    if (estimatedCost <= profile.max_cost) {
      score += 40 * (1 - estimatedCost / profile.max_cost);
    }

    // Speed factor  
    if (profile.priority === 'speed') {
      score += 30 * (1 - modelData.latency_avg / 5000);
    }

    // Quality factor
    if (profile.priority === 'quality') {
      score += 30 * (modelData.input_cost + modelData.output_cost);
    }

    // Context limit factor
    if (options.tokens > modelData.context_limit * 0.8) {
      score *= 0.5; // Heavy penalty for near-limit usage
    }

    return score;
  }

  estimateCost(modelData, tokens) {
    const inputTokens = tokens * 0.7; // Assume 70% input, 30% output
    const outputTokens = tokens * 0.3;
    return (inputTokens * modelData.input_cost + outputTokens * modelData.output_cost) / 1000;
  }

  async logUsage(recommendation, result) {
    const usage = {
      timestamp: Date.now(),
      provider: recommendation.provider,
      model: recommendation.model,
      input_tokens: result.input_tokens || 0,
      output_tokens: result.output_tokens || 0,
      cost: result.cost || recommendation.estimated_cost,
      latency: result.latency || 0,
      success: result.success !== false,
      task: result.task || 'unknown'
    };

    const usagePath = path.join(this.dataDir, 'usage.jsonl');
    fs.appendFileSync(usagePath, JSON.stringify(usage) + '\n');
  }

  getUsage(days = 7) {
    const usagePath = path.join(this.dataDir, 'usage.jsonl');
    if (!fs.existsSync(usagePath)) return [];

    const cutoff = Date.now() - (days * 24 * 60 * 60 * 1000);
    const lines = fs.readFileSync(usagePath, 'utf8').trim().split('\n');
    
    return lines
      .filter(line => line.trim())
      .map(line => JSON.parse(line))
      .filter(entry => entry.timestamp >= cutoff);
  }

  getCurrentSpend(period = 'daily') {
    const days = period === 'daily' ? 1 : period === 'weekly' ? 7 : 30;
    const usage = this.getUsage(days);
    return usage.reduce((sum, entry) => sum + (entry.cost || 0), 0);
  }

  checkBudget(period = 'daily') {
    const config = this.loadConfig();
    const spend = this.getCurrentSpend(period);
    const budget = config.budgets[period] || 10;
    
    return {
      period,
      spent: spend,
      budget: budget,
      remaining: budget - spend,
      utilization: (spend / budget) * 100,
      over_budget: spend > budget
    };
  }
}

// CLI interface
if (require.main === module) {
  const optimizer = new ModelOptimizer();
  const command = process.argv[2];

  switch (command) {
    case 'recommend': {
      const task = process.argv[3] || 'general';
      optimizer.recommend(task).then(result => {
        console.log(JSON.stringify(result, null, 2));
      });
      break;
    }
    case 'budget': {
      const period = process.argv[3] || 'daily';
      const status = optimizer.checkBudget(period);
      console.log(JSON.stringify(status, null, 2));
      break;
    }
    default:
      console.log('Usage: node optimizer.js [recommend|budget] [args...]');
  }
}

module.exports = ModelOptimizer;