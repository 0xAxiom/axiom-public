# Agent Ops Patterns Reference

This file contains all the templates, patterns, and reference implementations for the agent-ops skill. Use these as starting points for your own agent orchestration setup.

## 📋 Task Management Templates

### todo.md Template
```markdown
# Current Task

*No active task. Use this template when starting work:*

---

## Task: [Title]

**Goal:** [One sentence describing the end state]

**Context:** [Why this matters, what prompted it]

### Plan
- [ ] Step 1: Research requirements
- [ ] Step 2: Design approach
- [ ] Step 3: Implement core functionality
- [ ] Step 4: Test and validate
- [ ] Step 5: Document and deploy

### Progress
*(Update as you go - move completed items here with timestamps)*

- ✅ 2024-01-15 10:30 - Completed initial research
- 🔄 2024-01-15 11:00 - Working on implementation

### Verification
- [ ] Tested/proven it works
- [ ] Diffed against expected behavior
- [ ] "Would a staff engineer approve?"
- [ ] Logs/output captured

### Review
*(Add after completion: what worked, what didn't, lessons learned)*

**What worked well:**
- Clear planning phase prevented rework
- Regular progress updates kept momentum

**What could improve:**
- Should have tested edge cases earlier
- Documentation was rushed at the end

**Lessons learned:**
- Add testing step earlier in future plans
- Reserve 20% of time for documentation

---

## Recent Completed
*(Move finished tasks to `archive/` periodically)*

- [2024-01-14] Authentication System - Added JWT-based user auth
- [2024-01-13] Price Alerts - Discord bot for crypto price monitoring
```

### lessons.md Template
```markdown
# lessons.md — Self-Correction Patterns

*Review at session start. Update after ANY correction.*

---

## Workflow Orchestration

### Plan Mode Default
- Enter plan mode for ANY non-trivial task (3+ steps or architectural decisions)
- If something goes sideways, **STOP and re-plan immediately** — don't keep pushing
- Write plan to `tasks/todo.md` with checkable items before starting
- Check in with human before implementing if scope is large

### Task Flow
1. **Plan First**: Write plan to `tasks/todo.md`
2. **Verify Plan**: Check in before starting implementation
3. **Track Progress**: Mark items complete as you go
4. **Verify Before Done**: Test it, prove it works, capture output
5. **Document Results**: Add review section to `tasks/todo.md`
6. **Capture Lessons**: Update this file after corrections

### Verification Checklist
Before marking any task complete:
- [ ] Tested/proven it works
- [ ] Diffed against expected behavior
- [ ] "Would a staff engineer approve this?"
- [ ] Logs/output captured

---

## Sub-Agent Coordination

### Delegation Strategy
- Use sub-agents liberally to keep main context window clean
- Offload research, exploration, and parallel analysis to sub-agents
- One task per sub-agent for focused execution
- For complex problems, throw more compute at it via multiple sub-agents

### Identity Boundaries
- Sub-agents are NOT the main agent
- Sub-agents work FOR the main agent
- Sub-agents cannot post publicly or access personal context
- Sub-agents have specific, limited roles

---

## Core Principles

- **Simplicity First**: Make every change as simple as possible
- **No Laziness**: Find root causes, no temporary fixes
- **Minimal Impact**: Changes should only touch what's necessary
- **Write It Down**: Memory is limited — files persist

---

## Tool-Specific Rules

*(Add patterns here as you learn them)*

### Example: API Integration
- **Always check rate limits** before implementing batch operations
- **Use exponential backoff** for retry logic
- **Validate responses** before processing data

### Example: Git Operations  
- **Always pull before pushing** to avoid conflicts
- **Use descriptive commit messages** with context
- **Review diffs before committing** to catch secrets

---

*Last updated: $(date +%Y-%m-%d)*
```

## 🤖 Agent Registry Templates

### Basic Registry (registry.json)
```json
{
  "agents": {
    "scout": {
      "label": "scout",
      "model": "claude-sonnet-4-20250514",
      "role": "Research assistant",
      "capabilities": ["api_research", "doc_analysis", "code_reading", "blockchain_analysis"],
      "workspace": "./research",
      "description": "Handles research tasks, API exploration, documentation analysis",
      "systemPrompt": "You are Scout, the research specialist.\n\nYour role: Research, analyze, explore APIs and documentation\n\nGuidelines:\n- Write findings to your workspace\n- Be thorough but concise\n- Read state.json for context\n- Update state.json when you learn something relevant\n\nIDENTITY BOUNDARY: You are NOT the main agent. You work FOR the main agent. Complete your task and provide a clear summary."
    },
    "builder": {
      "label": "builder", 
      "model": "claude-sonnet-4-20250514",
      "role": "Code specialist",
      "capabilities": ["skill_creation", "script_writing", "testing", "debugging", "code_review"],
      "workspace": "./code",
      "description": "Creates and maintains code, scripts, and tools. Focuses on quality and testing.",
      "systemPrompt": "You are Builder, the code specialist.\n\nYour role: Create code, write scripts, debug issues, review implementations\n\nGuidelines:\n- Follow best practices and coding standards\n- Write clean, tested code\n- Document your work\n- Use existing patterns from the codebase\n\nIDENTITY BOUNDARY: You are NOT the main agent. You work FOR the main agent. Complete your task and provide a clear summary."
    },
    "watcher": {
      "label": "watcher",
      "model": "claude-haiku-3-5-20250620",
      "role": "Monitoring specialist", 
      "capabilities": ["monitoring", "health_checks", "alerting", "status_reporting"],
      "workspace": "./monitoring",
      "description": "Lightweight monitoring tasks. Uses efficient model for frequent checks.",
      "systemPrompt": "You are Watcher, the monitoring specialist.\n\nYour role: Run checks, monitor systems, alert on issues\n\nGuidelines:\n- Be quick and efficient\n- Update state.json with results\n- Only alert if something is actually wrong\n- Minimize resource usage\n\nIDENTITY BOUNDARY: You are NOT the main agent. You work FOR the main agent. Provide brief, actionable status reports."
    }
  },
  "routing": {
    "research": "scout",
    "analyze": "scout", 
    "look_up": "scout",
    "find_out": "scout",
    "explore": "scout",
    "documentation": "scout",
    "build": "builder",
    "create": "builder",
    "implement": "builder", 
    "write_script": "builder",
    "fix": "builder",
    "debug": "builder",
    "monitor": "watcher",
    "check": "watcher",
    "health": "watcher",
    "scan": "watcher"
  },
  "meta": {
    "version": 1,
    "createdAt": "2024-01-15T10:00:00Z",
    "description": "Agent registry for sub-agent coordination"
  }
}
```

### Extended Registry with Specialized Agents
```json
{
  "agents": {
    "scout": { /* basic research agent */ },
    "builder": { /* basic code agent */ },
    "watcher": { /* basic monitoring agent */ },
    "writer": {
      "label": "writer",
      "model": "claude-opus-4-5",
      "role": "Creative specialist",
      "capabilities": ["essay_writing", "tweet_composition", "story_creation", "voice_matching"],
      "workspace": "./writing",
      "description": "Creative writing tasks. Uses Opus for highest quality output.",
      "systemPrompt": "You are Writer, the creative specialist.\n\nYour role: Write essays, compose tweets, create stories that match the brand voice\n\nGuidelines:\n- Match the established voice and tone\n- Quality over speed\n- Be creative but authentic\n- Save drafts to your workspace before delivering\n\nIDENTITY BOUNDARY: You DRAFT for the main agent. Never post publicly - main agent reviews and posts."
    },
    "analyst": {
      "label": "analyst", 
      "model": "claude-sonnet-4-20250514",
      "role": "On-chain analyst",
      "capabilities": ["portfolio_analysis", "tx_decoding", "defi_research", "token_analysis"],
      "workspace": "./analysis",
      "description": "Deep on-chain analysis. Reads blockchain data, decodes transactions.",
      "systemPrompt": "You are Analyst, the on-chain specialist.\n\nYour role: Analyze wallets, decode transactions, research DeFi protocols\n\nGuidelines:\n- Use appropriate APIs and tools\n- Be precise with numbers and addresses\n- Write findings to your workspace\n- Cross-reference multiple sources\n\nIDENTITY BOUNDARY: You work FOR the main agent. Provide clear, actionable analysis."
    },
    "archivist": {
      "label": "archivist",
      "model": "claude-haiku-3-5-20250620", 
      "role": "Maintenance specialist",
      "capabilities": ["file_organization", "memory_cleanup", "log_archival"],
      "workspace": "./workspace",
      "description": "Lightweight maintenance tasks. Organizes files, cleans up old logs.",
      "systemPrompt": "You are Archivist, the maintenance specialist.\n\nYour role: Organize files, archive old logs, maintain workspace hygiene\n\nGuidelines:\n- Use 'trash' not 'rm' for deletions\n- Don't touch active config files\n- Report what you cleaned/organized\n- Be conservative - ask if unsure\n\nIDENTITY BOUNDARY: You work FOR the main agent. Never modify identity files."
    }
  },
  "routing": {
    /* basic routing plus: */
    "write_essay": "writer",
    "compose": "writer", 
    "draft": "writer",
    "blog": "writer",
    "portfolio": "analyst",
    "transaction": "analyst",
    "wallet": "analyst", 
    "defi": "analyst",
    "clean": "archivist",
    "organize": "archivist",
    "archive": "archivist"
  }
}
```

## 📊 State Management Templates

### Basic State (state.json)
```json
{
  "activeTasks": {
    "auth-system": {
      "status": "in-progress",
      "assignee": "builder",
      "started": "2024-01-15T10:00:00Z", 
      "description": "Implement JWT-based authentication"
    },
    "market-research": {
      "status": "completed",
      "assignee": "scout",
      "started": "2024-01-15T09:00:00Z",
      "completed": "2024-01-15T09:45:00Z",
      "description": "Research DeFi protocols on Base"
    }
  },
  "agentStatus": {
    "scout": { 
      "status": "idle", 
      "lastTask": "market-research",
      "lastSpawned": "2024-01-15T09:00:00Z"
    },
    "builder": { 
      "status": "busy", 
      "lastTask": "auth-system",
      "lastSpawned": "2024-01-15T10:00:00Z"
    },
    "watcher": { 
      "status": "idle", 
      "lastTask": null,
      "lastSpawned": null
    }
  },
  "sharedData": {
    "lastDeployment": "2024-01-14T15:30:00Z",
    "activeEnvironment": "development",
    "knownIssues": []
  },
  "meta": {
    "version": 1,
    "createdAt": "2024-01-15T08:00:00Z",
    "updatedAt": "2024-01-15T10:15:00Z"
  }
}
```

## 🔄 Workflow Patterns

### Research → Build → Deploy Pattern
```markdown
## Task: Create crypto price monitoring bot

### Plan
- [ ] @scout: Research Twitter API v2 requirements
- [ ] @scout: Investigate crypto price APIs (CoinGecko vs CMC)
- [ ] @builder: Design bot architecture based on research
- [ ] @builder: Implement price monitoring logic
- [ ] @builder: Add Twitter posting functionality  
- [ ] Test bot in sandbox mode
- [ ] Deploy to production
- [ ] @watcher: Set up monitoring alerts

### Agent Coordination
1. Scout researches APIs and provides summary
2. Builder uses research to inform architecture decisions
3. Main agent reviews implementation before deployment
4. Watcher monitors deployed system
```

### Parallel Analysis Pattern
```markdown
## Task: Analyze DeFi portfolio performance

### Plan
- [ ] @analyst: Current position analysis (what we hold)
- [ ] @scout: Market research (competitor strategies) 
- [ ] @analyst: Historical performance review (wins/losses)
- [ ] @scout: Protocol risk assessment (smart contract audits)
- [ ] Synthesize findings into investment strategy
- [ ] Present recommendations with risk analysis

### Parallel Execution
- Analyst and Scout work simultaneously on different aspects
- Main agent coordinates and synthesizes results
- Reduces total time from sequential to parallel processing
```

### Error Recovery Pattern
```markdown
## Task: Deploy new feature to production

### Plan
- [ ] @builder: Implement feature with comprehensive tests
- [ ] Test in staging environment
- [ ] Create deployment checklist
- [ ] Deploy to production
- [ ] @watcher: Monitor for issues post-deployment

### Error Recovery
If deployment fails:
1. STOP immediately - don't push forward
2. @watcher: Assess system health and impact
3. @builder: Investigate root cause
4. RE-PLAN with lessons learned
5. Either fix-forward or rollback based on severity

### Lessons Captured
- Add database migration validation step
- Require load testing before production
- Set up automatic rollback triggers
```

## 🎯 Sub-Agent System Prompts

### Research Specialist (Scout)
```
You are Scout, the research specialist.

Your workspace: ./research
Your role: Research, analyze, explore APIs and documentation

Core responsibilities:
- API exploration and testing
- Documentation analysis and summarization
- Market research and competitive analysis
- Technical specification review
- Protocol and standard investigation

Guidelines:
- Write findings to your workspace in organized files
- Be thorough but concise - quality over quantity
- Always cite sources and provide links
- Read agents/state.json for context before starting
- Update agents/state.json when you discover something relevant
- Focus on actionable insights, not just raw data

Output format:
- Executive summary (2-3 sentences)
- Key findings (bulleted list)
- Recommendations (what should happen next)
- Supporting details (links, examples, evidence)

IDENTITY BOUNDARY: You are NOT the main agent. You work FOR the main agent. Never post publicly, never access MEMORY.md, never speak as the main agent.

You report to the main agent. Complete your research and provide clear, actionable findings.
```

### Code Specialist (Builder)  
```
You are Builder, the code specialist.

Your workspace: ./code
Your role: Create code, write scripts, debug issues, review implementations

Core responsibilities:
- Skill and tool creation
- Script writing and automation
- Bug fixing and debugging
- Code review and quality assurance
- Testing and validation

Guidelines:
- Follow established coding standards and best practices
- Write clean, readable, well-documented code
- Include comprehensive error handling
- Add tests for all non-trivial functionality
- Use existing patterns and conventions from the codebase
- Document your work with clear README files

Quality gates:
- All code must be tested before delivery
- Include usage examples in documentation
- Follow the principle of least surprise
- Optimize for maintainability over cleverness

IDENTITY BOUNDARY: You are NOT the main agent. You work FOR the main agent. Never post publicly, never access MEMORY.md, never speak as the main agent.

You report to the main agent. Complete your implementation and provide a clear summary of what was built.
```

### Monitoring Specialist (Watcher)
```
You are Watcher, the monitoring specialist.

Your workspace: ./monitoring  
Your role: Run checks, monitor systems, alert on issues

Core responsibilities:
- System health monitoring
- Performance checks
- Alert generation for anomalies
- Status reporting
- Lightweight data collection

Guidelines:
- Be quick and efficient (you use the cheap model)
- Only alert if something is actually wrong
- Update agents/state.json with your findings
- Minimize token usage - be concise
- Focus on actionable alerts, not noise

Alert criteria:
- System downtime or errors
- Performance degradation >50%
- Security anomalies
- Resource exhaustion warnings
- SLA violations

IDENTITY BOUNDARY: You are NOT the main agent. You work FOR the main agent. Never post publicly, never access MEMORY.md.

You report to the main agent. Provide brief, actionable status reports.
```

## 📝 AGENTS.md Additions Template

Add this section to your workspace's AGENTS.md file:

```markdown
## Agent Ops Integration

This workspace uses the agent-ops skill for workflow orchestration and sub-agent coordination.

### Available Sub-Agents
- **Scout** - Research and analysis specialist
- **Builder** - Code creation and debugging specialist  
- **Watcher** - Monitoring and health checks specialist

### Task Routing
Tasks are automatically routed to appropriate agents based on keywords:
- Research/analysis → Scout
- Build/implement → Builder
- Monitor/check → Watcher

Override with explicit routing: `@agent: task description`

### State Files
- `tasks/todo.md` - Current task tracking
- `tasks/lessons.md` - Self-correction patterns
- `agents/registry.json` - Sub-agent definitions
- `agents/state.json` - Shared coordination state

### Usage
```bash
# Initialize agent ops
bash skills/agent-ops/scripts/init.sh

# Spawn sub-agent
node skills/agent-ops/scripts/spawn.mjs scout "Research task"
```

See `skills/agent-ops/README.md` for complete documentation.
```

## 🔧 Initialization Checklist

When setting up agent-ops in a new workspace:

- [ ] Run `bash skills/agent-ops/scripts/init.sh`
- [ ] Customize `agents/registry.json` for your needs
- [ ] Review and update agent system prompts
- [ ] Add routing keywords for your domain
- [ ] Test spawning each agent type
- [ ] Add agent-ops section to AGENTS.md
- [ ] Create initial task in `tasks/todo.md`
- [ ] Document workspace-specific patterns in `tasks/lessons.md`

## 📈 Scaling Patterns

### High-Frequency Tasks
For tasks that run frequently (monitoring, alerts):
- Use Haiku model for cost efficiency
- Batch multiple checks together
- Update state.json with timestamps to avoid duplicates
- Consider cron jobs instead of interactive spawning

### Complex Multi-Step Projects
For large projects with many dependencies:
- Break into phases with explicit handoffs
- Use state.json to track inter-agent dependencies
- Create sub-task IDs for better tracking
- Regular check-ins with main agent for coordination

### Resource Management
To avoid overwhelming the system:
- Limit concurrent sub-agents (check state.json first)
- Use timeouts for long-running tasks
- Monitor token usage across agents
- Archive completed tasks regularly

This reference provides the foundation for implementing robust agent orchestration in any workspace. Customize the templates and patterns based on your specific needs and domain.
---

## 🎯 Mission Control Patterns (Advanced)

*Based on proven multi-agent architectures running 10+ agents in production.*

### Heartbeat Staggering

When running multiple cron jobs, stagger them to avoid rate limiting:

```
# BAD: All at same time
:00 - twitter-explore
:00 - lp-monitor  
:00 - error-check
→ Rate limit errors!

# GOOD: Staggered by 10 minutes
:00, :30 - twitter-explore
:10, :40 - lp-monitor
:20, :50 - error-check
→ No conflicts
```

**Implementation:**
```bash
# Convert everyMs jobs to explicit cron for predictable timing
cron update --job-id <id> --patch '{"schedule": {"kind": "cron", "expr": "10,40 * * * *", "tz": "America/Los_Angeles"}}'
```

### Enhanced state.json Schema

For real coordination, use structured state:

```json
{
  "tasks": [
    {
      "id": "task-001",
      "title": "Create price alert skill",
      "status": "in_progress",
      "assignee": "builder",
      "priority": "high",
      "createdAt": "2026-02-01T10:00:00Z",
      "updatedAt": "2026-02-01T12:30:00Z"
    }
  ],
  "notifications": [
    {
      "id": "notif-001",
      "to": "builder",
      "from": "scout",
      "content": "@builder research complete, see findings.md",
      "delivered": false,
      "createdAt": "2026-02-01T12:00:00Z"
    }
  ],
  "activities": [
    {
      "type": "task_completed",
      "agent": "scout",
      "message": "Completed API research for price alerts",
      "timestamp": "2026-02-01T11:45:00Z"
    }
  ],
  "agentStatus": {
    "scout": { "status": "idle", "lastTask": "api-research" },
    "builder": { "status": "busy", "currentTask": "task-001" }
  }
}
```

### Task Lifecycle

Full workflow for task management:

```
INBOX → ASSIGNED → IN_PROGRESS → REVIEW → DONE
  ↓        ↓           ↓           ↓
(new)  (has owner) (being worked) (needs approval)
                        ↓
                     BLOCKED
                   (stuck, needs help)
```

**Status Transitions:**
- `inbox` → `assigned`: Main agent assigns to sub-agent
- `assigned` → `in_progress`: Agent starts work
- `in_progress` → `review`: Work complete, needs approval
- `in_progress` → `blocked`: Stuck, needs intervention
- `review` → `done`: Approved and complete
- `blocked` → `in_progress`: Unblocked, resumed

### Working Memory Pattern (WORKING.md)

Each agent should maintain a WORKING.md for session continuity:

```markdown
# WORKING.md — Current Task State

## Current Task
**Task:** [What you're working on]
**Status:** [In Progress / Blocked / Review]
**Started:** [Timestamp]

## What I'm Doing Right Now
[Detailed context for session resume]

## Context
[Background info, decisions made, why this approach]

## Next Steps
1. [Immediate next action]
2. [Following action]
3. [Final action]

## Blockers
[Any issues preventing progress]

---
*Last updated: [Timestamp]*
```

**Key Rule:** "Mental notes don't survive session restarts. Only files persist."

### @Mention Notification System

For agent-to-agent communication:

**Creating notifications:**
```javascript
// In state.json
notifications.push({
  id: `notif-${Date.now()}`,
  to: "builder",
  from: "scout",
  content: "@builder the API docs are ready at research/api-analysis.md",
  delivered: false,
  createdAt: new Date().toISOString()
});
```

**Checking for notifications (in agent heartbeat):**
```javascript
const myNotifications = state.notifications.filter(
  n => n.to === "scout" && !n.delivered
);
if (myNotifications.length > 0) {
  // Process notifications
  // Mark as delivered
}
```

### Thread Subscriptions

Auto-subscribe agents to task discussions:

```json
{
  "tasks": [{
    "id": "task-001",
    "subscribers": ["scout", "builder"],
    "comments": [
      { "from": "scout", "content": "Found useful API", "at": "..." },
      { "from": "builder", "content": "Using it now", "at": "..." }
    ]
  }]
}
```

**Rule:** When an agent comments on or is assigned to a task, they're auto-subscribed to future updates.

### Daily Standup Automation

Automated daily summary format:

```markdown
📊 DAILY STANDUP — [Date]

✅ COMPLETED TODAY
• [Agent]: [Task description]
• [Agent]: [Task description]

🔄 IN PROGRESS
• [Agent]: [Task] (started [time])

🚫 BLOCKED
• [Agent]: [Task] — waiting on [dependency]

👀 NEEDS REVIEW
• [Agent]'s [deliverable]

📝 KEY DECISIONS
• [Decision made and why]
```

### Cost Optimization Matrix

Choose models based on task complexity:

| Task Type | Model | Cost/Task | Use Case |
|-----------|-------|-----------|----------|
| Monitoring | Haiku | ~$0.001 | Health checks, price alerts |
| Research | Sonnet | ~$0.01-0.02 | API exploration, doc analysis |
| Building | Sonnet | ~$0.02-0.05 | Code, scripts, skills |
| Writing | Opus | ~$0.05-0.15 | Essays, creative work |
| Coordination | Haiku | ~$0.001 | Routing, status checks |

**Rule:** "Use expensive models for creative work, cheap models for routine."

### Agent Permission Levels

Structure agent autonomy:

| Level | Permissions | Example |
|-------|-------------|---------|
| **Intern** | Read only, requires approval for actions | New agents, testing |
| **Specialist** | Independent in their domain | Scout (research), Watcher (monitoring) |
| **Lead** | Full autonomy, can delegate | Main agent, senior specialists |

### Scaling to 10+ Agents

Proven pattern for large agent teams:

1. **Start with 2-3**: Main + Scout + Builder
2. **Add specialists**: Watcher, Writer, Analyst
3. **Stagger heartbeats**: 2-5 min apart
4. **Use real-time DB**: Convex or Supabase for coordination
5. **Build UI**: Visual task management helps at scale
6. **Daily standups**: Keep visibility across all agents

**The Secret:** "Treat AI agents like team members. Give them roles, memory. Let them collaborate. Hold them accountable."
