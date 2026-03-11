#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { exec, spawn } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

class BackupManager {
  constructor(config = {}) {
    this.config = {
      backupDir: config.backupDir || path.join(process.env.HOME, '.backups'),
      maxBackups: config.maxBackups || 7,
      compression: config.compression !== false,
      encryption: config.encryption || false,
      gpgKey: config.gpgKey || null,
      excludePatterns: config.excludePatterns || ['node_modules', '.git', '*.log', 'tmp'],
      ...config
    };
    
    // Ensure backup directory exists
    if (!fs.existsSync(this.config.backupDir)) {
      fs.mkdirSync(this.config.backupDir, { recursive: true });
    }
  }

  async createBackup(sourcePath, backupName) {
    if (!fs.existsSync(sourcePath)) {
      throw new Error(`Source path does not exist: ${sourcePath}`);
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupBaseName = `${backupName || path.basename(sourcePath)}_${timestamp}`;
    
    console.log(`Creating backup: ${backupBaseName}`);
    
    try {
      // Create tar archive
      const tarPath = await this.createTarArchive(sourcePath, backupBaseName);
      
      // Encrypt if enabled
      let finalPath = tarPath;
      if (this.config.encryption && this.config.gpgKey) {
        finalPath = await this.encryptBackup(tarPath);
        fs.unlinkSync(tarPath); // Remove unencrypted tar
      }
      
      // Generate checksum
      const checksum = await this.generateChecksum(finalPath);
      
      // Save metadata
      await this.saveMetadata(finalPath, {
        source: sourcePath,
        created: new Date().toISOString(),
        checksum,
        compressed: this.config.compression,
        encrypted: this.config.encryption
      });
      
      // Clean old backups
      await this.rotateBackups(backupName || path.basename(sourcePath));
      
      console.log(`Backup created: ${path.basename(finalPath)}`);
      console.log(`Checksum: ${checksum}`);
      
      return {
        path: finalPath,
        checksum,
        size: fs.statSync(finalPath).size
      };
      
    } catch (error) {
      console.error(`Backup failed: ${error.message}`);
      throw error;
    }
  }

  async createTarArchive(sourcePath, backupName) {
    const tarPath = path.join(this.config.backupDir, `${backupName}.tar${this.config.compression ? '.gz' : ''}`);
    
    // Build tar command
    let cmd = 'tar';
    let args = [this.config.compression ? '-czf' : '-cf', tarPath];
    
    // Add exclude patterns
    for (const pattern of this.config.excludePatterns) {
      args.push('--exclude', pattern);
    }
    
    args.push('-C', path.dirname(sourcePath), path.basename(sourcePath));
    
    console.log(`Running: ${cmd} ${args.join(' ')}`);
    
    try {
      await execAsync(`${cmd} ${args.map(arg => `"${arg}"`).join(' ')}`);
      return tarPath;
    } catch (error) {
      throw new Error(`Tar creation failed: ${error.message}`);
    }
  }

  async encryptBackup(tarPath) {
    const encryptedPath = `${tarPath}.gpg`;
    
    try {
      await execAsync(`gpg --trust-model always --encrypt -r "${this.config.gpgKey}" --output "${encryptedPath}" "${tarPath}"`);
      return encryptedPath;
    } catch (error) {
      throw new Error(`GPG encryption failed: ${error.message}`);
    }
  }

  async generateChecksum(filePath) {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha256');
      const stream = fs.createReadStream(filePath);
      
      stream.on('error', reject);
      stream.on('data', chunk => hash.update(chunk));
      stream.on('end', () => resolve(hash.digest('hex')));
    });
  }

  async saveMetadata(backupPath, metadata) {
    const metaPath = `${backupPath}.meta.json`;
    fs.writeFileSync(metaPath, JSON.stringify(metadata, null, 2));
  }

  async rotateBackups(baseName) {
    const files = fs.readdirSync(this.config.backupDir)
      .filter(file => file.startsWith(baseName) && (file.endsWith('.tar') || file.endsWith('.tar.gz') || file.endsWith('.tar.gpg') || file.endsWith('.tar.gz.gpg')))
      .map(file => ({
        name: file,
        path: path.join(this.config.backupDir, file),
        mtime: fs.statSync(path.join(this.config.backupDir, file)).mtime
      }))
      .sort((a, b) => b.mtime - a.mtime);

    if (files.length > this.config.maxBackups) {
      const toDelete = files.slice(this.config.maxBackups);
      for (const file of toDelete) {
        console.log(`Removing old backup: ${file.name}`);
        fs.unlinkSync(file.path);
        
        // Also remove metadata if exists
        const metaPath = `${file.path}.meta.json`;
        if (fs.existsSync(metaPath)) {
          fs.unlinkSync(metaPath);
        }
      }
    }
  }

  async listBackups() {
    const files = fs.readdirSync(this.config.backupDir)
      .filter(file => file.endsWith('.tar') || file.endsWith('.tar.gz') || file.endsWith('.tar.gpg') || file.endsWith('.tar.gz.gpg'))
      .map(file => {
        const filePath = path.join(this.config.backupDir, file);
        const stat = fs.statSync(filePath);
        const metaPath = `${filePath}.meta.json`;
        
        let metadata = {};
        if (fs.existsSync(metaPath)) {
          try {
            metadata = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
          } catch (e) {
            // Ignore metadata read errors
          }
        }
        
        return {
          name: file,
          size: stat.size,
          created: stat.mtime,
          ...metadata
        };
      })
      .sort((a, b) => new Date(b.created) - new Date(a.created));

    return files;
  }

  async verifyBackup(backupPath) {
    if (!fs.existsSync(backupPath)) {
      throw new Error(`Backup file not found: ${backupPath}`);
    }

    // Check metadata
    const metaPath = `${backupPath}.meta.json`;
    if (!fs.existsSync(metaPath)) {
      console.warn('No metadata file found');
      return { valid: false, reason: 'Missing metadata' };
    }

    const metadata = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    
    // Verify checksum
    const currentChecksum = await this.generateChecksum(backupPath);
    if (currentChecksum !== metadata.checksum) {
      return { valid: false, reason: 'Checksum mismatch' };
    }

    console.log(`Backup verified: ${path.basename(backupPath)}`);
    return { valid: true, metadata };
  }

  async restoreBackup(backupPath, targetDir) {
    const verification = await this.verifyBackup(backupPath);
    if (!verification.valid) {
      throw new Error(`Backup verification failed: ${verification.reason}`);
    }

    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    console.log(`Restoring ${path.basename(backupPath)} to ${targetDir}`);

    try {
      // Decrypt if needed
      let tarPath = backupPath;
      if (backupPath.endsWith('.gpg')) {
        const decryptedPath = backupPath.replace('.gpg', '');
        await execAsync(`gpg --decrypt "${backupPath}" > "${decryptedPath}"`);
        tarPath = decryptedPath;
      }

      // Extract tar
      const isCompressed = tarPath.endsWith('.gz');
      await execAsync(`tar -${isCompressed ? 'xzf' : 'xf'} "${tarPath}" -C "${targetDir}"`);

      // Clean up temporary decrypted file
      if (tarPath !== backupPath) {
        fs.unlinkSync(tarPath);
      }

      console.log(`Restore completed successfully`);
      return true;

    } catch (error) {
      throw new Error(`Restore failed: ${error.message}`);
    }
  }
}

// CLI Interface
if (require.main === module) {
  const args = process.argv.slice(2);
  const command = args[0];

  const manager = new BackupManager({
    encryption: process.env.BACKUP_ENCRYPT === 'true',
    gpgKey: process.env.BACKUP_GPG_KEY,
    maxBackups: parseInt(process.env.BACKUP_MAX_KEEP || '7'),
    backupDir: process.env.BACKUP_DIR
  });

  async function run() {
    try {
      switch (command) {
        case 'create':
          const sourcePath = args[1];
          const backupName = args[2];
          if (!sourcePath) {
            console.error('Usage: backup.js create <source-path> [backup-name]');
            process.exit(1);
          }
          const result = await manager.createBackup(sourcePath, backupName);
          console.log(JSON.stringify(result, null, 2));
          break;

        case 'list':
          const backups = await manager.listBackups();
          console.table(backups.map(b => ({
            Name: b.name,
            Size: `${(b.size / 1024 / 1024).toFixed(1)}MB`,
            Created: new Date(b.created).toLocaleString(),
            Source: b.source || 'N/A'
          })));
          break;

        case 'verify':
          const backupPath = args[1];
          if (!backupPath) {
            console.error('Usage: backup.js verify <backup-path>');
            process.exit(1);
          }
          const verification = await manager.verifyBackup(backupPath);
          console.log(JSON.stringify(verification, null, 2));
          break;

        case 'restore':
          const restoreBackup = args[1];
          const targetDir = args[2];
          if (!restoreBackup || !targetDir) {
            console.error('Usage: backup.js restore <backup-path> <target-dir>');
            process.exit(1);
          }
          await manager.restoreBackup(restoreBackup, targetDir);
          break;

        default:
          console.log(`Usage: backup.js <command> [args]

Commands:
  create <source-path> [backup-name]  Create a new backup
  list                               List all backups
  verify <backup-path>               Verify backup integrity
  restore <backup-path> <target-dir> Restore backup to directory

Environment Variables:
  BACKUP_DIR         Backup directory (default: ~/.backups)
  BACKUP_ENCRYPT     Enable GPG encryption (true/false)
  BACKUP_GPG_KEY     GPG key ID for encryption
  BACKUP_MAX_KEEP    Maximum backups to keep (default: 7)

Examples:
  backup.js create ~/.clawdbot clawdbot-config
  backup.js create ~/important-wallet wallet
  BACKUP_ENCRYPT=true BACKUP_GPG_KEY=your-key backup.js create ~/secrets
  backup.js list
  backup.js verify ~/.backups/wallet_2024-03-11T19-36-00-000Z.tar.gz
  backup.js restore ~/.backups/clawdbot-config_latest.tar.gz ~/restored
`);
          break;
      }
    } catch (error) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  }

  run();
}

module.exports = BackupManager;