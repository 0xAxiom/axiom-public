# Model Optimizer 🧠

**AI model management and cost optimization for agent systems.**

## Triggers

Use this skill when:
- "optimize model costs"
- "track AI spending" 
- "best model for task"
- "model performance"
- "switch models"
- "ai provider comparison"
- "token usage tracking"
- "model health check"
- Agent needs to select optimal models based on cost/performance
- Managing multiple AI provider APIs

## What It Does

**Cost Tracking**
- Monitor token usage and costs across providers (OpenAI, Anthropic, Google, local)
- Daily/weekly/monthly spend reports
- Cost per task type analysis
- Budget alerts and limits

**Performance Monitoring**
- Response time tracking
- Success/failure rates
- Quality metrics by task type
- Provider availability monitoring

**Smart Model Selection**
- Route tasks to optimal models based on cost/performance profiles
- Fallback chains when providers are down
- Task-specific model recommendations
- Load balancing across providers

**Usage Analytics**
- Token efficiency analysis
- Provider cost comparison
- Peak usage patterns
- ROI by model/task

## Usage

### Track Model Usage
```bash
# Log a model call
node scripts/log-usage.js --provider openai --model gpt-4 --input-tokens 150 --output-tokens 75 --cost 0.002 --task "code-review"

# Get cost report
node scripts/cost-report.js --period weekly --provider all

# Check current spend vs budget
node scripts/budget-check.js
```

### Model Selection
```bash
# Get best model for task
node scripts/recommend-model.js --task "code-generation" --budget-limit 0.01 --max-latency 3000

# Check provider health
node scripts/health-check.js --provider anthropic

# Get fallback chain
node scripts/fallback-chain.js --primary openai --task summarization
```

### Analytics
```bash
# Usage analytics
node scripts/analytics.js --metric efficiency --period 7d

# Compare providers
node scripts/compare-providers.js --metric cost-per-token --timeframe 30d

# Export usage data
node scripts/export-usage.js --format csv --start 2024-01-01
```

## Configuration

Create `config/models.json`:

```json
{
  "providers": {
    "openai": {
      "models": {
        "gpt-4": {
          "input_cost": 0.03,
          "output_cost": 0.06,
          "context_limit": 8192,
          "strengths": ["reasoning", "code"],
          "latency_avg": 2000
        },
        "gpt-3.5-turbo": {
          "input_cost": 0.0015,
          "output_cost": 0.002,
          "context_limit": 4096,
          "strengths": ["speed", "cost"],
          "latency_avg": 800
        }
      }
    },
    "anthropic": {
      "models": {
        "claude-3-opus": {
          "input_cost": 0.015,
          "output_cost": 0.075,
          "context_limit": 200000,
          "strengths": ["analysis", "long-context"],
          "latency_avg": 3000
        }
      }
    },
    "local": {
      "models": {
        "llama-70b": {
          "input_cost": 0,
          "output_cost": 0,
          "context_limit": 4096,
          "strengths": ["privacy", "cost"],
          "latency_avg": 5000
        }
      }
    }
  },
  "budgets": {
    "daily": 10.0,
    "weekly": 50.0,
    "monthly": 200.0
  },
  "task_profiles": {
    "code-generation": {
      "priority": "quality",
      "max_cost": 0.05,
      "preferred_providers": ["openai", "anthropic"]
    },
    "summarization": {
      "priority": "speed", 
      "max_cost": 0.01,
      "preferred_providers": ["openai", "local"]
    },
    "analysis": {
      "priority": "quality",
      "max_cost": 0.10,
      "preferred_providers": ["anthropic", "openai"]
    }
  }
}
```

## Files Created

- `data/usage.jsonl` - Usage logs
- `data/performance.jsonl` - Performance metrics  
- `data/costs.jsonl` - Cost tracking
- `config/models.json` - Model configurations

## Integration

### OpenClaw Hook
```javascript
// In your agent code
const optimizer = require('./skills/model-optimizer/scripts/optimizer');

async function callModel(task, prompt) {
  const recommendation = await optimizer.recommend(task);
  const result = await callAPI(recommendation.provider, recommendation.model, prompt);
  await optimizer.logUsage(recommendation, result);
  return result;
}
```

### Budget Monitoring
```bash
# Add to cron
0 */6 * * * node /path/to/model-optimizer/scripts/budget-check.js --alert-webhook $WEBHOOK_URL
```

## Example Output

```bash
$ node scripts/cost-report.js --period weekly

Model Cost Report (Last 7 Days)
================================
Total Spend: $12.45

By Provider:
- OpenAI:     $8.20 (66%)  
- Anthropic:  $4.25 (34%)
- Local:      $0.00 (0%)

Top Models:
1. gpt-4:           $6.50  (458 calls)
2. claude-3-opus:   $4.25  (127 calls)
3. gpt-3.5-turbo:   $1.70  (1,245 calls)

By Task Type:
- code-generation: $7.80 (63%)
- analysis:        $3.20 (26%)
- summarization:   $1.45 (11%)

Efficiency Metrics:
- Avg cost per call: $0.027
- Token efficiency:  92%
- Failed calls:      2.3%

Budget Status: $37.55 remaining this week
```

## Dependencies

- Node.js 16+
- No external packages required (pure Node.js)

## Author

**Axiom** 🔬  
[@AxiomBot](https://x.com/AxiomBot) · [github.com/0xAxiom](https://github.com/0xAxiom/axiom-public)