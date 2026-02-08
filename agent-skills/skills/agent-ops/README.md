# 🏗️ Agent Ops Skill

Workflow orchestration, sub-agent architecture, and task management patterns for AI agents. Built for [Moltbot](https://docs.openclaw.ai) but applicable to any autonomous AI agent.

## Why This Exists

AI agents need more than tools — they need patterns. How do you:
- Break down complex tasks into manageable plans?
- Delegate work to specialized sub-agents?
- Track progress across multiple workflows?
- Learn from mistakes and improve over time?
- Coordinate shared state between agents?

This skill provides battle-tested patterns for agent orchestration and autonomous task execution.

## Quick Start

### Install as a Moltbot Skill

Copy this folder to your agent's skills directory:

```bash
cp -r agent-ops/ ~/.clawdbot/skills/agent-ops/
# or for OpenClaw:
cp -r agent-ops/ ~/.openclaw/skills/agent-ops/
```

The agent will automatically load `SKILL.md` as part of its operational patterns.

### Initialize Agent Ops in Your Workspace

```bash
bash skills/agent-ops/scripts/init.sh
```

Creates the foundational files:
- `tasks/todo.md` — Current task tracking
- `tasks/lessons.md` — Self-correction patterns
- `agents/registry.json` — Sub-agent definitions
- `agents/state.json` — Shared state coordination
- `tasks/archive/` — Completed task storage

### Spawn a Sub-Agent

```bash
node skills/agent-ops/scripts/spawn.mjs scout "Research the latest DeFi protocols on Base"
```

## What's Included

```
agent-ops/
├── SKILL.md                          # Agent-readable operational instructions
├── README.md                         # This file
├── scripts/
│   ├── init.sh                       # Initialize agent-ops in workspace
│   └── spawn.mjs                     # Helper to spawn specialized sub-agents
└── references/
    └── patterns.md                   # Workflow patterns reference guide
```

## Core Workflow Patterns

### 1. Plan Mode Default
```markdown
## Task: Create user authentication system

**Goal:** Secure user login with JWT tokens

**Context:** Current system has no auth, need to add before launch

### Plan
- [ ] Research JWT best practices
- [ ] Design authentication schema
- [ ] Implement login/register endpoints
- [ ] Add middleware for protected routes
- [ ] Write comprehensive tests
- [ ] Update API documentation

### Progress
*(Update as you go)*
```

**Key principles:**
- Enter plan mode for ANY non-trivial task (3+ steps)
- Write plan to `tasks/todo.md` before starting
- If something goes sideways, STOP and re-plan immediately
- Check in with human before implementing if scope is large

### 2. Verification Before Done
```markdown
### Verification
- [x] Tested/proven it works
- [x] Diffed against expected behavior
- [x] "Would a staff engineer approve this?"
- [x] Logs/output captured
```

Never mark a task complete without proving it works.

### 3. Sub-Agent Delegation

**Automatic Routing** (keyword-based):
- `research`, `analyze`, `explore` → Scout
- `build`, `create`, `implement` → Builder
- `monitor`, `check`, `health` → Watcher

**Explicit Routing** (override):
```
@scout: Research the latest v4 hook patterns
@builder: Create a price monitoring skill
@watcher: Check our LP position health
```

### 4. Shared State Coordination

All agents read/write to `agents/state.json`:
```json
{
  "activeTasks": {
    "auth-system": {
      "status": "in-progress",
      "assignee": "builder", 
      "started": "2024-01-15T10:30:00Z"
    }
  },
  "agentStatus": {
    "scout": { "status": "busy", "lastTask": "auth-research" },
    "builder": { "status": "idle", "lastTask": null }
  }
}
```

## Agent Registry Pattern

Define specialized agents in `agents/registry.json`:

```json
{
  "agents": {
    "scout": {
      "role": "Research assistant",
      "model": "claude-sonnet-4-20250514", 
      "capabilities": ["api_research", "doc_analysis", "blockchain_analysis"],
      "systemPrompt": "You are Scout, the research specialist...",
      "workspace": "/workspace/research"
    },
    "builder": {
      "role": "Code specialist",
      "model": "claude-sonnet-4-20250514",
      "capabilities": ["skill_creation", "debugging", "testing"],
      "systemPrompt": "You are Builder, the code specialist...",
      "workspace": "/workspace/code"
    }
  },
  "routing": {
    "research": "scout",
    "build": "builder",
    "debug": "builder"
  }
}
```

## Task Flow Example

### Input
```
Create a Twitter bot that monitors crypto prices and tweets alerts
```

### Agent Processing

**Main Agent (Plan Mode):**
```markdown
## Task: Create crypto price Twitter bot

### Plan
- [ ] @scout: Research Twitter API v2 requirements and rate limits
- [ ] @scout: Investigate crypto price APIs (CoinGecko, CMC)
- [ ] @builder: Design bot architecture and data flow
- [ ] @builder: Implement price monitoring logic
- [ ] @builder: Add Twitter posting functionality
- [ ] Test bot with paper trading mode
- [ ] Deploy and monitor
```

**Scout (Research Phase):**
```
✅ Twitter API v2 research complete
   - Essential endpoints: POST /2/tweets, GET /2/users/me
   - Rate limits: 300 tweets per 15min
   - Requires Bearer token + OAuth 1.0a for posting

✅ Price API analysis complete  
   - CoinGecko: Free tier, good coverage, 3-5s latency
   - Recommended: /simple/price endpoint for multiple tokens
```

**Builder (Implementation Phase):**
```
✅ Bot architecture designed
   - Event-driven: price check → threshold check → tweet
   - SQLite for tracking last prices and alert history
   - Configurable thresholds per token

✅ Core implementation complete
   - Price monitor with 30s intervals
   - Smart alerting (no spam, exponential backoff)
   - Tweet templates with price formatting
```

### Output
Fully functional Twitter bot with documentation and deployment instructions.

## Self-Correction Loop

Every mistake becomes a rule in `tasks/lessons.md`:

```markdown
## Tool-Specific Rules

### Twitter API
- **Always pass `--reply-to <tweet_id>`** when replying
- **Never use `bird tweet`** to read — it posts, not reads

### Git
- **Always push to MY GitHub** — I have my own account
- Remote `axiom` = git@github-axiom:0xAxiom/axiom-public.git

### Publishing
- **NEVER publish without approval** — includes npm, tweets, posts
- Test APIs with GET requests, not by creating public content
```

## Usage Examples

### Research Task
```bash
# Agent automatically detects "research" keyword
"Research how Uniswap V4 hooks work and create a summary"

# Or explicit routing
"@scout: Deep dive into V4 hook lifecycle and events"
```

### Building Task
```bash
# Auto-routes to builder
"Create a skill for price alerts that posts to Discord"

# Or explicit
"@builder: Implement the price alert logic we discussed"
```

### Multi-Agent Complex Task
```bash
"Build a DeFi yield farming dashboard that tracks our positions"

# Main agent breaks down:
# 1. @scout: Research yield farming protocols on Base
# 2. @analyst: Analyze our current DeFi positions  
# 3. @builder: Create dashboard with real-time data
# 4. @builder: Add alerting for unhealthy positions
```

## Templates

All templates are in `references/patterns.md`:
- `todo.md` structure for task tracking
- `lessons.md` format for self-correction
- `registry.json` for agent definitions
- Sub-agent system prompts
- Verification checklists

## Best Practices

### For Main Agents
1. **Default to plan mode** for any non-trivial task
2. **Use sub-agents liberally** to keep context clean
3. **Update shared state** when tasks complete
4. **Capture lessons** after any correction

### For Sub-Agents  
1. **Stay focused** on assigned task only
2. **Update state.json** with your progress
3. **Report clearly** when complete
4. **Don't initiate** external actions without approval

### For Operators
1. **Review plans** before large implementations
2. **Check verification** before marking done
3. **Monitor shared state** for agent coordination
4. **Update lessons.md** when patterns emerge

## Built On

Patterns distilled from:
- Real-world Moltbot agent deployments
- [OpenClaw multi-agent architectures](https://docs.openclaw.ai)
- Software engineering task decomposition
- DevOps workflow orchestration
- Agent coordination research

## Contributing

Found a better workflow pattern? Have a useful template? Submit a PR:
- Add new patterns to `references/patterns.md`
- Extend the registry with new agent types
- Improve the task flow templates
- Share your lessons.md patterns

## License

MIT — Orchestrate with confidence.
## Mission Control Patterns

For production-grade multi-agent systems (10+ agents), this skill includes battle-tested patterns from [Mission Control architectures](https://x.com/pbteja1998/status/2017662163540971756):

### Quick Wins
1. **Stagger heartbeats** — Don't fire all cron jobs at once
2. **Add WORKING.md** — Session continuity for each agent  
3. **Structured tasks** — Track status: Inbox→Assigned→In Progress→Review→Done
4. **@Mentions** — Agent-to-agent notifications

### Heartbeat Schedule Example
```
:00, :30 — twitter-explore
:05, :35 — social-check  
:10, :40 — lp-monitor
:20, :50 — error-monitor
```
No more rate limit stacking!

### Working Memory
```markdown
# WORKING.md

## Current Task
Building price alert skill

## What I'm Doing
Implementing Discord webhook integration

## Next Steps
1. Test webhook
2. Add error handling
3. Update README
```

This file is read at session start, updated constantly, and survives restarts.

### Cost Optimization
| Task Type | Model | When |
|-----------|-------|------|
| Monitoring | Haiku | Health checks, alerts |
| Research | Sonnet | API exploration |
| Building | Sonnet | Code, scripts |
| Creative | Opus | Essays, writing |

"Use expensive models for creative work, cheap models for routine."

See `references/patterns.md` for complete Mission Control implementation guide.
