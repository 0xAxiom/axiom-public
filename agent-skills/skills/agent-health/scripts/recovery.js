#!/usr/bin/env node

const AgentHealth = require('./health-check.js');
const fs = require('fs');
const path = require('path');
const os = require('os');

class AgentRecovery {
  constructor() {
    this.health = new AgentHealth();
  }

  async diagnose() {
    console.log('🔍 Running agent diagnostics...\n');
    
    const report = this.health.generateReport(true);
    const issues = [];
    
    // Check each component
    report.breakdown.forEach(item => {
      if (item.score < 70) {
        issues.push({
          component: item.metric,
          score: item.score,
          severity: item.score < 50 ? 'HIGH' : 'MEDIUM'
        });
      }
    });
    
    if (issues.length === 0) {
      console.log('✅ No issues detected. Agent health is good.');
      return;
    }
    
    console.log('🚨 Issues detected:');
    issues.forEach(issue => {
      const severityEmoji = issue.severity === 'HIGH' ? '🔴' : '🟡';
      console.log(`  ${severityEmoji} ${issue.component}: ${Math.round(issue.score)}/100 (${issue.severity})`);
    });
    
    console.log('\n💡 Suggested recovery actions:');
    
    issues.forEach(issue => {
      const actions = this.getRecoveryActions(issue.component);
      console.log(`\n${issue.component}:`);
      actions.forEach(action => {
        console.log(`  • ${action}`);
      });
    });
  }

  getRecoveryActions(component) {
    const actions = {
      'API Success Rate': [
        'Check network connectivity',
        'Verify API endpoints are responding',
        'Review and increase timeout values',
        'Implement exponential backoff retry logic',
        'Switch to backup API providers if available'
      ],
      'Error Rate': [
        'Review error logs for patterns',
        'Update error handling in critical paths',
        'Check for rate limiting issues',
        'Verify authentication tokens are valid',
        'Restart the agent process'
      ],
      'Memory Usage': [
        'Clear temporary files and caches',
        'Restart the agent process',
        'Check for memory leaks in recent code',
        'Increase system memory if possible',
        'Review large object allocations'
      ],
      'Response Time': [
        'Optimize database queries',
        'Review API call patterns for efficiency',
        'Enable caching where appropriate',
        'Check system load and resource usage',
        'Consider using faster models or providers'
      ],
      'Uptime': [
        'Review crash logs',
        'Check system stability',
        'Update dependencies',
        'Implement better error recovery',
        'Monitor system resources'
      ]
    };
    
    return actions[component] || ['Manual investigation required'];
  }

  async executeRecovery(action) {
    console.log(`🔧 Executing recovery action: ${action}`);
    
    switch (action) {
      case 'clear-cache':
        return await this.clearCache();
      
      case 'restart-request':
        return await this.requestRestart();
      
      case 'health-reset':
        return await this.resetHealthMetrics();
      
      case 'cleanup':
        return await this.cleanupTempFiles();
      
      case 'verify-apis':
        return await this.verifyAPIs();
      
      default:
        console.log(`❌ Unknown action: ${action}`);
        return false;
    }
  }

  async clearCache() {
    try {
      const cacheDir = path.join(this.health.healthDir, 'cache');
      
      if (fs.existsSync(cacheDir)) {
        fs.rmSync(cacheDir, { recursive: true, force: true });
      }
      
      fs.mkdirSync(cacheDir, { recursive: true });
      
      console.log('✅ Cache cleared successfully');
      return true;
    } catch (error) {
      console.error('❌ Failed to clear cache:', error.message);
      return false;
    }
  }

  async requestRestart() {
    try {
      const restartFile = path.join(this.health.healthDir, 'restart_requested');
      const restartData = {
        timestamp: new Date().toISOString(),
        reason: 'manual_recovery',
        pid: process.pid
      };
      
      fs.writeFileSync(restartFile, JSON.stringify(restartData, null, 2));
      
      console.log('✅ Restart request filed. OpenClaw should pick this up.');
      return true;
    } catch (error) {
      console.error('❌ Failed to request restart:', error.message);
      return false;
    }
  }

  async resetHealthMetrics() {
    try {
      const metricsBackup = path.join(this.health.healthDir, `metrics_backup_${Date.now()}.json`);
      
      // Backup current metrics
      if (fs.existsSync(this.health.metricsFile)) {
        fs.copyFileSync(this.health.metricsFile, metricsBackup);
      }
      
      // Reset to fresh metrics
      const freshMetrics = {
        sessions: [],
        api_calls: [],
        errors: [],
        system: [],
        last_updated: new Date().toISOString()
      };
      
      this.health.saveMetrics(freshMetrics);
      
      console.log(`✅ Health metrics reset. Backup saved to: ${path.basename(metricsBackup)}`);
      return true;
    } catch (error) {
      console.error('❌ Failed to reset metrics:', error.message);
      return false;
    }
  }

  async cleanupTempFiles() {
    try {
      const tempDirs = [
        path.join(os.tmpdir(), 'openclaw*'),
        path.join(this.health.healthDir, 'temp'),
        '/tmp/openclaw*'
      ];
      
      let cleanedCount = 0;
      
      for (const pattern of tempDirs) {
        // Simple cleanup - remove temp subdirectories
        const tempDir = pattern.replace('*', '');
        if (fs.existsSync(tempDir) && fs.statSync(tempDir).isDirectory()) {
          fs.rmSync(tempDir, { recursive: true, force: true });
          cleanedCount++;
        }
      }
      
      console.log(`✅ Cleaned up ${cleanedCount} temporary directories`);
      return true;
    } catch (error) {
      console.error('❌ Failed to cleanup temp files:', error.message);
      return false;
    }
  }

  async verifyAPIs() {
    const testEndpoints = [
      'https://api.github.com/zen',
      'https://httpbin.org/status/200',
      'https://api.coinbase.com/v2/time'
    ];
    
    let successCount = 0;
    const results = [];
    
    for (const endpoint of testEndpoints) {
      try {
        const startTime = Date.now();
        const response = await fetch(endpoint, { 
          method: 'GET',
          timeout: 5000 
        });
        const responseTime = Date.now() - startTime;
        
        const success = response.ok;
        results.push({
          endpoint,
          success,
          status: response.status,
          responseTime
        });
        
        if (success) successCount++;
        
      } catch (error) {
        results.push({
          endpoint,
          success: false,
          error: error.message
        });
      }
    }
    
    console.log(`\n🌐 API Connectivity Test Results:`);
    results.forEach(result => {
      const emoji = result.success ? '✅' : '❌';
      const time = result.responseTime ? `(${result.responseTime}ms)` : '';
      console.log(`  ${emoji} ${result.endpoint} ${time}`);
      if (!result.success && result.error) {
        console.log(`      Error: ${result.error}`);
      }
    });
    
    const successRate = (successCount / testEndpoints.length) * 100;
    console.log(`\nConnectivity: ${successCount}/${testEndpoints.length} (${Math.round(successRate)}%)`);
    
    return successRate > 50;
  }
}

// CLI Interface
function main() {
  const args = process.argv.slice(2);
  const recovery = new AgentRecovery();
  
  if (args.length === 0 || args[0] === 'diagnose') {
    recovery.diagnose();
    return;
  }
  
  const action = args[0];
  recovery.executeRecovery(action)
    .then(success => {
      process.exit(success ? 0 : 1);
    })
    .catch(error => {
      console.error('Recovery failed:', error.message);
      process.exit(1);
    });
}

if (require.main === module) {
  main();
}

module.exports = AgentRecovery;