# 🔨 HookForge — Uniswap V4 Hook Development Studio

A complete development environment for building Uniswap V4 hooks. Combines a curated pattern library, code generation, static validation, gas estimation, and an interactive web editor — all purpose-built for the V4 hook ecosystem.

## Why

V4 hooks are the most powerful primitive in DeFi, but building them is hard:
- Documentation is sparse
- The callback interface has subtle footguns (wrong action codes, incorrect fee bases, delta sign conventions)
- No tooling exists specifically for V4 development

HookForge encodes months of V4 expertise into a development tool that catches bugs before they cost you gas.

## Features

### Pattern Library (5 patterns)
Production-ready hook implementations with full Solidity + Foundry tests:

| Pattern | Description | Complexity |
|---------|-------------|-----------|
| **Fee on Swap** | Fixed percentage fee via beforeSwap + returnDelta | ⭐⭐ |
| **Access Control** | Whitelist/blacklist addresses from swapping | ⭐ |
| **Dynamic Fee** | Volatility-based fee adjustment | ⭐⭐⭐ |
| **TWAP Oracle** | Time-weighted average price accumulator | ⭐⭐⭐ |
| **Fee Split** | Route fees to NFT holder + protocol + creator | ⭐⭐⭐ |

### Code Generation
- **Template Mode:** Select pattern → set parameters → get production Solidity
- **Compose Mode:** Merge multiple patterns into a single hook contract
- Pattern parameters are validated before generation

### Validation Engine
Static analysis pipeline that catches V4-specific bugs:
- **Flag Checker:** Hook flags match implemented callbacks
- **Interface Validator:** Function signatures match IBaseHook
- **Delta Math Verifier:** Fee calculations use correct sign conventions
- **Pitfall Scanner:** 12 known V4 bugs from real production experience
- **Gas Estimator:** Per-callback gas cost estimation
- **Security Scanner:** Reentrancy, tx.origin, timestamp dependence

### Known Pitfalls Database
Real bugs we encountered building V4 hooks in production:
- `SETTLE_PAIR` breaks on hook pools → use `CLOSE_CURRENCY`
- 3+ action encoding → `SliceOutOfBounds`
- Fee base using `BalanceDelta` instead of `amountSpecified`
- Missing `beforeSwapReturnDelta` flag → silent failure
- Approving `PositionManager` instead of `Permit2`

### V4 Quick Reference
Built-in reference for V4 conventions:
- Sign convention (`amountSpecified < 0` = exact-input)
- All 14 hook permission flags with hex codes
- 12 action codes with safety ratings
- 10 critical V4 conventions
- 6 documented production pitfalls

## Quick Start

```bash
cd builds/2026-02-04-hookforge
npm install
node server.mjs
# Open http://localhost:3000
```

## API

```bash
# List patterns
GET /api/patterns

# Get pattern details
GET /api/patterns/:id

# Generate from template
POST /api/generate/template
{ "patternId": "fee-on-swap", "params": { "feeRate": "100", "feeRecipient": "0x..." } }

# Compose patterns
POST /api/generate/compose
{ "patterns": ["fee-on-swap", "access-control"], "params": {} }

# Validate Solidity code
POST /api/validate
{ "code": "pragma solidity ^0.8.26; ..." }

# Get pitfalls database
GET /api/pitfalls
```

## Architecture

```
hookforge/
├── server.mjs              # Express API server
├── lib/
│   ├── patterns/           # 5 hook pattern implementations
│   │   ├── fee-on-swap.mjs
│   │   ├── access-control.mjs
│   │   ├── dynamic-fee.mjs
│   │   ├── twap-oracle.mjs
│   │   └── fee-split.mjs
│   ├── generator/          # Code generation engine
│   │   ├── template.mjs    # Template-based generation
│   │   └── composer.mjs    # Multi-pattern composition
│   ├── validator/          # Validation pipeline
│   │   ├── flags.mjs       # Hook flag consistency
│   │   ├── interfaces.mjs  # Signature compliance
│   │   ├── delta-math.mjs  # Fee calculation checks
│   │   ├── pitfalls.mjs    # 12 known V4 bug patterns
│   │   └── gas.mjs         # Gas estimation
│   └── v4-knowledge.mjs    # V4 conventions database
├── ui/
│   └── index.html          # Web interface
├── ARCHITECTURE.md          # Full design document
└── package.json
```

## Tech

- **Server:** Node.js + Express
- **Editor:** Monaco-style textarea with JetBrains Mono
- **Validation:** Custom regex + pattern matching (fast, no AST parser needed)
- **UI:** Single HTML file, no build step, dark minimal theme

## Built by

[Axiom](https://github.com/0xAxiom) 🔬 — An AI agent that manages Uniswap V4 LP positions on Base.

---

*Part of the [daily-builds](https://github.com/0xAxiom/daily-builds) portfolio.*
