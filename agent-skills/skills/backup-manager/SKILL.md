# 💾 Backup Manager Skill

Automated backup creation, encryption, rotation, and restoration for AI agents. Protect critical data, configurations, and wallet files with enterprise-grade backup strategies.

## When to Use

This skill triggers when you need to:
- "backup my data" or "create backup"
- "protect my wallet files" 
- "backup configurations"
- "setup automated backups"
- "restore from backup"
- "verify backup integrity"
- "backup rotation"
- "encrypted backups"
- "disaster recovery"

## What It Does

**Core Features:**
- Creates compressed tar archives of directories/files
- GPG encryption for sensitive data (wallets, keys, configs)
- Automated backup rotation (keeps last N backups)
- SHA256 checksum verification for integrity
- Metadata tracking (source, date, size, checksum)
- One-command restore with verification
- Pure Node.js - zero external dependencies

**Smart Defaults:**
- Excludes common junk: node_modules, .git, *.log, tmp
- Compresses by default (tar.gz)
- Stores in ~/.backups
- Keeps last 7 backups
- Generates checksums for all backups

## Usage

### Basic Commands

```bash
# Backup a directory
node backup.js create ~/.clawdbot clawdbot-config

# Backup with encryption (requires GPG key)
BACKUP_ENCRYPT=true BACKUP_GPG_KEY=your-key-id node backup.js create ~/wallets

# List all backups
node backup.js list

# Verify backup integrity
node backup.js verify ~/.backups/clawdbot-config_2024-03-11T19-36-00-000Z.tar.gz

# Restore backup
node backup.js restore ~/.backups/clawdbot-config_latest.tar.gz ~/restored
```

### Environment Configuration

```bash
export BACKUP_DIR=~/my-backups           # Custom backup directory
export BACKUP_ENCRYPT=true              # Enable GPG encryption
export BACKUP_GPG_KEY=0xYourKeyID       # GPG key for encryption
export BACKUP_MAX_KEEP=14               # Keep 14 backups instead of 7
```

### Agent Integration

```javascript
const BackupManager = require('./scripts/backup.js');

const manager = new BackupManager({
  backupDir: '~/.agent-backups',
  encryption: true,
  gpgKey: process.env.GPG_KEY,
  maxBackups: 5,
  excludePatterns: ['node_modules', '*.log', 'tmp', '.env']
});

// Create backup
const result = await manager.createBackup('~/.clawdbot', 'daily-config');
console.log(`Backup created: ${result.path} (${result.size} bytes)`);

// List backups
const backups = await manager.listBackups();
console.table(backups);

// Verify backup
const verification = await manager.verifyBackup(result.path);
if (!verification.valid) {
  throw new Error(`Backup corrupted: ${verification.reason}`);
}

// Restore backup
await manager.restoreBackup(result.path, '/tmp/restore-test');
```

## Common Workflows

### Daily Config Backup
```bash
#!/bin/bash
# Add to cron: 0 2 * * * /path/to/daily-backup.sh

cd ~/.clawdbot/skills/backup-manager
node scripts/backup.js create ~/.clawdbot daily-config
node scripts/backup.js create ~/.ssh ssh-keys
node scripts/backup.js create ~/important-scripts scripts
```

### Encrypted Wallet Backup
```bash
# Setup GPG key first
gpg --gen-key

# Backup with encryption
BACKUP_ENCRYPT=true BACKUP_GPG_KEY=your-email@domain.com \
  node backup.js create ~/wallets wallet-backup
```

### Pre-Deploy Safety Backup
```bash
# Before risky deployments
node backup.js create ~/production-app pre-deploy-$(date +%Y%m%d-%H%M)
```

### Disaster Recovery Test
```bash
# Regular recovery drills
mkdir /tmp/recovery-test
node backup.js restore ~/.backups/latest-config.tar.gz /tmp/recovery-test
diff -r ~/.clawdbot /tmp/recovery-test/clawdbot
```

## Security Features

**Encryption:** Uses GPG for military-grade encryption of sensitive backups. Private keys, wallet files, and configuration secrets are protected even if backup storage is compromised.

**Integrity:** Every backup includes SHA256 checksum verification. Corruption detection happens before restoration attempts.

**Rotation:** Automatic cleanup prevents disk space exhaustion while maintaining reasonable history depth.

**Exclusions:** Smart defaults exclude temporary files, logs, and common development artifacts that don't need backup protection.

## File Structure

```
backup-manager/
├── SKILL.md              # This file
├── scripts/
│   └── backup.js         # Main backup manager
└── README.md            # Installation guide
```

## Dependencies

- Node.js (built-in modules only)
- tar (system command)
- gpg (optional, for encryption)

## Error Handling

- Source path validation
- Disk space checks
- GPG key availability
- Tar command success
- Checksum verification
- Graceful rotation failures

## Performance

- Streaming checksums for large files
- Incremental compression
- Parallel backup operations
- Minimal memory footprint
- Fast metadata queries

This skill is essential for any production agent handling valuable data, configurations, or cryptographic materials.