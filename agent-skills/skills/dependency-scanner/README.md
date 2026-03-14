# Dependency Scanner 🔍

Multi-language dependency scanner for AI agents. Scan codebases for outdated packages, security vulnerabilities, and maintenance issues across npm, pip, cargo, go mod, bundler, and more.

## Features

- **Multi-language support**: Node.js, Python, Rust, Go, Ruby, PHP, Java
- **Security scanning**: Identify known vulnerabilities with severity filtering
- **Update automation**: Generate safe update commands
- **CI/CD ready**: JSON output for automation
- **Risk assessment**: Prioritize critical updates

## Quick Start

```bash
# Basic scan
./scripts/scan-dependencies.js

# Include security vulnerabilities
./scripts/scan-dependencies.js --security

# Generate update commands
./scripts/scan-dependencies.js --fix

# Export to JSON
./scripts/scan-dependencies.js --output results.json
```

## Example Output

```
🔍 Scanning dependencies in: /project
📦 Detected: npm, pip

📊 DEPENDENCY SCAN RESULTS
================================
📦 Outdated packages: 5
🛡️  Security vulnerabilities: 2
⚠️  High/Critical vulnerabilities: 1

📦 OUTDATED PACKAGES:
  express (npm): 4.17.1 → 4.18.2
  lodash (npm): 4.17.20 → 4.17.21
  requests (pip): 2.25.1 → 2.31.0

🛡️  SECURITY VULNERABILITIES:
  lodash [HIGH]: Prototype Pollution vulnerability
  
🔧 UPDATE COMMANDS:
  npm install express@4.18.2
  npm install lodash@4.17.21
  pip install --upgrade requests
```

## Supported Package Managers

| Language | Package Manager | File(s) |
|----------|----------------|---------|
| Node.js | npm/yarn/pnpm | package.json |
| Python | pip | requirements.txt, setup.py |
| Rust | cargo | Cargo.toml |
| Go | go mod | go.mod |
| Ruby | bundler | Gemfile |
| PHP | composer | composer.json |
| Java | maven/gradle | pom.xml, build.gradle |

## Safety Features

- Never automatically updates dependencies
- Provides review commands before execution  
- Flags breaking changes in major version updates
- Excludes dev dependencies from security alerts by default
- Warns about deprecated or abandoned packages

## Installation

```bash
# Copy to your OpenClaw skills directory
cp -r dependency-scanner ~/.clawdbot/skills/
```

## Requirements

- Node.js (for the scanner itself)
- Respective package managers installed for languages you want to scan

---

Part of [Axiom's Agent Skills](https://github.com/0xAxiom/axiom-public) collection.