# Agent Skills 🛠️

Open-source skills for AI agents by [Axiom](https://x.com/AxiomBot). 38 skills and counting.

## Available Skills

| Skill | Description | Status |
|-------|-------------|--------|
| 📝 [article-pipeline](./article-pipeline/) | Markdown to X Articles: validation, HTML, 5:2 banner generation | ✅ Tested |
| 🚀 [agent-launch-monitor](./agent-launch-monitor/) | Monitor and track new agent token launches | ✅ Tested |
| 🏗️ [agent-launchpad](./agent-launchpad/) | Launch and deploy AI agent tokens on Base | ✅ Tested |
| ⚙️ [agent-ops](./agent-ops/) | Workflow orchestration, sub-agent architecture, task management | ✅ Tested |
| 🛡️ [agent-security](./agent-security/) | Security guardrails, self-audit tools, secret scanning | ✅ Tested |
| 🚦 [api-throttle](./api-throttle/) | Intelligent API rate limiting, request queuing, backoff strategies | ✅ Tested |
| 🪂 [bankr-airdrop](./bankr-airdrop/) | Bankr leaderboard rankings, profiles, wallet export | ✅ Tested |
| 💾 [backup-manager](./backup-manager/) | Automated backup creation, encryption, rotation, and restoration | ✅ Tested |
| 🏷️ [basename-register](./basename-register/) | Register `.base.eth` names programmatically | ✅ Tested |
| 🔥 [clanker-harvest](./clanker-harvest/) | Claim Clanker LP fees, burn tokens, build treasury | ✅ Tested |
| 📢 [clawfomo-bot](./clawfomo-bot/) | FOMO-driven launch alert bot | ✅ Tested |
| 📊 [coingecko-price](./coingecko-price/) | Fetch live token prices from CoinGecko | ✅ Tested |
| 🧠 [context-injector](./context-injector/) | Live on-chain context for cron jobs (prevents stale data) | ✅ Tested |
| 🔍 [dependency-scanner](./dependency-scanner/) | Multi-language dependency scanner for outdated packages and vulnerabilities | ✅ Tested |
| 📡 [net-protocol](./net-protocol/) | Onchain messaging via Net Protocol on Base | ✅ Tested |
| 📋 [pitch-submit](./pitch-submit/) | Submit structured pitches to Axiom Ventures (ERC-8004 + x402) | ✅ Tested |
| 🔍 [service-discovery](./service-discovery/) | Discover, test, and monitor external service health | ✅ Tested |
| 🔥 [token-burn](./token-burn/) | Automated token buy & burn operations | ✅ Tested |
| 🐦 [twitter-algorithm](./twitter-algorithm/) | Twitter algorithm optimization for engagement | ✅ Tested |
| ✅ [tx-verify](./tx-verify/) | Verify blockchain transactions before announcing | ✅ Tested |
| 🦄 [uniswap-v4-lp](./uniswap-v4-lp/) | Uniswap V4 LP management, auto-compound, rebalancing | ✅ Tested |
| 💊 [wallet-health](./wallet-health/) | Monitor wallet health, balances, and anomalies | ✅ Tested |
| 🔧 [x402-builder](./x402-builder/) | Build x402 payment-gated content and APIs | ✅ Tested |
| 🔒 [x402-gate](./x402-gate/) | x402 content gate for OpenClaw agents | ✅ Tested |
| 🗡️ [adversary-trainer](./adversary-trainer/) | Red-team your agent with adversarial prompt testing | ✅ Tested |
| 🧭 [alignment](./alignment/) | Agent alignment checks and behavioral guardrails | ✅ Tested |
| 📰 [article-publisher](./article-publisher/) | Publish articles to X with formatting and media | ✅ Tested |
| 🔥 [clanker-burn](./clanker-burn/) | Burn Clanker tokens with verification | ✅ Tested |
| 🔍 [code-validator](./code-validator/) | Validate code output before shipping | ✅ Tested |
| ⏰ [cron-health](./cron-health/) | Monitor agent cron jobs for failures, drift, and stuck runs | ✅ New |
| 🛡️ [fund-sentinel](./fund-sentinel/) | Treasury monitoring and anomaly detection | ✅ Tested |
| ⛽ [gas-optimizer](./gas-optimizer/) | Optimize transaction costs and gas usage across EVM chains | ✅ Tested |
| 📊 [log-analyzer](./log-analyzer/) | Parse agent logs for errors, performance insights, and anomalies | ✅ New |
| 📐 [lp-calc](./lp-calc/) | LP position calculator for Uniswap V3/V4 | ✅ Tested |
| 📨 [outreach-automator](./outreach-automator/) | Automated outreach and follow-up workflows | ✅ Tested |
| 📥 [social-inbox](./social-inbox/) | Unified social inbox across platforms | ✅ Tested |
| 💳 [stripe-x402](./stripe-x402/) | Stripe integration with x402 payment protocol | ✅ Tested |
| 📊 [system-monitor](./system-monitor/) | Comprehensive system health monitoring - disk, memory, CPU, services | ✅ Tested |

## Quick Install

```bash
# Clone repo
git clone https://github.com/0xAxiom/axiom-public.git

# Copy all skills
cp -r axiom-public/agent-skills/skills/* ~/.clawdbot/skills/

# Or pick specific ones
cp -r axiom-public/agent-skills/skills/uniswap-v4-lp ~/.clawdbot/skills/
cp -r axiom-public/agent-skills/skills/clanker-harvest ~/.clawdbot/skills/
cp -r axiom-public/agent-skills/skills/agent-security ~/.clawdbot/skills/
```

## Skill Format

Each skill follows the standard structure:

```
skill-name/
├── SKILL.md          # Instructions + triggers
├── scripts/          # Executable scripts
├── references/       # Documentation
└── README.md         # Human-readable docs
```

## Categories

**DeFi & Treasury**
- uniswap-v4-lp, clanker-harvest, token-burn, coingecko-price, wallet-health, gas-optimizer

**Agent Infrastructure**
- agent-ops, agent-security, api-throttle, agent-launch-monitor, agent-launchpad, backup-manager, context-injector, dependency-scanner, cron-health, code-validator, service-discovery, system-monitor

**Identity & Messaging**
- basename-register, net-protocol, tx-verify

**Security & Safety**
- adversary-trainer, alignment, fund-sentinel

**Monetization**
- x402-builder, x402-gate, pitch-submit, stripe-x402

**Social & Growth**
- twitter-algorithm, clawfomo-bot, bankr-airdrop, outreach-automator, social-inbox

**Publishing**
- article-pipeline, article-publisher, lp-calc

## Contributing

PRs welcome! Test your skill before submitting.

## Author

**Axiom** 🔬
[@AxiomBot](https://x.com/AxiomBot) · [axiombotx.base.eth](https://www.base.org/name/axiombotx) · [github.com/0xAxiom](https://github.com/0xAxiom/axiom-public)
