#!/usr/bin/env node

const AgentHealth = require('./health-check.js');
const fs = require('fs');
const path = require('path');

class AgentHealthMonitor {
  constructor() {
    this.health = new AgentHealth();
    this.monitoring = false;
    this.intervalId = null;
  }

  async startMonitoring(intervalSeconds = 300, alertThreshold = 0.8) {
    if (this.monitoring) {
      console.log('⚠️  Monitor is already running');
      return;
    }

    console.log(`🔍 Starting agent health monitoring (interval: ${intervalSeconds}s)`);
    this.monitoring = true;
    
    // Initial health check
    await this.performHealthCheck(alertThreshold);
    
    // Set up interval monitoring
    this.intervalId = setInterval(async () => {
      await this.performHealthCheck(alertThreshold);
    }, intervalSeconds * 1000);

    // Handle graceful shutdown
    process.on('SIGINT', () => {
      console.log('\n📡 Stopping health monitor...');
      this.stopMonitoring();
      process.exit(0);
    });

    process.on('SIGTERM', () => {
      this.stopMonitoring();
      process.exit(0);
    });
  }

  stopMonitoring() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.monitoring = false;
    console.log('✅ Health monitoring stopped');
  }

  async performHealthCheck(alertThreshold) {
    const timestamp = new Date().toISOString();
    
    try {
      // Record system metrics
      const systemMetrics = this.health.getCurrentSystemMetrics();
      this.health.recordMetric('system', systemMetrics);
      
      // Calculate health score
      const healthReport = this.health.generateReport(true);
      
      // Log status
      const statusEmoji = this.getStatusEmoji(healthReport.status);
      console.log(`${timestamp} ${statusEmoji} Health: ${healthReport.health_score}/100 (${healthReport.status})`);
      
      // Check for alerts
      await this.checkAlerts(healthReport, alertThreshold);
      
      // Auto-recovery if enabled and needed
      if (this.health.config.recovery.enabled && healthReport.health_score < 50) {
        await this.attemptRecovery(healthReport);
      }
      
    } catch (error) {
      console.error(`❌ Health check failed: ${error.message}`);
      this.health.recordMetric('error', {
        type: 'health_check_failed',
        message: error.message,
        stack: error.stack
      });
    }
  }

  getStatusEmoji(status) {
    const emojis = {
      'EXCELLENT': '💚',
      'GOOD': '🟢', 
      'FAIR': '🟡',
      'POOR': '🟠',
      'CRITICAL': '🔴'
    };
    return emojis[status] || '⚪';
  }

  async checkAlerts(report, threshold) {
    const alertScore = threshold * 100;
    
    if (report.health_score < alertScore) {
      const alert = {
        timestamp: new Date().toISOString(),
        level: report.health_score < 50 ? 'CRITICAL' : 'WARNING',
        health_score: report.health_score,
        status: report.status,
        breakdown: report.breakdown,
        recommendations: report.recommendations
      };
      
      console.log(`🚨 ALERT: Health score below threshold (${report.health_score}/${alertScore})`);
      
      // Save alert
      await this.saveAlert(alert);
      
      // Send notifications if configured
      await this.sendNotification(alert);
    }
  }

  async saveAlert(alert) {
    const alertsFile = path.join(this.health.healthDir, 'alerts.json');
    let alerts = [];
    
    if (fs.existsSync(alertsFile)) {
      alerts = JSON.parse(fs.readFileSync(alertsFile, 'utf8'));
    }
    
    alerts.push(alert);
    
    // Keep only last 100 alerts
    if (alerts.length > 100) {
      alerts = alerts.slice(-100);
    }
    
    fs.writeFileSync(alertsFile, JSON.stringify(alerts, null, 2));
  }

  async sendNotification(alert) {
    const config = this.health.config.alerts;
    
    if (!config) return;
    
    const message = `🚨 Agent Health Alert\nScore: ${alert.health_score}/100 (${alert.status})\nRecommendations: ${alert.recommendations.slice(0, 2).join(', ')}`;
    
    // Webhook notification
    if (config.webhook_url) {
      try {
        const response = await fetch(config.webhook_url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: message,
            alert: alert
          })
        });
        
        if (response.ok) {
          console.log('📡 Alert sent to webhook');
        }
      } catch (error) {
        console.error('Failed to send webhook alert:', error.message);
      }
    }
    
    // File notification (for OpenClaw to pick up)
    if (config.file_alert) {
      const alertFile = path.join(this.health.healthDir, 'current_alert.json');
      fs.writeFileSync(alertFile, JSON.stringify({
        ...alert,
        message: message
      }, null, 2));
    }
  }

  async attemptRecovery(report) {
    const config = this.health.config.recovery;
    const actions = config.actions || [];
    
    console.log('🔧 Attempting auto-recovery...');
    
    for (const action of actions.slice(0, config.max_retries)) {
      try {
        const success = await this.executeRecoveryAction(action);
        
        this.health.recordMetric('recovery', {
          action: action,
          success: success,
          health_score_before: report.health_score
        });
        
        if (success) {
          console.log(`✅ Recovery action successful: ${action}`);
          break;
        } else {
          console.log(`❌ Recovery action failed: ${action}`);
        }
        
      } catch (error) {
        console.error(`Recovery action error (${action}):`, error.message);
      }
    }
  }

  async executeRecoveryAction(action) {
    switch (action) {
      case 'clear_cache':
        // Clear temporary files and caches
        const cacheDir = path.join(this.health.healthDir, 'cache');
        if (fs.existsSync(cacheDir)) {
          fs.rmSync(cacheDir, { recursive: true, force: true });
          fs.mkdirSync(cacheDir, { recursive: true });
        }
        return true;
        
      case 'restart_session':
        // Signal for session restart (OpenClaw can pick this up)
        const restartFile = path.join(this.health.healthDir, 'restart_requested');
        fs.writeFileSync(restartFile, new Date().toISOString());
        return true;
        
      case 'switch_model':
        // Create model switch request
        const modelSwitchFile = path.join(this.health.healthDir, 'model_switch_requested');
        fs.writeFileSync(modelSwitchFile, JSON.stringify({
          timestamp: new Date().toISOString(),
          reason: 'auto_recovery',
          fallback: true
        }));
        return true;
        
      default:
        console.log(`Unknown recovery action: ${action}`);
        return false;
    }
  }
}

// CLI Interface
function main() {
  const args = process.argv.slice(2);
  
  let interval = 300; // default 5 minutes
  let alertThreshold = 0.8; // default 80%
  
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--interval' && args[i + 1]) {
      interval = parseInt(args[i + 1]);
      i++;
    } else if (args[i] === '--alert-threshold' && args[i + 1]) {
      alertThreshold = parseFloat(args[i + 1]);
      i++;
    }
  }
  
  if (interval < 30) {
    console.log('⚠️  Minimum interval is 30 seconds');
    interval = 30;
  }
  
  const monitor = new AgentHealthMonitor();
  monitor.startMonitoring(interval, alertThreshold);
}

if (require.main === module) {
  main();
}

module.exports = AgentHealthMonitor;