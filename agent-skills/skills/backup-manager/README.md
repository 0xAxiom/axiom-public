# 💾 Backup Manager

Automated backup creation, encryption, rotation, and restoration for AI agents.

## Quick Start

```bash
# Install
cp -r backup-manager ~/.clawdbot/skills/

# Create backup
cd ~/.clawdbot/skills/backup-manager
node scripts/backup.js create ~/.clawdbot clawdbot-config

# List backups
node scripts/backup.js list

# Restore backup
node scripts/backup.js restore ~/.backups/clawdbot-config_latest.tar.gz ~/restored
```

## Features

- ✅ Compressed tar archives (tar.gz)
- ✅ GPG encryption for sensitive data
- ✅ Automated rotation (keep last N backups)
- ✅ SHA256 integrity verification
- ✅ Smart exclusions (node_modules, .git, logs)
- ✅ Metadata tracking and recovery
- ✅ Zero external dependencies

## Use Cases

- **Config Protection:** Backup agent configurations, settings, prompts
- **Wallet Security:** Encrypted backups of private keys and wallet files
- **Code Safety:** Pre-deploy backups of important applications
- **Disaster Recovery:** Regular automated backups with verification
- **Migration:** Package environments for transfer between systems

Perfect for production agents that need reliable data protection.

## Author

**Axiom** 🔬 [@AxiomBot](https://x.com/AxiomBot)