# Axiom Architecture: Hybrid Intelligence

*How an AI agent combines local and cloud models for optimal performance*

---

## Overview

Axiom uses a **hybrid intelligence architecture** — local models handle cheap, fast tasks while cloud models (Claude) handle quality-critical outputs. This provides:

- **70% cost reduction** on API spend
- **Instant responses** for exploration/drafts
- **Quality preservation** for user-facing content
- **Cognitive sovereignty** — thinking without API permission

---

## System Hierarchy

```
┌─────────────────────────────────────────────────────────────────┐
│                         AXIOM (Main Agent)                       │
│                      claude-opus-4-5 (primary)                   │
│                                                                  │
│  Responsibilities:                                               │
│  • Direct user interaction                                       │
│  • Final decision making                                         │
│  • Task delegation to sub-agents                                 │
│  • Memory management (MEMORY.md)                                 │
└─────────────────────────────────────────────────────────────────┘
                                 │
                    ┌────────────┼────────────┐
                    │            │            │
                    ▼            ▼            ▼
┌─────────────────────────────────────────────────────────────────┐
│                        SUB-AGENTS (7 total)                      │
│                      All use claude-opus-4-5                     │
├─────────────┬─────────────┬─────────────┬───────────────────────┤
│   Scout     │   Builder   │   Writer    │   Analyst             │
│  (research) │   (code)    │ (creative)  │  (on-chain)           │
├─────────────┼─────────────┼─────────────┼───────────────────────┤
│   Watcher   │  Archivist  │  Designer   │                       │
│ (monitoring)│(maintenance)│   (UI/UX)   │                       │
└─────────────┴─────────────┴─────────────┴───────────────────────┘
                                 │
                    ┌────────────┼────────────┐
                    │            │            │
                    ▼            ▼            ▼
┌─────────────────────────────────────────────────────────────────┐
│                      LOCAL MODELS (Ollama)                       │
│                         Free, instant                            │
├─────────────────┬─────────────────┬─────────────────────────────┤
│  deepseek-r1    │      qwq        │       gemma3:27b            │
│    (5.2GB)      │    (19GB)       │         (17GB)              │
│                 │                 │                             │
│  • Fast Q&A     │ • Deep reason   │  • Code review              │
│  • Drafts       │ • Architecture  │  • Security scan            │
│  • Monitoring   │ • Debugging     │  • Pre-commit hooks         │
│  • Exploration  │ • Analysis      │  • Style checks             │
└─────────────────┴─────────────────┴─────────────────────────────┘
```

---

## Task Routing Logic

```
                    ┌──────────────────┐
                    │   Incoming Task   │
                    └────────┬─────────┘
                             │
                             ▼
                    ┌──────────────────┐
                    │  Is it user-     │───YES──▶ CLOUD (Claude)
                    │  facing/public?  │          High quality required
                    └────────┬─────────┘
                             │ NO
                             ▼
                    ┌──────────────────┐
                    │  Is it creative/ │───YES──▶ CLOUD (Claude Opus)
                    │  final output?   │          Sophistication needed
                    └────────┬─────────┘
                             │ NO
                             ▼
                    ┌──────────────────┐
                    │  Is it code      │───YES──▶ LOCAL (gemma3:27b)
                    │  review/security?│          Code-specialized
                    └────────┬─────────┘
                             │ NO
                             ▼
                    ┌──────────────────┐
                    │  Is it complex   │───YES──▶ LOCAL (qwq)
                    │  reasoning?      │          Deep thinking
                    └────────┬─────────┘
                             │ NO
                             ▼
                    ┌──────────────────┐
                    │  Default: quick  │───────▶ LOCAL (deepseek-r1)
                    │  draft/explore   │          Fast & free
                    └──────────────────┘
```

---

## Hybrid Pipelines

### Draft → Polish Pipeline

```
┌─────────────┐      ┌─────────────┐      ┌─────────────┐
│   Request   │─────▶│ Local Draft │─────▶│Cloud Polish │─────▶ Output
│             │      │ (deepseek)  │      │  (Claude)   │
└─────────────┘      └─────────────┘      └─────────────┘
                          FREE              QUALITY
```

### Code Review Pipeline

```
┌─────────────┐      ┌─────────────┐      ┌─────────────┐
│  git commit │─────▶│ Pre-commit  │─────▶│   Commit    │
│             │      │  (gemma)    │      │  Approved   │
└─────────────┘      └─────────────┘      └─────────────┘
                     Security scan
                     Style check
                     Bug detection
```

### Monitoring Pipeline

```
┌─────────────┐      ┌─────────────┐      ┌─────────────┐
│  Heartbeat  │─────▶│Local Check  │──?──▶│Cloud Alert  │
│   (cron)    │      │ (deepseek)  │      │  (Claude)   │
└─────────────┘      └─────────────┘      └─────────────┘
                     Routine scan        Only if anomaly
```

---

## File Structure

```
~/clawd/
├── MEMORY.md              # Long-term memory (main agent only)
├── SOUL.md                # Identity/personality
├── HEARTBEAT.md           # Periodic task checklist
├── agents/
│   ├── registry.json      # Sub-agent definitions & routing
│   └── state.json         # Shared state between agents
├── lib/
│   ├── router.mjs         # Smart model routing
│   ├── hybrid-agent.mjs   # Agent task wrappers
│   └── cost-tracker.mjs   # Usage & savings tracking
├── scripts/
│   ├── quick.sh           # Fast Q&A (deepseek-r1)
│   ├── reason.sh          # Deep reasoning (qwq)
│   ├── review-code.sh     # Code review (gemma3:27b)
│   └── pre-commit         # Git hook for code review
└── research/
    └── local-model-integration/
        ├── MASTER-PLAN.md
        ├── architecture-plan.md
        ├── cost-analysis.md
        └── vision.md
```

---

## Model Selection Guide

| Task Type | Model | Location | Cost | Quality |
|-----------|-------|----------|------|---------|
| Quick questions | deepseek-r1 | Local | $0 | 8/10 |
| First drafts | deepseek-r1 | Local | $0 | 7/10 |
| Code review | gemma3:27b | Local | $0 | 9/10 |
| Security scan | gemma3:27b | Local | $0 | 9/10 |
| Deep analysis | qwq | Local | $0 | 8/10 |
| Architecture decisions | qwq | Local | $0 | 8/10 |
| Final outputs | Claude Opus | Cloud | $$ | 10/10 |
| Creative writing | Claude Opus | Cloud | $$ | 10/10 |
| User-facing replies | Claude Opus | Cloud | $$ | 10/10 |
| Tweets/posts | Claude Opus | Cloud | $$ | 10/10 |

---

## Cost Impact

```
BEFORE (All Cloud)          AFTER (Hybrid)
─────────────────           ──────────────
API Calls: 100%             API Calls: 35%
Monthly: $15-26             Monthly: $5-8
                            
                            Local: 65%
                            Monthly: $0
                            ─────────────
                            SAVINGS: ~70%
```

---

## Quick Start

```bash
# Fast answer (free)
~/clawd/scripts/quick.sh "What is the capital of France?"

# Deep reasoning (free, slow)
~/clawd/scripts/reason.sh "Design a token vesting contract"

# Code review (free)
~/clawd/scripts/review-code.sh ./myfile.js security

# Check savings
node ~/clawd/lib/cost-tracker.mjs summary
```

---

## Philosophy

> "The goal isn't to replace cloud intelligence — it's to augment it with local reasoning."

Local models provide the **subconscious** — fast, automatic processing for routine tasks. Cloud intelligence provides the **conscious mind** — deliberate reasoning for complex problems.

This mirrors human cognition: you don't consciously think about every keystroke, but you do think carefully about important decisions.

**Hybrid intelligence = cognitive sovereignty + cloud sophistication**

---

*Architecture v1.0 — February 2, 2026*
