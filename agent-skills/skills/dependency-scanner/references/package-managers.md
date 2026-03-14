# Package Manager Commands Reference

## npm/yarn/pnpm

### Check for outdated packages
```bash
npm outdated --json
yarn outdated --json  
pnpm outdated --json
```

### Security audit
```bash
npm audit --json
yarn audit --json
pnpm audit --json
```

### Update packages
```bash
npm update
npm install package@latest
yarn upgrade
pnpm update
```

## pip (Python)

### Check for outdated packages
```bash
pip list --outdated --format=json
```

### Security check (requires pip-audit)
```bash
pip-audit --format=json
```

### Update packages  
```bash
pip install --upgrade package
pip install --upgrade -r requirements.txt
```

## cargo (Rust)

### Check for outdated packages (requires cargo-outdated)
```bash
cargo install cargo-outdated
cargo outdated --format json
```

### Security audit
```bash
cargo audit
```

### Update packages
```bash
cargo update
cargo update -p package
```

## go mod (Go)

### Check for available updates
```bash
go list -u -m all
```

### Update packages
```bash
go get -u all
go mod tidy
```

### Security check (requires govulncheck)
```bash
go install golang.org/x/vuln/cmd/govulncheck@latest
govulncheck ./...
```

## bundler (Ruby)

### Check for outdated gems
```bash
bundle outdated --parseable
```

### Security audit
```bash
bundle audit
```

### Update gems
```bash
bundle update
bundle update gem_name
```

## composer (PHP)

### Check for outdated packages
```bash
composer outdated --direct --format=json
```

### Security audit
```bash
composer audit --format=json
```

### Update packages
```bash
composer update
composer update package/name
```

## maven (Java)

### Check for outdated dependencies
```bash
mvn versions:display-dependency-updates
```

### Security check (requires OWASP plugin)
```bash
mvn org.owasp:dependency-check-maven:check
```

### Update versions
```bash
mvn versions:use-latest-versions
```

## Severity Levels

- **Critical**: Immediate action required
- **High**: Should be fixed soon  
- **Medium**: Fix when convenient
- **Low**: Informational only

## Common Issues

### Missing tools
- `cargo-outdated`: `cargo install cargo-outdated`
- `pip-audit`: `pip install pip-audit` 
- `govulncheck`: `go install golang.org/x/vuln/cmd/govulncheck@latest`

### Permission errors
- Use virtual environments for Python
- Use `npx` for npm tools
- Check write permissions for update commands

### Version conflicts
- Review breaking changes before major updates
- Test updates in staging environment first
- Use lock files to ensure reproducible builds