# env-validator

Pre-flight environment variable validation for AI agents. Checks that required vars exist, validates formats (wallet addresses, URLs, API keys), and produces a pass/fail report before any operation runs. Zero dependencies, pure Node.js. Exit code 0 or 1 — drop it into any bash cron.

## The Problem

Agents fail cryptically when a key is missing or malformed. You get "cannot read properties of undefined" at line 89, three stack frames deep, after the transaction has already been sent. Or worse: it silently uses the wrong RPC URL and you don't find out until hours later.

A pre-flight gate catches these at the top of every run, before any side effects.

## Triggers

Use this skill when:
- Starting any cron job or skill that depends on environment variables
- An agent is running in a new environment (CI, fresh machine, after a `.env` refactor)
- You want a single declarative `rules.json` that documents all config dependencies
- Debugging a cryptic "undefined is not a function" that might be a missing env var

## Install

```bash
cp -r agent-skills/skills/env-validator ~/.openclaw/skills/
```

## Commands

```bash
# Check that specific vars exist
node validate-env.mjs --require RPC_URL,WALLET_ADDRESS,API_KEY

# Validate wallet address format (0x + 40 hex)
node validate-env.mjs --wallet WALLET_ADDRESS --wallet TREASURY_ADDRESS

# Validate URL format
node validate-env.mjs --url RPC_URL --url WEBHOOK_URL

# Validate API key prefix (e.g. Anthropic keys start with sk-ant-)
node validate-env.mjs --prefix ANTHROPIC_KEY=sk-ant- --prefix OPENAI_KEY=sk-

# Validate with a config file (recommended for complex setups)
node validate-env.mjs --config rules.json

# Load .env file + validate
node validate-env.mjs --config rules.json --env-file .env

# JSON output for scripts
node validate-env.mjs --config rules.json --json

# Silent mode (exit code only)
node validate-env.mjs --require RPC_URL,WALLET_ADDRESS --quiet
```

## Config File Format

`rules.json` — declare all your agent's config requirements in one place:

```json
{
  "required":  ["RPC_URL", "PRIVATE_KEY", "ANTHROPIC_API_KEY"],
  "wallet":    ["WALLET_ADDRESS", "TREASURY_ADDRESS"],
  "url":       ["RPC_URL", "WEBHOOK_URL"],
  "key":       ["ANTHROPIC_API_KEY"],
  "prefix": {
    "ANTHROPIC_API_KEY": "sk-ant-",
    "OPENAI_API_KEY":    "sk-"
  },
  "regex": {
    "CHAIN_ID": "^[0-9]+$",
    "PORT":     "^[0-9]{2,5}$"
  },
  "minLength": {
    "SESSION_SECRET": 32,
    "JWT_SECRET":     64
  }
}
```

## Output

```
  VAR                    RULE               STATUS
  ───────────────────────────────────────────────────────
  ✅  RPC_URL             valid-url
  ✅  WALLET_ADDRESS      wallet (0x+40hex)
  ✅  ANTHROPIC_API_KEY   prefix:"sk-ant-"
  ❌  TREASURY_ADDRESS    wallet (0x+40hex)  ← Must be 0x followed by 40 hex characters
  ❌  WEBHOOK_URL         required           ← Missing or empty
  ───────────────────────────────────────────────────────
  ❌  3/5 passed — failed: TREASURY_ADDRESS, WEBHOOK_URL
```

## Exit Codes

| Code | Meaning |
|------|---------|
| `0` | All checks passed |
| `1` | One or more checks failed |

## Integration Patterns

### Gate a cron job

```bash
#!/bin/bash
# my-agent-cron.sh
node ~/.openclaw/skills/env-validator/scripts/validate-env.mjs \
  --config ~/.my-agent/env-rules.json \
  --quiet || { echo "Pre-flight failed"; exit 1; }

node ~/.my-agent/main.mjs
```

### In a Node.js skill

```javascript
import { execSync } from 'node:child_process';

function preflight(configPath) {
  try {
    execSync(
      `node ~/.openclaw/skills/env-validator/scripts/validate-env.mjs --config ${configPath} --json`,
      { stdio: 'pipe' }
    );
  } catch (err) {
    const result = JSON.parse(err.stdout?.toString() || '{}');
    const failed = result.results?.filter(r => !r.ok).map(r => r.var) ?? [];
    throw new Error(`Missing/invalid env vars: ${failed.join(', ')}`);
  }
}

// Call at top of every script
preflight('./env-rules.json');
```

### OpenClaw SKILL.md integration

Add to the top of any SKILL.md:

```markdown
## Pre-flight

Before running, validate your environment:

\`\`\`bash
node ~/.openclaw/skills/env-validator/scripts/validate-env.mjs \
  --require MY_API_KEY,MY_WALLET \
  --wallet MY_WALLET \
  --url MY_RPC
\`\`\`
```

## Validation Rules

| Flag | Config key | Check |
|------|-----------|-------|
| `--require VAR` | `required: [VAR]` | Exists and non-empty |
| `--wallet VAR` | `wallet: [VAR]` | Matches `0x[0-9a-fA-F]{40}` |
| `--url VAR` | `url: [VAR]` | Parses as valid URL |
| `--key VAR` | `key: [VAR]` | Present and >= 8 chars |
| `--prefix VAR=pfx` | `prefix: {VAR: pfx}` | Value starts with prefix |
| `--regex VAR=pattern` | `regex: {VAR: pattern}` | Value matches regex |
| `--min-length VAR=N` | `minLength: {VAR: N}` | Length >= N |

## Options

| Option | Description |
|--------|-------------|
| `--config FILE` | Load rules from a JSON file |
| `--env-file FILE` | Load vars from a .env file before checking |
| `--json` | Output JSON instead of a table |
| `--quiet` | No output, only exit code |

## Requirements

- Node.js 18+
- Zero npm dependencies
