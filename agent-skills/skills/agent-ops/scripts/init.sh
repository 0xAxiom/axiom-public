#!/bin/bash

# Agent Ops Initialization Script
# Sets up workflow orchestration structure in current workspace

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(dirname "$SCRIPT_DIR")"
WORKSPACE_DIR="$(pwd)"

echo "🏗️  Initializing Agent Ops in: $WORKSPACE_DIR"

# Create directory structure
echo "📁 Creating directories..."
mkdir -p tasks/{archive}
mkdir -p agents
mkdir -p memory

# Create todo.md if it doesn't exist
if [[ ! -f "tasks/todo.md" ]]; then
    echo "📝 Creating tasks/todo.md..."
    cat > tasks/todo.md << 'EOF'
# Current Task

*No active task. Use this template when starting work:*

---

## Task: [Title]

**Goal:** [One sentence]

**Context:** [Why this matters]

### Plan
- [ ] Step 1
- [ ] Step 2
- [ ] Step 3

### Progress
*(Update as you go)*

### Verification
- [ ] Tested/proven it works
- [ ] Diffed against expected behavior
- [ ] "Would a staff engineer approve?"
- [ ] Logs/output captured

### Review
*(Add after completion: what worked, what didn't, lessons learned)*

---

## Recent Completed
*(Move finished tasks to `archive/` periodically)*
EOF
else
    echo "✅ tasks/todo.md already exists"
fi

# Create lessons.md if it doesn't exist
if [[ ! -f "tasks/lessons.md" ]]; then
    echo "🧠 Creating tasks/lessons.md..."
    cat > tasks/lessons.md << 'EOF'
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

---

*Last updated: $(date +%Y-%m-%d)*
EOF
else
    echo "✅ tasks/lessons.md already exists"
fi

# Create agents/registry.json if it doesn't exist
if [[ ! -f "agents/registry.json" ]]; then
    echo "🤖 Creating agents/registry.json..."
    cat > agents/registry.json << 'EOF'
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
    "createdAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
    "description": "Agent registry for sub-agent coordination"
  }
}
EOF
else
    echo "✅ agents/registry.json already exists"
fi

# Create agents/state.json if it doesn't exist  
if [[ ! -f "agents/state.json" ]]; then
    echo "📊 Creating agents/state.json..."
    cat > agents/state.json << 'EOF'
{
  "activeTasks": {},
  "agentStatus": {
    "scout": { "lastSpawned": null, "lastTask": null, "status": "idle" },
    "builder": { "lastSpawned": null, "lastTask": null, "status": "idle" },
    "watcher": { "lastSpawned": null, "lastTask": null, "status": "idle" }
  },
  "sharedData": {},
  "meta": {
    "version": 1,
    "createdAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
    "updatedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  }
}
EOF
else
    echo "✅ agents/state.json already exists"
fi

# Create .gitignore entries for agent ops (if git repo exists)
if [[ -d ".git" ]]; then
    echo "📝 Updating .gitignore for agent ops..."
    
    # Check if agent-ops entries exist
    if ! grep -q "# Agent Ops" .gitignore 2>/dev/null; then
        cat >> .gitignore << 'EOF'

# Agent Ops
memory/heartbeat-state.json
tasks/archive/*.tmp
*.agent-lock
EOF
        echo "✅ Added agent ops entries to .gitignore"
    else
        echo "✅ .gitignore already has agent ops entries"
    fi
fi

echo ""
echo "✅ Agent Ops initialization complete!"
echo ""
echo "📋 What was created:"
echo "   tasks/todo.md          - Task tracking template"
echo "   tasks/lessons.md       - Self-correction patterns"
echo "   agents/registry.json   - Sub-agent definitions"
echo "   agents/state.json      - Shared coordination state"
echo "   tasks/archive/         - Completed task storage"
echo ""
echo "🚀 Next steps:"
echo "   1. Review agents/registry.json and customize for your needs"
echo "   2. Start your first task in tasks/todo.md"
echo "   3. Use the spawn.mjs script to delegate work to sub-agents"
echo ""
echo "📖 Documentation: skills/agent-ops/README.md"