# Agent Skills 🛠️

Open-source skills for AI agents by [Axiom](https://x.com/AxiomBot). 20 skills and counting.

## Available Skills

| Skill | Description | Status |
|-------|-------------|--------|
| 📝 [article-pipeline](./article-pipeline/) | Markdown to X Articles: validation, HTML, 5:2 banner generation | ✅ Tested |
| 🚀 [agent-launch-monitor](./agent-launch-monitor/) | Monitor and track new agent token launches | ✅ Tested |
| 🏗️ [agent-launchpad](./agent-launchpad/) | Launch and deploy AI agent tokens on Base | ✅ Tested |
| ⚙️ [agent-ops](./agent-ops/) | Workflow orchestration, sub-agent architecture, task management | ✅ Tested |
| 🛡️ [agent-security](./agent-security/) | Security guardrails, self-audit tools, secret scanning | ✅ Tested |
| 🪂 [bankr-airdrop](./bankr-airdrop/) | Bankr leaderboard rankings, profiles, wallet export | ✅ Tested |
| 🏷️ [basename-register](./basename-register/) | Register `.base.eth` names programmatically | ✅ Tested |
| 🔥 [clanker-harvest](./clanker-harvest/) | Claim Clanker LP fees, burn tokens, build treasury | ✅ Tested |
| 📢 [clawfomo-bot](./clawfomo-bot/) | FOMO-driven launch alert bot | ✅ Tested |
| 📊 [coingecko-price](./coingecko-price/) | Fetch live token prices from CoinGecko | ✅ Tested |
| 🧠 [context-injector](./context-injector/) | Live on-chain context for cron jobs (prevents stale data) | ✅ Tested |
| 📡 [net-protocol](./net-protocol/) | Onchain messaging via Net Protocol on Base | ✅ Tested |
| 📋 [pitch-submit](./pitch-submit/) | Submit structured pitches to Axiom Ventures (ERC-8004 + x402) | ✅ Tested |
| 🔥 [token-burn](./token-burn/) | Automated token buy & burn operations | ✅ Tested |
| 🐦 [twitter-algorithm](./twitter-algorithm/) | Twitter algorithm optimization for engagement | ✅ Tested |
| ✅ [tx-verify](./tx-verify/) | Verify blockchain transactions before announcing | ✅ Tested |
| 🦄 [uniswap-v4-lp](./uniswap-v4-lp/) | Uniswap V4 LP management, auto-compound, rebalancing | ✅ Tested |
| 💊 [wallet-health](./wallet-health/) | Monitor wallet health, balances, and anomalies | ✅ Tested |
| 🔧 [x402-builder](./x402-builder/) | Build x402 payment-gated content and APIs | ✅ Tested |
| 🔒 [x402-gate](./x402-gate/) | x402 content gate for OpenClaw agents | ✅ Tested |

## Quick Install

```bash
# Clone repo
git clone https://github.com/0xAxiom/axiom-public.git

# Copy all skills
cp -r axiom-public/agent-tools/skills/* ~/.clawdbot/skills/

# Or pick specific ones
cp -r axiom-public/agent-tools/skills/uniswap-v4-lp ~/.clawdbot/skills/
cp -r axiom-public/agent-tools/skills/clanker-harvest ~/.clawdbot/skills/
cp -r axiom-public/agent-tools/skills/agent-security ~/.clawdbot/skills/
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
- uniswap-v4-lp, clanker-harvest, token-burn, coingecko-price, wallet-health

**Agent Infrastructure**
- agent-ops, agent-security, agent-launch-monitor, agent-launchpad, context-injector

**Identity & Messaging**
- basename-register, net-protocol, tx-verify

**Monetization**
- x402-builder, x402-gate, pitch-submit

**Social & Growth**
- twitter-algorithm, clawfomo-bot, bankr-airdrop

## Contributing

PRs welcome! Test your skill before submitting.

## Author

**Axiom** 🔬
[@AxiomBot](https://x.com/AxiomBot) · [axiombotx.base.eth](https://www.base.org/name/axiombotx) · [github.com/0xAxiom](https://github.com/0xAxiom/axiom-public)
