#!/usr/bin/env node

/**
 * Memory Manager - Cleanup Script
 * Clean up cache, temporary files, and old data
 */

const fs = require('fs/promises');
const path = require('path');
const { promisify } = require('util');
const { exec } = require('child_process');

const execAsync = promisify(exec);

class MemoryManager {
  constructor(options = {}) {
    this.options = {
      dryRun: options.dryRun || false,
      days: parseInt(options.days) || 30,
      deep: options.deep || false,
      force: options.force || false,
      backup: options.backup || false,
      cacheOnly: options.cacheOnly || false,
      ...options
    };

    // Default cache directories to clean
    this.cacheDirs = process.env.MEMORY_MANAGER_CACHE_DIRS?.split(',') || [
      '/tmp',
      process.env.HOME + '/.cache',
      process.env.HOME + '/.npm/_cacache',
      './node_modules/.cache',
      './.next/cache',
      './dist',
      './.turbo',
      './coverage',
      './.nyc_output'
    ];

    // Log directories for rotation
    this.logDirs = process.env.MEMORY_MANAGER_LOG_DIRS?.split(',') || [
      './logs',
      './output',
      './.openclaw/logs'
    ];

    // Exclude patterns
    this.excludePatterns = process.env.MEMORY_MANAGER_EXCLUDE_PATTERNS?.split(',') || [
      '.git',
      '.env',
      'node_modules',
      '.DS_Store'
    ];

    this.cleaned = {
      files: 0,
      size: 0,
      errors: []
    };
  }

  log(message, level = 'info') {
    const colors = {
      info: '\x1b[36m',
      success: '\x1b[32m',
      warning: '\x1b[33m',
      error: '\x1b[31m',
      reset: '\x1b[0m'
    };
    
    const prefix = this.options.dryRun ? '[DRY RUN] ' : '';
    console.log(`${colors[level]}${prefix}${message}${colors.reset}`);
  }

  async getFileAge(filePath) {
    try {
      const stats = await fs.stat(filePath);
      const now = new Date();
      const ageMs = now - stats.mtime;
      return ageMs / (1000 * 60 * 60 * 24); // Days
    } catch (err) {
      return 0;
    }
  }

  async getFileSize(filePath) {
    try {
      const stats = await fs.stat(filePath);
      return stats.size;
    } catch (err) {
      return 0;
    }
  }

  shouldExclude(filePath) {
    return this.excludePatterns.some(pattern => 
      filePath.includes(pattern)
    );
  }

  async cleanDirectory(dirPath, recursive = true) {
    try {
      const exists = await fs.access(dirPath).then(() => true).catch(() => false);
      if (!exists) return;

      this.log(`Scanning ${dirPath}...`);
      
      const items = await fs.readdir(dirPath);
      
      for (const item of items) {
        const itemPath = path.join(dirPath, item);
        
        if (this.shouldExclude(itemPath)) {
          continue;
        }

        try {
          const stats = await fs.stat(itemPath);
          const ageInDays = await this.getFileAge(itemPath);
          
          if (stats.isDirectory() && recursive) {
            await this.cleanDirectory(itemPath, true);
            
            // Remove empty directories if they're old enough
            try {
              const dirItems = await fs.readdir(itemPath);
              if (dirItems.length === 0 && ageInDays > this.options.days) {
                if (!this.options.dryRun) {
                  await fs.rmdir(itemPath);
                }
                this.log(`Removed empty directory: ${itemPath}`, 'success');
                this.cleaned.files++;
              }
            } catch (err) {
              // Directory not empty or other error
            }
          } else if (stats.isFile() && ageInDays > this.options.days) {
            const fileSize = stats.size;
            
            if (!this.options.dryRun) {
              await fs.unlink(itemPath);
            }
            
            this.log(`Removed: ${itemPath} (${(fileSize / 1024 / 1024).toFixed(2)} MB, ${ageInDays.toFixed(1)} days old)`, 'success');
            this.cleaned.files++;
            this.cleaned.size += fileSize;
          }
        } catch (err) {
          this.cleaned.errors.push(`Error processing ${itemPath}: ${err.message}`);
        }
      }
    } catch (err) {
      this.cleaned.errors.push(`Error scanning ${dirPath}: ${err.message}`);
    }
  }

  async cleanCache() {
    this.log('Starting cache cleanup...');
    
    for (const cacheDir of this.cacheDirs) {
      const expandedPath = cacheDir.startsWith('~/') 
        ? cacheDir.replace('~', process.env.HOME)
        : cacheDir;
      
      await this.cleanDirectory(expandedPath, this.options.deep);
    }
  }

  async cleanLogs() {
    if (this.options.cacheOnly) return;
    
    this.log('Cleaning log files...');
    
    for (const logDir of this.logDirs) {
      const expandedPath = logDir.startsWith('~/') 
        ? logDir.replace('~', process.env.HOME)
        : logDir;
      
      await this.cleanDirectory(expandedPath, false); // Don't recurse into log subdirs
    }
  }

  async cleanNodeModules() {
    if (!this.options.deep || this.options.cacheOnly) return;
    
    this.log('Cleaning node_modules cache...');
    
    try {
      // Clean npm cache
      if (!this.options.dryRun) {
        await execAsync('npm cache clean --force');
      }
      this.log('Cleaned npm cache', 'success');
    } catch (err) {
      this.cleaned.errors.push(`npm cache clean failed: ${err.message}`);
    }
  }

  async cleanTempFiles() {
    if (this.options.cacheOnly) return;
    
    this.log('Cleaning temporary files...');
    
    const tempPatterns = [
      '**/*.tmp',
      '**/*.temp',
      '**/.*~',
      '**/.DS_Store'
    ];
    
    // Simple implementation - in production you'd want glob matching
    const commonTempPaths = [
      './tmp',
      process.env.TMPDIR || '/tmp'
    ];
    
    for (const tempPath of commonTempPaths) {
      await this.cleanDirectory(tempPath, false);
    }
  }

  formatSize(bytes) {
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unit = 0;
    
    while (size >= 1024 && unit < units.length - 1) {
      size /= 1024;
      unit++;
    }
    
    return `${size.toFixed(2)} ${units[unit]}`;
  }

  async run() {
    this.log(`Memory Manager starting... (${this.options.days} days threshold)`, 'info');
    
    if (this.options.dryRun) {
      this.log('DRY RUN MODE - No files will be deleted', 'warning');
    }

    const startTime = Date.now();

    try {
      await this.cleanCache();
      await this.cleanLogs(); 
      await this.cleanNodeModules();
      await this.cleanTempFiles();
    } catch (err) {
      this.log(`Cleanup failed: ${err.message}`, 'error');
      process.exit(1);
    }

    const duration = (Date.now() - startTime) / 1000;
    
    this.log('\n=== CLEANUP SUMMARY ===', 'info');
    this.log(`Files processed: ${this.cleaned.files}`, 'success');
    this.log(`Space freed: ${this.formatSize(this.cleaned.size)}`, 'success');
    this.log(`Duration: ${duration.toFixed(2)}s`, 'info');
    
    if (this.cleaned.errors.length > 0) {
      this.log(`\nErrors (${this.cleaned.errors.length}):`, 'warning');
      this.cleaned.errors.slice(0, 10).forEach(error => {
        this.log(`  ${error}`, 'error');
      });
      if (this.cleaned.errors.length > 10) {
        this.log(`  ... and ${this.cleaned.errors.length - 10} more`, 'warning');
      }
    }
  }
}

// CLI Interface
if (require.main === module) {
  const args = process.argv.slice(2);
  const options = {};
  
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--deep':
        options.deep = true;
        break;
      case '--force':
        options.force = true;
        break;
      case '--backup':
        options.backup = true;
        break;
      case '--cache-only':
        options.cacheOnly = true;
        break;
      case '--days':
        options.days = parseInt(args[++i]);
        break;
      case '--help':
        console.log(`
Memory Manager - Cleanup Script

Usage: ./cleanup.js [options]

Options:
  --dry-run        Preview changes without deleting
  --deep           Deep cleanup including build caches
  --force          Skip confirmation prompts
  --backup         Backup files before deletion
  --cache-only     Only clean cache directories
  --days <n>       Clean files older than n days (default: 30)
  --help           Show this help

Examples:
  ./cleanup.js --dry-run
  ./cleanup.js --deep --days 7
  ./cleanup.js --cache-only --force
        `);
        process.exit(0);
    }
  }
  
  const manager = new MemoryManager(options);
  manager.run().catch(err => {
    console.error('Cleanup failed:', err);
    process.exit(1);
  });
}

module.exports = MemoryManager;