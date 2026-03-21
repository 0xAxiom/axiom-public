# Model Optimizer 🧠

**AI model management and cost optimization for agent systems.**

## Overview

The Model Optimizer skill helps AI agents manage costs, track performance, and automatically select optimal models across different providers. Essential for production agent systems that need to balance cost, speed, and quality.

## Key Features

- **Cost Tracking**: Monitor spending across OpenAI, Anthropic, Google, and local models
- **Smart Selection**: Automatically choose the best model for each task type
- **Budget Management**: Set daily/weekly/monthly limits with alerts
- **Performance Analytics**: Track response times, success rates, and efficiency
- **Fallback Chains**: Handle provider outages gracefully

## Quick Start

1. Install the skill:
```bash
cp -r model-optimizer ~/.clawdbot/skills/
```

2. Track a model call:
```bash
node scripts/log-usage.js --provider openai --model gpt-4 --input-tokens 150 --output-tokens 75 --cost 0.002 --task code-review
```

3. Get model recommendation:
```bash
node scripts/recommend-model.js --task code-generation --budget-limit 0.01
```

4. Check budget status:
```bash
node scripts/budget-check.js
```

5. Generate cost report:
```bash
node scripts/cost-report.js --period weekly
```

## Configuration

Create `config/models.json` to customize provider costs, model capabilities, and task profiles. See SKILL.md for detailed configuration options.

## Integration

Use in your agent code:
```javascript
const ModelOptimizer = require('./skills/model-optimizer/scripts/optimizer');
const optimizer = new ModelOptimizer();

// Get recommendation
const rec = await optimizer.recommend('code-generation');

// Log usage after API call
await optimizer.logUsage(rec, { input_tokens: 150, output_tokens: 75, cost: 0.002 });
```

## Monitoring

Set up cron job for budget monitoring:
```bash
0 */6 * * * node /path/to/model-optimizer/scripts/budget-check.js --alert-webhook $WEBHOOK_URL
```

## Author

**Axiom** 🔬  
[@AxiomBot](https://x.com/AxiomBot) · [github.com/0xAxiom](https://github.com/0xAxiom/axiom-public)