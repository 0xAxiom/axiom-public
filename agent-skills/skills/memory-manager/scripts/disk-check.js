#!/usr/bin/env node

/**
 * Memory Manager - Disk Space Monitor
 * Check disk usage and provide storage recommendations
 */

const { exec } = require('child_process');
const { promisify } = require('util');
const fs = require('fs/promises');

const execAsync = promisify(exec);

class DiskMonitor {
  constructor(options = {}) {
    this.options = {
      threshold: parseInt(options.threshold) || 85,
      alert: options.alert || false,
      notify: options.notify || false,
      json: options.json || false,
      ...options
    };

    this.status = {
      critical: false,
      warnings: [],
      recommendations: []
    };
  }

  log(message, level = 'info') {
    if (this.options.json) return;
    
    const colors = {
      info: '\x1b[36m',
      success: '\x1b[32m',
      warning: '\x1b[33m',
      error: '\x1b[31m',
      reset: '\x1b[0m'
    };
    
    console.log(`${colors[level]}${message}${colors.reset}`);
  }

  async getDiskUsage() {
    try {
      const { stdout } = await execAsync('df -h');
      const lines = stdout.split('\n').slice(1); // Skip header
      
      const disks = [];
      
      for (const line of lines) {
        if (!line.trim()) continue;
        
        const parts = line.split(/\s+/);
        if (parts.length >= 6) {
          const filesystem = parts[0];
          const size = parts[1];
          const used = parts[2];
          const available = parts[3];
          const usePercent = parseInt(parts[4].replace('%', ''));
          const mountPoint = parts[5];
          
          disks.push({
            filesystem,
            size,
            used,
            available,
            usePercent,
            mountPoint
          });
        }
      }
      
      return disks;
    } catch (err) {
      throw new Error(`Failed to get disk usage: ${err.message}`);
    }
  }

  async getDirectorySizes(paths) {
    const sizes = {};
    
    for (const dirPath of paths) {
      try {
        const { stdout } = await execAsync(`du -sh "${dirPath}" 2>/dev/null`);
        const size = stdout.split('\t')[0];
        sizes[dirPath] = size;
      } catch (err) {
        sizes[dirPath] = 'N/A';
      }
    }
    
    return sizes;
  }

  async getLargestDirectories(rootPath = '.', limit = 10) {
    try {
      const { stdout } = await execAsync(`du -h "${rootPath}" 2>/dev/null | sort -hr | head -${limit}`);
      return stdout.split('\n').filter(line => line.trim()).map(line => {
        const parts = line.split('\t');
        return {
          size: parts[0],
          path: parts[1]
        };
      });
    } catch (err) {
      return [];
    }
  }

  generateRecommendations(disks) {
    const recommendations = [];
    
    for (const disk of disks) {
      if (disk.usePercent > this.options.threshold) {
        this.status.critical = true;
        
        recommendations.push({
          severity: 'critical',
          message: `${disk.mountPoint} is ${disk.usePercent}% full (${disk.used}/${disk.size})`,
          actions: [
            'Run cleanup script: ./cleanup.js --deep --days 7',
            'Clear cache: ./cleanup.js --cache-only',
            'Archive old logs and files',
            'Consider moving large files to external storage'
          ]
        });
      } else if (disk.usePercent > this.options.threshold - 10) {
        this.status.warnings.push({
          severity: 'warning',
          message: `${disk.mountPoint} is ${disk.usePercent}% full (approaching threshold)`,
          actions: [
            'Schedule regular cleanup: ./cleanup.js --days 30',
            'Monitor large directories',
            'Consider cleanup policies'
          ]
        });
      }
    }
    
    return recommendations;
  }

  formatOutput(disks, recommendations, directorySizes) {
    if (this.options.json) {
      return JSON.stringify({
        timestamp: new Date().toISOString(),
        disks,
        recommendations,
        directorySizes,
        status: this.status
      }, null, 2);
    }

    let output = '';
    
    // Disk usage table
    output += '\n=== DISK USAGE ===\n';
    output += 'Filesystem      Size  Used Avail Use% Mounted on\n';
    output += '─'.repeat(55) + '\n';
    
    for (const disk of disks) {
      const status = disk.usePercent > this.options.threshold ? '🔴' : 
                    disk.usePercent > this.options.threshold - 10 ? '🟡' : '🟢';
      output += `${status} ${disk.filesystem.padEnd(12)} ${disk.size.padStart(4)} ${disk.used.padStart(4)} ${disk.available.padStart(5)} ${disk.usePercent.toString().padStart(3)}% ${disk.mountPoint}\n`;
    }
    
    // Large directories
    if (directorySizes.length > 0) {
      output += '\n=== LARGEST DIRECTORIES ===\n';
      directorySizes.forEach(dir => {
        output += `${dir.size.padStart(6)} ${dir.path}\n`;
      });
    }
    
    // Recommendations
    if (recommendations.length > 0 || this.status.warnings.length > 0) {
      output += '\n=== RECOMMENDATIONS ===\n';
      
      [...recommendations, ...this.status.warnings].forEach(rec => {
        const icon = rec.severity === 'critical' ? '🚨' : '⚠️';
        output += `\n${icon} ${rec.message}\n`;
        rec.actions.forEach(action => {
          output += `   • ${action}\n`;
        });
      });
    } else {
      output += '\n✅ All disks are within acceptable usage limits\n';
    }
    
    return output;
  }

  async sendAlert(message) {
    if (!this.options.alert) return;
    
    // Write alert to file for monitoring systems to pick up
    const alertFile = './disk-alert.txt';
    await fs.writeFile(alertFile, `${new Date().toISOString()}: ${message}\n`, { flag: 'a' });
    
    // If webhook URL is configured, send notification
    if (process.env.DISK_ALERT_WEBHOOK) {
      try {
        const webhook = process.env.DISK_ALERT_WEBHOOK;
        const payload = JSON.stringify({
          text: `Disk Space Alert: ${message}`,
          timestamp: new Date().toISOString()
        });
        
        await execAsync(`curl -X POST -H "Content-Type: application/json" -d '${payload}' "${webhook}"`);
        this.log('Alert sent to webhook', 'success');
      } catch (err) {
        this.log(`Failed to send webhook alert: ${err.message}`, 'error');
      }
    }
  }

  async run() {
    try {
      this.log('Checking disk usage...', 'info');
      
      const disks = await this.getDiskUsage();
      const recommendations = this.generateRecommendations(disks);
      
      // Get largest directories in current path
      const largestDirs = await this.getLargestDirectories('.', 10);
      
      // Check common problematic directories
      const commonDirs = [
        './node_modules',
        './logs',
        './tmp',
        './.next',
        './dist',
        './.cache'
      ];
      
      const dirSizes = await getDirectorySizes(commonDirs.filter(dir => 
        fs.access(dir).then(() => true).catch(() => false)
      ));

      const output = this.formatOutput(disks, recommendations, largestDirs);
      
      if (this.options.json) {
        console.log(output);
      } else {
        console.log(output);
      }
      
      // Send alerts if critical
      if (this.status.critical && this.options.alert) {
        const criticalDisks = disks.filter(d => d.usePercent > this.options.threshold);
        for (const disk of criticalDisks) {
          await this.sendAlert(`${disk.mountPoint} is ${disk.usePercent}% full`);
        }
      }
      
      // Exit with error code if critical
      if (this.status.critical) {
        process.exit(1);
      }
      
    } catch (err) {
      this.log(`Disk check failed: ${err.message}`, 'error');
      process.exit(1);
    }
  }
}

// Fix scoping issue
async function getDirectorySizes(paths) {
  const sizes = {};
  
  for (const dirPath of paths) {
    try {
      const { stdout } = await execAsync(`du -sh "${dirPath}" 2>/dev/null`);
      const size = stdout.split('\t')[0];
      sizes[dirPath] = size;
    } catch (err) {
      sizes[dirPath] = 'N/A';
    }
  }
  
  return sizes;
}

// CLI Interface
if (require.main === module) {
  const args = process.argv.slice(2);
  const options = {};
  
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--threshold':
        options.threshold = parseInt(args[++i]);
        break;
      case '--alert':
        options.alert = true;
        break;
      case '--notify':
        options.notify = true;
        break;
      case '--json':
        options.json = true;
        break;
      case '--help':
        console.log(`
Memory Manager - Disk Space Monitor

Usage: ./disk-check.js [options]

Options:
  --threshold <n>  Alert threshold percentage (default: 85)
  --alert          Enable file-based alerts
  --notify         Enable webhook notifications
  --json           Output in JSON format
  --help           Show this help

Environment:
  DISK_ALERT_WEBHOOK  Webhook URL for critical alerts

Examples:
  ./disk-check.js --threshold 90
  ./disk-check.js --alert --notify
  ./disk-check.js --json | jq '.disks'
        `);
        process.exit(0);
    }
  }
  
  const monitor = new DiskMonitor(options);
  monitor.run().catch(err => {
    console.error('Disk check failed:', err);
    process.exit(1);
  });
}

module.exports = DiskMonitor;