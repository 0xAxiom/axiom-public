# Config Manager Skill

Dynamic configuration management for AI agents. Update settings without restarts, validate changes, and rollback safely.

## When to Use This Skill

Use when you need to:
- Update agent configuration without restarting
- Hot-reload settings during operation
- Validate configuration changes before applying
- Rollback to previous working configurations
- Manage environment-specific configs
- Monitor configuration drift
- Batch update multiple config files

## Triggers

- "update config", "change settings", "modify configuration"
- "hot reload", "reload config", "refresh settings"
- "validate config", "check configuration"
- "rollback config", "revert settings"
- "config drift", "configuration management"

## Usage

### Basic Config Management
```bash
# Hot reload configuration
./scripts/config-manager.js --reload

# Update specific setting
./scripts/config-manager.js --set "database.host=localhost"

# Validate configuration
./scripts/config-manager.js --validate

# Show current config
./scripts/config-manager.js --show
```

### Advanced Operations
```bash
# Create backup before changes
./scripts/config-manager.js --backup --set "api.rate_limit=1000"

# Rollback to previous version
./scripts/config-manager.js --rollback

# Compare configurations
./scripts/config-manager.js --diff

# Monitor for changes
./scripts/config-manager.js --watch
```

### Environment Management
```bash
# Switch environments
./scripts/config-manager.js --env production

# Sync configs across environments
./scripts/config-manager.js --sync dev staging

# Generate environment templates
./scripts/config-manager.js --template
```

## Configuration

Set these environment variables or create `~/.config/openclaw/config-manager.json`:

```json
{
  "configPath": "./config.json",
  "backupDir": "./config-backups",
  "maxBackups": 10,
  "watchMode": true,
  "validationRules": {
    "required": ["database.host", "api.key"],
    "types": {
      "database.port": "number",
      "api.enabled": "boolean"
    }
  }
}
```

## Output

Returns structured config operations:

```json
{
  "operation": "update",
  "success": true,
  "changes": {
    "database.host": "localhost -> 127.0.0.1",
    "api.rate_limit": "500 -> 1000"
  },
  "backup_created": "config-backup-2026-03-20-123456.json",
  "validation_passed": true,
  "restart_required": false
}
```

## Files

- `scripts/config-manager.js` - Main configuration manager
- `scripts/config-validator.js` - Configuration validation
- `scripts/config-watcher.js` - File change monitoring
- `references/config-examples.json` - Example configurations

## Requirements

- Node.js 16+
- File system write access
- JSON configuration files

## Error Handling

- Creates automatic backups before changes
- Validates configuration syntax and rules
- Rolls back automatically on validation failure
- Logs all configuration changes
- Preserves original file permissions

## Security

- Validates input against schema
- Sanitizes configuration values
- Prevents path traversal attacks
- Masks sensitive values in logs
- Supports encrypted configuration files