# Memory Manager

AI agent skill for storage cleanup, disk space monitoring, and memory optimization.

## Overview

The Memory Manager skill helps AI agents maintain system health by:
- Cleaning up temporary files and stale cache
- Monitoring disk space and alerting on low storage
- Optimizing memory usage and clearing unnecessary data
- Providing actionable recommendations for storage issues

## Features

- **Smart Cleanup** - Removes old files while preserving important data
- **Disk Monitoring** - Real-time space tracking with configurable thresholds  
- **Memory Optimization** - Clears caches and optimizes process memory
- **Safety First** - Dry-run mode, exclude patterns, and backup options
- **Cross-Platform** - Works on macOS and Linux systems

## Quick Start

```bash
# Check disk space
./scripts/disk-check.js

# Clean old files (30+ days)
./scripts/cleanup.js --days 30

# Optimize memory usage
./scripts/optimize.js

# Preview cleanup without changes
./scripts/cleanup.js --dry-run
```

## Use Cases

**Daily Maintenance**
```bash
# Morning health check
./scripts/disk-check.js --threshold 80

# Clean if needed
if [ $? -eq 1 ]; then
  ./scripts/cleanup.js --days 7
fi
```

**Emergency Cleanup**
```bash
# Aggressive cleanup when space is critical
./scripts/cleanup.js --deep --days 3 --cache-only
./scripts/optimize.js --full --aggressive
```

**Scheduled Monitoring**
```bash
# Crontab entry for daily 3 AM cleanup
0 3 * * * cd /agent/path && ./skills/memory-manager/scripts/cleanup.js --days 30
```

## Configuration

Environment variables for customization:

```bash
export MEMORY_MANAGER_CACHE_DIRS="/tmp,~/.cache,./node_modules/.cache"
export MEMORY_MANAGER_LOG_DIRS="./logs,./output"
export MEMORY_MANAGER_MAX_AGE_DAYS="30"
export MEMORY_MANAGER_DISK_THRESHOLD="85"
export MEMORY_MANAGER_EXCLUDE_PATTERNS=".git,.env,node_modules"
```

## Integration

**OpenClaw Heartbeat**
```markdown
# Add to HEARTBEAT.md
- [ ] Check disk space (memory-manager/scripts/disk-check.js --threshold 85)
- [ ] Clean old files if needed (memory-manager/scripts/cleanup.js --days 14)
```

**Error Recovery**
```bash
# In error-recovery scripts
if [[ $(df / | tail -1 | awk '{print $5}' | sed 's/%//') -gt 85 ]]; then
  ./memory-manager/scripts/cleanup.js --cache-only --force
fi
```

## Output Examples

**Disk Check Output**
```
=== DISK USAGE ===
Filesystem      Size  Used Avail Use% Mounted on
───────────────────────────────────────────────────────
🟢 /dev/disk1s1  233G  180G   51G  78% /
🟡 /dev/disk2s1  500G  425G   75G  85% /Volumes/Data

=== RECOMMENDATIONS ===
⚠️ /Volumes/Data is 85% full (approaching threshold)
   • Schedule regular cleanup: ./cleanup.js --days 30
   • Monitor large directories  
   • Consider cleanup policies
```

**Cleanup Summary**
```
=== CLEANUP SUMMARY ===
Files processed: 1,247
Space freed: 2.34 GB
Duration: 12.45s
```

## Safety Features

- **Exclude Patterns** - Protects `.git`, `.env`, and other critical files
- **Age Thresholds** - Only removes files older than specified days
- **Dry Run Mode** - Preview all changes before applying
- **Backup Options** - Archive files before deletion
- **Size Validation** - Confirms file sizes before operations

## Requirements

- Node.js (built-in modules only)
- Unix-like system (macOS, Linux)
- Basic shell commands (`df`, `du`, `rm`)
- Optional: `sudo` for system-level cache clearing

## Troubleshooting

**Permission Errors**
```bash
# Fix script permissions
chmod +x scripts/*.js

# For system cache clearing
sudo ./scripts/optimize.js --full
```

**Large File Detection**
```bash
# Find largest directories
du -h . | sort -hr | head -20

# Target specific cleanup
./scripts/cleanup.js --deep --days 7
```

**Alert Setup**
```bash
# Enable webhook alerts
export DISK_ALERT_WEBHOOK="https://your-webhook-url"
./scripts/disk-check.js --alert --notify
```