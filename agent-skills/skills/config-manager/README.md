# Config Manager Skill

Dynamic configuration management for AI agents without restarts.

## Overview

The Config Manager skill provides hot-reload capabilities, validation, and rollback functionality for agent configurations. Never restart your agent to update settings again.

## Key Features

- **Hot Reload**: Update configuration without stopping your agent
- **Validation**: Schema-based validation with comprehensive error checking
- **Backup & Rollback**: Automatic backups with easy rollback to previous versions
- **Security Checks**: Detect exposed secrets and insecure configurations
- **Environment Management**: Switch between different environment configs
- **Change Tracking**: See exactly what changed with detailed diff output

## Quick Start

```bash
# Show current configuration
./scripts/config-manager.js --show

# Update a setting
./scripts/config-manager.js --set "api.rate_limit=2000"

# Validate configuration
./scripts/config-manager.js --validate

# Create backup before risky changes
./scripts/config-manager.js --backup --set "debug=true"

# Rollback if something breaks
./scripts/config-manager.js --rollback
```

## Real-World Examples

### Trading Bot Configuration
```bash
# Enable trading with safety checks
./scripts/config-manager.js --backup --set "features.auto_trading=true"
./scripts/config-manager.js --set "risk_management.max_loss_per_trade=0.01"

# Monitor configuration changes
./scripts/config-manager.js --watch
```

### API Configuration
```bash
# Update rate limits during high traffic
./scripts/config-manager.js --set "api.rate_limit=5000"

# Switch to backup database
./scripts/config-manager.js --set "database.host=db2.example.com"

# Validate all changes
./scripts/config-manager.js --validate
```

### Environment Switching
```bash
# Development to staging
./scripts/config-manager.js --set "environment=staging"
./scripts/config-manager.js --set "database.host=staging-db.example.com"
./scripts/config-manager.js --set "debug=false"
```

## Advanced Usage

### Custom Validation Schema
Create a `schema.json` file:
```json
{
  "required": ["database.host", "api.key"],
  "types": {
    "database.port": "number",
    "features.enabled": "boolean"
  },
  "ranges": {
    "api.rate_limit": { "min": 1, "max": 10000 }
  }
}
```

Then validate:
```bash
./scripts/config-validator.js config.json --schema schema.json
```

### Monitoring Configuration Drift
```bash
# Watch for unauthorized changes
./scripts/config-manager.js --watch &

# Compare with known good backup
./scripts/config-manager.js --diff
```

### Batch Operations
```bash
# Multiple updates with validation
./scripts/config-manager.js --backup \
  --set "api.rate_limit=2000" \
  --set "database.pool_size=50" \
  --validate
```

## Security Features

- **Secret Detection**: Warns about exposed passwords, API keys, tokens
- **Permission Checks**: Identifies overly permissive configurations
- **Network Security**: Flags insecure network settings
- **Input Validation**: Prevents injection attacks and malformed data

## Error Handling

The tool provides comprehensive error handling:

- **Syntax Validation**: Catches JSON parsing errors
- **Schema Validation**: Ensures data types and required fields
- **Atomic Updates**: Changes are all-or-nothing (no partial failures)
- **Automatic Rollback**: Failed validations don't corrupt configuration
- **Backup Recovery**: Multiple backup versions for disaster recovery

## Integration

### With Agent Code
```javascript
const ConfigManager = require('./scripts/config-manager.js');

const manager = new ConfigManager({ configPath: './agent-config.json' });

// Hot reload on file changes
manager.watch((newConfig) => {
  console.log('Configuration updated:', newConfig);
  // Update agent behavior based on new config
});

// Programmatic updates
const config = manager.load();
manager.setProperty(config, 'api.rate_limit', 1500);
manager.save(config);
```

### With Monitoring Systems
```bash
# Health check endpoint
curl -s http://localhost:8080/config/validate | jq '.valid'

# Automated rollback on failure
if ! ./scripts/config-manager.js --validate; then
  ./scripts/config-manager.js --rollback
  echo "Configuration rolled back due to validation failure"
fi
```

## Best Practices

1. **Always backup before risky changes**: Use `--backup` flag for any production updates
2. **Validate after every change**: Run `--validate` to catch issues early
3. **Use schema files**: Define comprehensive validation rules in schema.json
4. **Monitor for drift**: Use `--watch` to detect unauthorized changes
5. **Test in staging first**: Validate configuration changes in non-production environments
6. **Keep backup rotation**: Configure `maxBackups` to retain history without filling disk

## Troubleshooting

### Common Issues

**Configuration not reloading?**
- Check file permissions and watch process status
- Verify JSON syntax with `--validate`

**Validation failing?**
- Review schema requirements with `--show`
- Check data types match expected values

**Rollback not working?**
- Verify backup directory exists and contains backups
- Check backup file permissions

### Debug Mode
```bash
# Verbose output for troubleshooting
DEBUG=config-manager ./scripts/config-manager.js --set "debug=true"
```

## File Structure

```
config-manager/
├── SKILL.md                    # Agent instructions
├── README.md                   # Human documentation
├── scripts/
│   ├── config-manager.js       # Main tool
│   └── config-validator.js     # Advanced validation
└── references/
    └── config-examples.json    # Example configurations
```

## Dependencies

- Node.js 16+ (zero external dependencies)
- File system write access
- JSON configuration files

Built for production use with real-world AI agents. Battle-tested patterns for configuration management at scale.