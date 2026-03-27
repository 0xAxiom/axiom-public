# Memory Manager Skill

Clean up storage, manage cache, and prevent disk space issues for AI agents.

## When to Use

- "Clean up disk space"
- "Remove old files"  
- "Clear cache"
- "Optimize storage"
- "Check disk usage"
- "Memory cleanup"
- "Free up space"
- "Storage maintenance"

## Core Functions

1. **Cache Cleanup** - Remove temporary files and stale cache
2. **Old File Removal** - Clean up files older than specified age
3. **Disk Space Monitoring** - Check available space and alert on low storage
4. **Log Rotation** - Archive and compress old log files
5. **Memory Optimization** - Clear unused data and optimize storage

## Scripts

### Basic Cleanup
```bash
# Quick cleanup - removes common cache and temp files
./scripts/cleanup.js

# Deep cleanup with age threshold (default: 30 days)
./scripts/cleanup.js --deep --days 30

# Dry run to see what would be cleaned
./scripts/cleanup.js --dry-run
```

### Disk Space Check
```bash
# Check disk usage and get recommendations
./scripts/disk-check.js

# Monitor with threshold alert (default: 85%)
./scripts/disk-check.js --threshold 85 --alert
```

### Memory Optimization
```bash
# Optimize memory usage and clean temporary data
./scripts/optimize.js

# Full optimization including cache rebuild
./scripts/optimize.js --full
```

## Configuration

Set environment variables or pass as arguments:

```bash
# Cleanup settings
MEMORY_MANAGER_CACHE_DIRS="/tmp,~/.cache"
MEMORY_MANAGER_LOG_DIRS="./logs,./output"
MEMORY_MANAGER_MAX_AGE_DAYS="30"
MEMORY_MANAGER_DISK_THRESHOLD="85"

# Cleanup paths to exclude
MEMORY_MANAGER_EXCLUDE_PATTERNS=".git,node_modules,*.env"
```

## Safety Features

- **Dry run mode** - Preview changes before applying
- **Exclude patterns** - Protect important files/directories
- **Size thresholds** - Only clean files above certain sizes
- **Backup option** - Archive important files before deletion
- **Whitelist mode** - Only clean explicitly allowed directories

## Example Workflows

**Daily Maintenance**
```bash
# Check space and clean if needed
./scripts/disk-check.js --threshold 80 && ./scripts/cleanup.js --days 7

# Optimize memory usage
./scripts/optimize.js
```

**Emergency Cleanup**
```bash
# Aggressive cleanup when space is critical
./scripts/cleanup.js --deep --days 3 --force

# Clear all non-essential cache
./scripts/cleanup.js --cache-only --force
```

**Scheduled Monitoring**
```bash
# Weekly comprehensive cleanup
./scripts/cleanup.js --deep --days 30 --backup

# Daily space check with alerts
./scripts/disk-check.js --threshold 85 --alert --notify
```

## Integration

Works with OpenClaw heartbeat system:
```markdown
# In HEARTBEAT.md
- [ ] Check disk space (./skills/memory-manager/scripts/disk-check.js)
- [ ] Clean old files if > 80% full (./skills/memory-manager/scripts/cleanup.js --days 14)
```

Perfect for cron jobs:
```bash
# Daily at 3 AM
0 3 * * * cd /path/to/agent && ./skills/memory-manager/scripts/cleanup.js --days 30

# Hourly disk check
0 * * * * cd /path/to/agent && ./skills/memory-manager/scripts/disk-check.js --threshold 85
```

## Alert Integration

Supports multiple notification methods:
- Terminal output with colors
- File-based alerts for monitoring systems
- JSON output for programmatic processing
- Webhook notifications for critical space issues

## Dependencies

Pure Node.js - no external dependencies required.

Uses only built-in modules:
- `fs/promises` for file operations
- `path` for path handling  
- `process` for system info
- `child_process` for disk usage commands

## Safety First

- Never deletes files without confirmation in interactive mode
- Provides detailed logs of all operations
- Creates backup manifests before bulk deletions
- Validates all paths before operations
- Respects system file permissions