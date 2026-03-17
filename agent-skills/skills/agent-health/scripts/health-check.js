#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const os = require('os');

class AgentHealth {
  constructor() {
    this.healthDir = path.join(os.homedir(), '.openclaw', 'health');
    this.metricsFile = path.join(this.healthDir, 'metrics.json');
    this.configFile = path.join(__dirname, '..', 'config.json');
    
    this.ensureDirectories();
    this.config = this.loadConfig();
  }

  ensureDirectories() {
    if (!fs.existsSync(this.healthDir)) {
      fs.mkdirSync(this.healthDir, { recursive: true });
    }
  }

  loadConfig() {
    const defaultConfig = {
      monitoring: {
        interval: 300,
        retention_days: 7,
        alert_thresholds: {
          api_success_rate: 0.85,
          memory_usage_mb: 1024,
          avg_response_time_ms: 5000,
          error_rate: 0.1
        }
      },
      recovery: {
        enabled: true,
        max_retries: 3,
        actions: ["restart_session", "clear_cache", "switch_model"]
      }
    };

    if (fs.existsSync(this.configFile)) {
      const userConfig = JSON.parse(fs.readFileSync(this.configFile, 'utf8'));
      return { ...defaultConfig, ...userConfig };
    }
    return defaultConfig;
  }

  loadMetrics() {
    if (!fs.existsSync(this.metricsFile)) {
      return {
        sessions: [],
        api_calls: [],
        errors: [],
        system: [],
        last_updated: new Date().toISOString()
      };
    }
    return JSON.parse(fs.readFileSync(this.metricsFile, 'utf8'));
  }

  saveMetrics(metrics) {
    metrics.last_updated = new Date().toISOString();
    fs.writeFileSync(this.metricsFile, JSON.stringify(metrics, null, 2));
  }

  getCurrentSystemMetrics() {
    const memUsage = process.memoryUsage();
    return {
      timestamp: new Date().toISOString(),
      memory: {
        rss: Math.round(memUsage.rss / 1024 / 1024), // MB
        heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
        heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024),
        external: Math.round(memUsage.external / 1024 / 1024)
      },
      cpu: {
        loadAvg: os.loadavg(),
        uptime: os.uptime()
      },
      system: {
        platform: os.platform(),
        arch: os.arch(),
        totalmem: Math.round(os.totalmem() / 1024 / 1024 / 1024), // GB
        freemem: Math.round(os.freemem() / 1024 / 1024 / 1024)
      }
    };
  }

  calculateHealthScore() {
    const metrics = this.loadMetrics();
    const now = new Date();
    const oneDayAgo = new Date(now - 24 * 60 * 60 * 1000);

    // Filter recent data
    const recentAPIs = metrics.api_calls.filter(call => 
      new Date(call.timestamp) > oneDayAgo
    );
    const recentErrors = metrics.errors.filter(error => 
      new Date(error.timestamp) > oneDayAgo
    );

    let scores = [];

    // API Success Rate (30% weight)
    if (recentAPIs.length > 0) {
      const successful = recentAPIs.filter(call => call.success).length;
      const apiScore = (successful / recentAPIs.length) * 100;
      scores.push({ metric: 'API Success Rate', score: apiScore, weight: 0.3 });
    }

    // Error Rate (25% weight) 
    if (recentAPIs.length > 0) {
      const errorRate = recentErrors.length / recentAPIs.length;
      const errorScore = Math.max(0, (1 - errorRate) * 100);
      scores.push({ metric: 'Error Rate', score: errorScore, weight: 0.25 });
    }

    // Memory Usage (20% weight)
    const currentMem = this.getCurrentSystemMetrics().memory.rss;
    const memThreshold = this.config.monitoring.alert_thresholds.memory_usage_mb;
    const memScore = Math.max(0, 100 - (currentMem / memThreshold) * 100);
    scores.push({ metric: 'Memory Usage', score: Math.min(100, memScore), weight: 0.2 });

    // Response Time (15% weight)
    if (recentAPIs.length > 0) {
      const avgResponseTime = recentAPIs.reduce((acc, call) => 
        acc + (call.response_time || 1000), 0) / recentAPIs.length;
      const timeThreshold = this.config.monitoring.alert_thresholds.avg_response_time_ms;
      const timeScore = Math.max(0, 100 - (avgResponseTime / timeThreshold) * 100);
      scores.push({ metric: 'Response Time', score: Math.min(100, timeScore), weight: 0.15 });
    }

    // Uptime (10% weight)
    const uptime = os.uptime();
    const uptimeScore = Math.min(100, (uptime / (24 * 60 * 60)) * 100); // 24h max
    scores.push({ metric: 'Uptime', score: uptimeScore, weight: 0.1 });

    // Calculate weighted average
    const totalWeight = scores.reduce((acc, s) => acc + s.weight, 0);
    const weightedScore = scores.reduce((acc, s) => acc + (s.score * s.weight), 0) / totalWeight;

    return {
      overall: Math.round(weightedScore),
      breakdown: scores,
      status: this.getHealthStatus(weightedScore),
      recommendations: this.getRecommendations(scores)
    };
  }

  getHealthStatus(score) {
    if (score >= 90) return 'EXCELLENT';
    if (score >= 80) return 'GOOD';
    if (score >= 70) return 'FAIR';
    if (score >= 60) return 'POOR';
    return 'CRITICAL';
  }

  getRecommendations(scores) {
    const recommendations = [];
    
    scores.forEach(scoreObj => {
      if (scoreObj.score < 70) {
        switch (scoreObj.metric) {
          case 'API Success Rate':
            recommendations.push('Consider implementing retry logic for failed API calls');
            break;
          case 'Error Rate':
            recommendations.push('Review error logs and implement better error handling');
            break;
          case 'Memory Usage':
            recommendations.push('Monitor memory leaks and consider restarting the agent');
            break;
          case 'Response Time':
            recommendations.push('Optimize API calls or increase timeout thresholds');
            break;
          case 'Uptime':
            recommendations.push('Investigate recent restarts and stability issues');
            break;
        }
      }
    });

    return recommendations;
  }

  generateReport(detailed = false) {
    const current = this.getCurrentSystemMetrics();
    const health = this.calculateHealthScore();
    const metrics = this.loadMetrics();

    const report = {
      timestamp: current.timestamp,
      health_score: health.overall,
      status: health.status,
      system: {
        memory_mb: current.memory.rss,
        memory_usage_pct: Math.round((current.memory.rss / 1024) * 100) / 100,
        load_avg: current.cpu.loadAvg[0],
        uptime_hours: Math.round(current.cpu.uptime / 3600 * 100) / 100
      }
    };

    if (detailed) {
      report.breakdown = health.breakdown;
      report.recommendations = health.recommendations;
      report.recent_metrics = {
        api_calls_24h: metrics.api_calls.filter(call => 
          new Date(call.timestamp) > new Date(Date.now() - 24*60*60*1000)
        ).length,
        errors_24h: metrics.errors.filter(error => 
          new Date(error.timestamp) > new Date(Date.now() - 24*60*60*1000)
        ).length
      };
    }

    return report;
  }

  recordMetric(type, data) {
    const metrics = this.loadMetrics();
    
    const entry = {
      timestamp: new Date().toISOString(),
      ...data
    };

    switch (type) {
      case 'api_call':
        metrics.api_calls.push(entry);
        break;
      case 'error':
        metrics.errors.push(entry);
        break;
      case 'session':
        metrics.sessions.push(entry);
        break;
      case 'system':
        metrics.system.push(entry);
        break;
    }

    // Cleanup old data
    this.cleanupOldMetrics(metrics);
    this.saveMetrics(metrics);
  }

  cleanupOldMetrics(metrics) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - this.config.monitoring.retention_days);

    ['api_calls', 'errors', 'sessions', 'system'].forEach(key => {
      metrics[key] = metrics[key].filter(item => 
        new Date(item.timestamp) > cutoff
      );
    });
  }
}

// CLI Interface
function main() {
  const args = process.argv.slice(2);
  const detailed = args.includes('--detailed');
  
  const health = new AgentHealth();
  
  // Record current system metrics
  health.recordMetric('system', health.getCurrentSystemMetrics());
  
  const report = health.generateReport(detailed);
  
  console.log('🔍 Agent Health Report');
  console.log('=====================');
  console.log(`Status: ${report.status} (${report.health_score}/100)`);
  console.log(`Memory: ${report.system.memory_mb}MB (${report.system.memory_usage_pct}%)`);
  console.log(`Load: ${report.system.load_avg.toFixed(2)}`);
  console.log(`Uptime: ${report.system.uptime_hours}h`);
  
  if (detailed && report.breakdown) {
    console.log('\n📊 Breakdown:');
    report.breakdown.forEach(item => {
      console.log(`  ${item.metric}: ${Math.round(item.score)}/100 (weight: ${item.weight})`);
    });
  }
  
  if (detailed && report.recommendations && report.recommendations.length > 0) {
    console.log('\n💡 Recommendations:');
    report.recommendations.forEach(rec => {
      console.log(`  • ${rec}`);
    });
  }
  
  if (detailed && report.recent_metrics) {
    console.log('\n📈 Recent Activity (24h):');
    console.log(`  API Calls: ${report.recent_metrics.api_calls_24h}`);
    console.log(`  Errors: ${report.recent_metrics.errors_24h}`);
  }
}

if (require.main === module) {
  main();
}

module.exports = AgentHealth;