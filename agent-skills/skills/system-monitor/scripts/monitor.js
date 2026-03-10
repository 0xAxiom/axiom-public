#!/usr/bin/env node

/**
 * System Monitor - Comprehensive system health monitoring
 * Pure Node.js implementation with no external dependencies
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

class SystemMonitor {
  constructor(options = {}) {
    this.options = {
      diskThreshold: options.diskThreshold || 85,
      memoryThreshold: options.memoryThreshold || 80,
      cpuThreshold: options.cpuThreshold || 90,
      services: options.services || [],
      networks: options.networks || ['8.8.8.8', '1.1.1.1'],
      ports: options.ports || [22, 80, 443],
      json: options.json || false,
      watch: options.watch || false,
      interval: options.interval || 300, // 5 minutes
      summary: options.summary || false,
      strict: options.strict || false,
      webhook: options.webhook || null
    };

    this.alerts = [];
    this.loadConfig();
  }

  loadConfig() {
    const configPath = path.join(__dirname, '..', '.system-monitor.json');
    try {
      if (fs.existsSync(configPath)) {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        if (config.thresholds) {
          this.options.diskThreshold = config.thresholds.disk || this.options.diskThreshold;
          this.options.memoryThreshold = config.thresholds.memory || this.options.memoryThreshold;
          this.options.cpuThreshold = config.thresholds.cpu || this.options.cpuThreshold;
        }
        if (config.services) this.options.services = config.services;
        if (config.networks) this.options.networks = config.networks;
        if (config.ports) this.options.ports = config.ports;
        if (config.alerts?.webhook) this.options.webhook = config.alerts.webhook;
      }
    } catch (err) {
      // Ignore config errors, use defaults
    }
  }

  async getDiskUsage() {
    const diskInfo = [];
    try {
      if (process.platform === 'darwin' || process.platform === 'linux') {
        const output = execSync('df -h', { encoding: 'utf8' });
        const lines = output.split('\n').slice(1);
        
        for (const line of lines) {
          if (line.trim()) {
            const parts = line.trim().split(/\s+/);
            if (parts.length >= 6) {
              const usage = parseInt(parts[4].replace('%', ''));
              const mount = parts[5];
              diskInfo.push({
                filesystem: parts[0],
                size: parts[1],
                used: parts[2],
                available: parts[3],
                usage: usage,
                mount: mount,
                alert: usage >= this.options.diskThreshold
              });

              if (usage >= this.options.diskThreshold) {
                this.alerts.push(`High disk usage: ${mount} at ${usage}%`);
              }
            }
          }
        }
      }
    } catch (err) {
      this.alerts.push(`Failed to get disk usage: ${err.message}`);
    }
    return diskInfo;
  }

  getMemoryUsage() {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const usage = Math.round((usedMem / totalMem) * 100);

    const memInfo = {
      total: this.formatBytes(totalMem),
      used: this.formatBytes(usedMem),
      free: this.formatBytes(freeMem),
      usage: usage,
      alert: usage >= this.options.memoryThreshold
    };

    if (usage >= this.options.memoryThreshold) {
      this.alerts.push(`High memory usage: ${usage}%`);
    }

    return memInfo;
  }

  getCpuLoad() {
    const cpus = os.cpus();
    const loadAvg = os.loadavg();
    
    // Calculate CPU usage over 1 second
    const startMeasure = cpus.map(cpu => {
      const total = Object.values(cpu.times).reduce((acc, time) => acc + time, 0);
      const idle = cpu.times.idle;
      return { total, idle };
    });

    // Wait 1 second then measure again (simplified for this example)
    const load1min = Math.round(loadAvg[0] * 100);
    const load5min = Math.round(loadAvg[1] * 100);
    const load15min = Math.round(loadAvg[2] * 100);

    const cpuInfo = {
      cores: cpus.length,
      load1min: load1min,
      load5min: load5min,
      load15min: load15min,
      alert: load1min >= this.options.cpuThreshold
    };

    if (load1min >= this.options.cpuThreshold) {
      this.alerts.push(`High CPU load: ${load1min}% (1min avg)`);
    }

    return cpuInfo;
  }

  async checkServices() {
    const serviceStatus = [];
    
    for (const service of this.options.services) {
      try {
        let isRunning = false;
        let pid = null;

        if (process.platform === 'darwin' || process.platform === 'linux') {
          try {
            const output = execSync(`pgrep -f "${service}"`, { encoding: 'utf8' });
            const pids = output.trim().split('\n').filter(p => p);
            isRunning = pids.length > 0;
            pid = pids[0];
          } catch {
            isRunning = false;
          }
        }

        serviceStatus.push({
          name: service,
          running: isRunning,
          pid: pid,
          alert: !isRunning
        });

        if (!isRunning) {
          this.alerts.push(`Service not running: ${service}`);
        }
      } catch (err) {
        serviceStatus.push({
          name: service,
          running: false,
          error: err.message,
          alert: true
        });
        this.alerts.push(`Failed to check service ${service}: ${err.message}`);
      }
    }

    return serviceStatus;
  }

  async checkNetwork() {
    const networkStatus = [];

    for (const host of this.options.networks) {
      try {
        const cmd = process.platform === 'win32' ? 
          `ping -n 1 ${host}` : 
          `ping -c 1 -W 3 ${host}`;
        
        execSync(cmd, { stdio: 'pipe' });
        networkStatus.push({
          host: host,
          reachable: true,
          alert: false
        });
      } catch {
        networkStatus.push({
          host: host,
          reachable: false,
          alert: true
        });
        this.alerts.push(`Network unreachable: ${host}`);
      }
    }

    return networkStatus;
  }

  getSystemInfo() {
    return {
      hostname: os.hostname(),
      platform: os.platform(),
      arch: os.arch(),
      uptime: this.formatUptime(os.uptime()),
      nodeVersion: process.version,
      timestamp: new Date().toISOString()
    };
  }

  formatBytes(bytes) {
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    if (bytes === 0) return '0 B';
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
  }

  formatUptime(seconds) {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${days}d ${hours}h ${minutes}m`;
  }

  async sendAlert(message) {
    if (this.options.webhook) {
      try {
        const payload = JSON.stringify({
          text: `🚨 System Alert: ${message}`,
          timestamp: new Date().toISOString()
        });

        // Use curl since we want zero dependencies
        execSync(`curl -X POST -H "Content-Type: application/json" -d '${payload}' "${this.options.webhook}"`, 
          { stdio: 'pipe' });
      } catch (err) {
        console.error('Failed to send webhook alert:', err.message);
      }
    }
  }

  async monitor() {
    this.alerts = []; // Reset alerts
    
    const results = {
      system: this.getSystemInfo(),
      disk: await this.getDiskUsage(),
      memory: this.getMemoryUsage(),
      cpu: this.getCpuLoad(),
      services: await this.checkServices(),
      network: await this.checkNetwork(),
      alerts: this.alerts,
      healthy: this.alerts.length === 0
    };

    // Send alerts if any
    if (this.alerts.length > 0 && this.options.webhook) {
      await this.sendAlert(this.alerts.join(', '));
    }

    return results;
  }

  async run() {
    if (this.options.watch) {
      console.log(`Starting system monitor (${this.options.interval}s intervals)...`);
      
      const runCheck = async () => {
        const results = await this.monitor();
        
        if (this.options.json) {
          console.log(JSON.stringify(results, null, 2));
        } else {
          this.printResults(results);
        }
      };

      await runCheck();
      setInterval(runCheck, this.options.interval * 1000);
    } else {
      const results = await this.monitor();
      
      if (this.options.json) {
        console.log(JSON.stringify(results, null, 2));
      } else {
        this.printResults(results);
      }

      if (this.options.strict && !results.healthy) {
        process.exit(1);
      }
    }
  }

  printResults(results) {
    console.log('=== System Health Monitor ===');
    console.log(`Hostname: ${results.system.hostname}`);
    console.log(`Uptime: ${results.system.uptime}`);
    console.log(`Timestamp: ${results.system.timestamp}`);
    console.log('');

    if (this.options.summary) {
      console.log(`Status: ${results.healthy ? '✅ Healthy' : '🚨 Issues Detected'}`);
      console.log(`Alerts: ${results.alerts.length}`);
      if (results.alerts.length > 0) {
        results.alerts.forEach(alert => console.log(`  ⚠️  ${alert}`));
      }
      return;
    }

    console.log('💾 Disk Usage:');
    results.disk.forEach(disk => {
      const icon = disk.alert ? '🚨' : '✅';
      console.log(`  ${icon} ${disk.mount}: ${disk.usage}% (${disk.used}/${disk.size})`);
    });

    console.log('\n🧠 Memory Usage:');
    const memIcon = results.memory.alert ? '🚨' : '✅';
    console.log(`  ${memIcon} ${results.memory.usage}% (${results.memory.used}/${results.memory.total})`);

    console.log('\n⚡ CPU Load:');
    const cpuIcon = results.cpu.alert ? '🚨' : '✅';
    console.log(`  ${cpuIcon} Load: ${results.cpu.load1min}% (1m), ${results.cpu.load5min}% (5m), ${results.cpu.load15min}% (15m)`);

    if (results.services.length > 0) {
      console.log('\n🔧 Services:');
      results.services.forEach(svc => {
        const icon = svc.alert ? '🚨' : '✅';
        const status = svc.running ? `running (PID: ${svc.pid})` : 'stopped';
        console.log(`  ${icon} ${svc.name}: ${status}`);
      });
    }

    if (results.network.length > 0) {
      console.log('\n🌐 Network:');
      results.network.forEach(net => {
        const icon = net.alert ? '🚨' : '✅';
        const status = net.reachable ? 'reachable' : 'unreachable';
        console.log(`  ${icon} ${net.host}: ${status}`);
      });
    }

    if (results.alerts.length > 0) {
      console.log('\n🚨 Alerts:');
      results.alerts.forEach(alert => console.log(`  ⚠️  ${alert}`));
    } else {
      console.log('\n✅ All systems healthy');
    }
  }
}

// CLI
if (require.main === module) {
  const args = process.argv.slice(2);
  const options = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    if (arg === '--disk-threshold' && args[i + 1]) {
      options.diskThreshold = parseInt(args[++i]);
    } else if (arg === '--memory-threshold' && args[i + 1]) {
      options.memoryThreshold = parseInt(args[++i]);
    } else if (arg === '--cpu-threshold' && args[i + 1]) {
      options.cpuThreshold = parseInt(args[++i]);
    } else if (arg === '--services' && args[i + 1]) {
      options.services = args[++i].split(',');
    } else if (arg === '--interval' && args[i + 1]) {
      options.interval = parseInt(args[++i]);
    } else if (arg === '--webhook' && args[i + 1]) {
      options.webhook = args[++i];
    } else if (arg === '--json') {
      options.json = true;
    } else if (arg === '--watch') {
      options.watch = true;
    } else if (arg === '--summary') {
      options.summary = true;
    } else if (arg === '--strict') {
      options.strict = true;
    }
  }

  const monitor = new SystemMonitor(options);
  monitor.run().catch(err => {
    console.error('Monitor failed:', err.message);
    process.exit(1);
  });
}

module.exports = SystemMonitor;