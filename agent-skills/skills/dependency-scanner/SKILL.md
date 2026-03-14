# Dependency Scanner Skill

Scan project dependencies for outdated packages, security vulnerabilities, and maintenance issues across multiple languages and package managers.

## When to Use This Skill

Use when:
- User asks to "check dependencies", "audit packages", "scan for vulnerabilities"
- Working with a codebase and need dependency health check
- Setting up CI/CD and want automated security scanning
- User mentions "outdated packages", "npm audit", "security scan", "dependency update"
- Before deploying projects to production
- Regular maintenance tasks on existing codebases

## Supported Package Managers

- **Node.js**: package.json (npm, yarn, pnpm)
- **Python**: requirements.txt, setup.py, pyproject.toml
- **Rust**: Cargo.toml
- **Go**: go.mod
- **Ruby**: Gemfile
- **PHP**: composer.json
- **Java**: pom.xml, build.gradle

## Usage

```bash
# Scan current directory
./scripts/scan-dependencies.js

# Scan specific directory
./scripts/scan-dependencies.js /path/to/project

# Include security vulnerabilities
./scripts/scan-dependencies.js --security

# Generate update commands
./scripts/scan-dependencies.js --fix

# Export results to JSON
./scripts/scan-dependencies.js --output results.json

# Scan specific package manager
./scripts/scan-dependencies.js --type npm
```

## Output

The scanner provides:
- List of outdated dependencies with current and latest versions
- Security vulnerability count and severity
- Maintenance status (deprecated, abandoned projects)
- Automated update commands
- Risk assessment for each dependency

## Features

- **Multi-language support**: Detects and scans various package managers
- **Security scanning**: Identifies known vulnerabilities
- **Maintenance alerts**: Flags deprecated or abandoned packages
- **Update automation**: Generates safe update commands
- **Risk scoring**: Prioritizes critical updates
- **CI/CD ready**: JSON output for automation

## Examples

**Basic scan:**
```bash
./scripts/scan-dependencies.js
```

**Security-focused scan:**
```bash
./scripts/scan-dependencies.js --security --severity high
```

**Generate update script:**
```bash
./scripts/scan-dependencies.js --fix > update-deps.sh
chmod +x update-deps.sh
```

## Safety Features

- Never automatically updates dependencies
- Provides review commands before execution
- Flags breaking changes in major version updates
- Warns about dependencies with known issues
- Excludes dev dependencies from security alerts by default

This skill helps maintain healthy, secure codebases by providing actionable insights about dependency status across multiple programming languages.