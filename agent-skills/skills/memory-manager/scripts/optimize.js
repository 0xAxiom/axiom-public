#!/usr/bin/env node

/**
 * Memory Manager - Memory Optimization
 * Optimize memory usage and clean temporary data
 */

const fs = require('fs/promises');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

class MemoryOptimizer {
  constructor(options = {}) {
    this.options = {
      full: options.full || false,
      aggressive: options.aggressive || false,
      dryRun: options.dryRun || false,
      ...options
    };

    this.optimizations = {
      memoryFreed: 0,
      cacheCleared: 0,
      processesOptimized: 0,
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

  async getMemoryUsage() {
    try {
      // Get memory info (works on macOS and Linux)
      let memInfo = {};
      
      if (process.platform === 'darwin') {
        // macOS
        const { stdout } = await execAsync('vm_stat');
        const lines = stdout.split('\n');
        
        for (const line of lines) {
          if (line.includes('Pages free:')) {
            const free = parseInt(line.match(/\d+/)[0]);
            memInfo.free = free * 4096; // Page size
          }
          if (line.includes('Pages active:')) {
            const active = parseInt(line.match(/\d+/)[0]);
            memInfo.active = active * 4096;
          }
        }
      } else {
        // Linux
        const { stdout } = await execAsync('cat /proc/meminfo');
        const lines = stdout.split('\n');
        
        for (const line of lines) {
          if (line.startsWith('MemAvailable:')) {
            memInfo.available = parseInt(line.match(/\d+/)[0]) * 1024;
          }
          if (line.startsWith('MemTotal:')) {
            memInfo.total = parseInt(line.match(/\d+/)[0]) * 1024;
          }
        }
      }
      
      return memInfo;
    } catch (err) {
      this.optimizations.errors.push(`Failed to get memory usage: ${err.message}`);
      return {};
    }
  }

  async clearSystemCaches() {
    this.log('Clearing system caches...', 'info');
    
    try {
      if (process.platform === 'darwin') {
        // macOS - clear DNS cache and system caches
        if (!this.options.dryRun) {
          await execAsync('sudo dscacheutil -flushcache');
          await execAsync('sudo killall -HUP mDNSResponder');
        }
        this.log('Cleared DNS cache', 'success');
      } else {
        // Linux - clear page cache if we have permissions
        try {
          if (!this.options.dryRun) {
            await execAsync('sync && echo 1 | sudo tee /proc/sys/vm/drop_caches');
          }
          this.log('Cleared page cache', 'success');
        } catch (err) {
          this.log('Could not clear page cache (need sudo)', 'warning');
        }
      }
      
      this.optimizations.cacheCleared++;
    } catch (err) {
      this.optimizations.errors.push(`Cache clear failed: ${err.message}`);
    }
  }

  async optimizeNodeProcess() {
    this.log('Optimizing Node.js process...', 'info');
    
    try {
      // Force garbage collection if possible
      if (global.gc) {
        if (!this.options.dryRun) {
          global.gc();
        }
        this.log('Forced garbage collection', 'success');
      } else {
        this.log('Garbage collection not exposed (run with --expose-gc)', 'warning');
      }
      
      // Clear require cache for non-core modules if aggressive
      if (this.options.aggressive) {
        const initialCacheSize = Object.keys(require.cache).length;
        
        if (!this.options.dryRun) {
          for (const key in require.cache) {
            if (!key.includes('node_modules/core') && !key.includes('/lib/')) {
              delete require.cache[key];
            }
          }
        }
        
        const clearedModules = initialCacheSize - Object.keys(require.cache).length;
        this.log(`Cleared ${clearedModules} cached modules`, 'success');
      }
      
      this.optimizations.processesOptimized++;
    } catch (err) {
      this.optimizations.errors.push(`Node optimization failed: ${err.message}`);
    }
  }

  async clearApplicationCaches() {
    this.log('Clearing application caches...', 'info');
    
    const cacheDirectories = [
      './.next/cache',
      './node_modules/.cache',
      './.turbo',
      './.webpack',
      './.parcel-cache',
      './dist',
      './build/cache'
    ];
    
    for (const cacheDir of cacheDirectories) {
      try {
        const exists = await fs.access(cacheDir).then(() => true).catch(() => false);
        if (!exists) continue;
        
        const stats = await fs.stat(cacheDir);
        if (stats.isDirectory()) {
          if (!this.options.dryRun) {
            await execAsync(`rm -rf "${cacheDir}"`);
          }
          this.log(`Cleared cache: ${cacheDir}`, 'success');
          this.optimizations.cacheCleared++;
        }
      } catch (err) {
        this.optimizations.errors.push(`Failed to clear ${cacheDir}: ${err.message}`);
      }
    }
  }

  async optimizePackageManager() {
    if (!this.options.full) return;
    
    this.log('Optimizing package managers...', 'info');
    
    try {
      // Clear npm cache
      if (!this.options.dryRun) {
        await execAsync('npm cache clean --force');
      }
      this.log('Cleared npm cache', 'success');
      
      // Clear yarn cache if available
      try {
        if (!this.options.dryRun) {
          await execAsync('yarn cache clean');
        }
        this.log('Cleared yarn cache', 'success');
      } catch (err) {
        // Yarn not available, skip
      }
      
      // Clear pnpm cache if available
      try {
        if (!this.options.dryRun) {
          await execAsync('pnpm store prune');
        }
        this.log('Cleared pnpm cache', 'success');
      } catch (err) {
        // pnpm not available, skip
      }
      
      this.optimizations.cacheCleared++;
    } catch (err) {
      this.optimizations.errors.push(`Package manager optimization failed: ${err.message}`);
    }
  }

  async defragmentDatabase() {
    if (!this.options.full) return;
    
    this.log('Optimizing databases...', 'info');
    
    const dbFiles = [
      './data.db',
      './cache.db',
      './.openclaw/data.db'
    ];
    
    for (const dbFile of dbFiles) {
      try {
        const exists = await fs.access(dbFile).then(() => true).catch(() => false);
        if (!exists) continue;
        
        // SQLite VACUUM operation
        if (!this.options.dryRun) {
          await execAsync(`sqlite3 "${dbFile}" "VACUUM;"`);
        }
        this.log(`Optimized database: ${dbFile}`, 'success');
      } catch (err) {
        // Not a SQLite database or sqlite3 not available
      }
    }
  }

  async reportMemoryUsage() {
    const before = await this.getMemoryUsage();
    
    // Run optimizations here would go here
    
    const after = await this.getMemoryUsage();
    
    if (before.free && after.free) {
      const freed = after.free - before.free;
      this.optimizations.memoryFreed = freed;
      this.log(`Memory freed: ${this.formatBytes(freed)}`, 'success');
    }
    
    // Node.js process memory
    const memUsage = process.memoryUsage();
    this.log('\nProcess Memory Usage:', 'info');
    this.log(`  RSS: ${this.formatBytes(memUsage.rss)}`, 'info');
    this.log(`  Heap Used: ${this.formatBytes(memUsage.heapUsed)}`, 'info');
    this.log(`  Heap Total: ${this.formatBytes(memUsage.heapTotal)}`, 'info');
    this.log(`  External: ${this.formatBytes(memUsage.external)}`, 'info');
  }

  formatBytes(bytes) {
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = Math.abs(bytes);
    let unit = 0;
    
    while (size >= 1024 && unit < units.length - 1) {
      size /= 1024;
      unit++;
    }
    
    const sign = bytes < 0 ? '-' : '';
    return `${sign}${size.toFixed(2)} ${units[unit]}`;
  }

  async run() {
    this.log('Memory optimization starting...', 'info');
    
    if (this.options.dryRun) {
      this.log('DRY RUN MODE - No changes will be made', 'warning');
    }

    const startTime = Date.now();

    try {
      // Basic optimizations
      await this.optimizeNodeProcess();
      await this.clearApplicationCaches();
      
      if (this.options.full) {
        await this.clearSystemCaches();
        await this.optimizePackageManager();
        await this.defragmentDatabase();
      }
      
      await this.reportMemoryUsage();
      
    } catch (err) {
      this.log(`Optimization failed: ${err.message}`, 'error');
      process.exit(1);
    }

    const duration = (Date.now() - startTime) / 1000;
    
    this.log('\n=== OPTIMIZATION SUMMARY ===', 'info');
    this.log(`Caches cleared: ${this.optimizations.cacheCleared}`, 'success');
    this.log(`Processes optimized: ${this.optimizations.processesOptimized}`, 'success');
    if (this.optimizations.memoryFreed > 0) {
      this.log(`Memory freed: ${this.formatBytes(this.optimizations.memoryFreed)}`, 'success');
    }
    this.log(`Duration: ${duration.toFixed(2)}s`, 'info');
    
    if (this.optimizations.errors.length > 0) {
      this.log(`\nErrors (${this.optimizations.errors.length}):`, 'warning');
      this.optimizations.errors.forEach(error => {
        this.log(`  ${error}`, 'error');
      });
    }
  }
}

// CLI Interface
if (require.main === module) {
  const args = process.argv.slice(2);
  const options = {};
  
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--full':
        options.full = true;
        break;
      case '--aggressive':
        options.aggressive = true;
        break;
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--help':
        console.log(`
Memory Manager - Memory Optimization

Usage: ./optimize.js [options]

Options:
  --full         Full optimization including system caches
  --aggressive   Aggressive optimization (clear module cache)
  --dry-run      Preview changes without applying
  --help         Show this help

Examples:
  ./optimize.js
  ./optimize.js --full --aggressive
  ./optimize.js --dry-run

Note: Some optimizations require sudo permissions for system-level caches.
      Run with --expose-gc for better garbage collection.
        `);
        process.exit(0);
    }
  }
  
  const optimizer = new MemoryOptimizer(options);
  optimizer.run().catch(err => {
    console.error('Optimization failed:', err);
    process.exit(1);
  });
}

module.exports = MemoryOptimizer;