#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const APIThrottle = require('./throttle.js');

class HealthChecker extends APIThrottle {
  constructor() {
    super();
    this.metricsPath = path.join(this.statePath, 'metrics.json');
  }

  getProviderHealth(provider) {
    const config = this.config[provider];
    if (!config) {
      return { status: 'unknown', error: 'Provider not configured' };
    }

    const health = {
      provider,
      status: 'healthy',
      endpoints: {},
      overallMetrics: {
        totalLimits: 0,
        activeLimits: 0,
        queuedRequests: 0
      }
    };

    // Check each endpoint
    for (const endpoint of Object.keys(config.rateLimits)) {
      const endpointHealth = this.getEndpointHealth(provider, endpoint);
      health.endpoints[endpoint] = endpointHealth;
      
      health.overallMetrics.totalLimits++;
      if (endpointHealth.rateLimited) {
        health.overallMetrics.activeLimits++;
      }
      health.overallMetrics.queuedRequests += endpointHealth.queueLength;
    }

    // Determine overall status
    if (health.overallMetrics.activeLimits > 0) {
      health.status = 'throttled';
    }

    if (health.overallMetrics.queuedRequests > 100) {
      health.status = 'degraded';
    }

    return health;
  }

  getEndpointHealth(provider, endpoint) {
    const key = `${provider}:${endpoint}`;
    const config = this.config[provider]?.rateLimits[endpoint];
    const limitData = this.limits[key];
    const queueData = this.queues[key] || [];

    if (!config) {
      return { status: 'unknown', error: 'Endpoint not configured' };
    }

    const health = {
      endpoint,
      status: 'healthy',
      rateLimited: false,
      queueLength: queueData.length,
      metrics: {
        requestsInWindow: 0,
        windowUtilization: 0,
        averageWaitTime: 0,
        oldestQueuedRequest: null
      }
    };

    // Calculate current rate limit utilization
    if (limitData) {
      const now = Date.now();
      const windowMs = this.parseWindow(config.window);
      const windowStart = now - windowMs;
      
      const recentRequests = limitData.requests.filter(time => time > windowStart);
      health.metrics.requestsInWindow = recentRequests.length;
      health.metrics.windowUtilization = (recentRequests.length / config.requests) * 100;
      health.rateLimited = recentRequests.length >= config.requests;
    }

    // Queue metrics
    if (queueData.length > 0) {
      const now = Date.now();
      const waitTimes = queueData.map(req => now - req.timestamp);
      health.metrics.averageWaitTime = waitTimes.reduce((sum, time) => sum + time, 0) / waitTimes.length;
      health.metrics.oldestQueuedRequest = Math.max(...waitTimes);
      
      // Determine status based on queue
      if (queueData.length > 50) {
        health.status = 'degraded';
      } else if (queueData.length > 10) {
        health.status = 'busy';
      }
    }

    if (health.rateLimited) {
      health.status = 'throttled';
    }

    return health;
  }

  getAllHealth() {
    const overall = {
      timestamp: new Date().toISOString(),
      status: 'healthy',
      providers: {},
      summary: {
        totalProviders: 0,
        healthyProviders: 0,
        throttledProviders: 0,
        degradedProviders: 0,
        totalQueuedRequests: 0
      }
    };

    // Check each configured provider
    for (const provider of Object.keys(this.config)) {
      const providerHealth = this.getProviderHealth(provider);
      overall.providers[provider] = providerHealth;
      overall.summary.totalProviders++;
      overall.summary.totalQueuedRequests += providerHealth.overallMetrics.queuedRequests;

      switch (providerHealth.status) {
        case 'healthy':
          overall.summary.healthyProviders++;
          break;
        case 'throttled':
          overall.summary.throttledProviders++;
          break;
        case 'degraded':
          overall.summary.degradedProviders++;
          break;
      }
    }

    // Determine overall status
    if (overall.summary.degradedProviders > 0) {
      overall.status = 'degraded';
    } else if (overall.summary.throttledProviders > 0) {
      overall.status = 'throttled';
    }

    return overall;
  }

  getMetrics() {
    try {
      if (fs.existsSync(this.metricsPath)) {
        return JSON.parse(fs.readFileSync(this.metricsPath, 'utf8'));
      }
    } catch (error) {
      console.error('Failed to load metrics:', error.message);
    }
    
    return {
      requests: {},
      errors: {},
      queues: {},
      lastUpdated: null
    };
  }

  updateMetrics() {
    const metrics = this.getMetrics();
    const now = Date.now();

    // Update queue metrics
    for (const [queueKey, requests] of Object.entries(this.queues)) {
      if (!metrics.queues[queueKey]) {
        metrics.queues[queueKey] = {
          totalRequests: 0,
          totalWaitTime: 0,
          maxWaitTime: 0,
          samples: 0
        };
      }

      const queueMetrics = metrics.queues[queueKey];
      
      if (requests.length > 0) {
        const waitTimes = requests.map(req => now - req.timestamp);
        const avgWait = waitTimes.reduce((sum, time) => sum + time, 0) / waitTimes.length;
        const maxWait = Math.max(...waitTimes);

        queueMetrics.totalRequests += requests.length;
        queueMetrics.totalWaitTime += avgWait;
        queueMetrics.maxWaitTime = Math.max(queueMetrics.maxWaitTime, maxWait);
        queueMetrics.samples++;
      }
    }

    metrics.lastUpdated = new Date().toISOString();
    
    try {
      fs.writeFileSync(this.metricsPath, JSON.stringify(metrics, null, 2));
    } catch (error) {
      console.error('Failed to save metrics:', error.message);
    }

    return metrics;
  }

  generateReport() {
    const health = this.getAllHealth();
    const metrics = this.getMetrics();

    const report = {
      timestamp: health.timestamp,
      status: health.status,
      summary: health.summary,
      alerts: [],
      recommendations: []
    };

    // Generate alerts
    for (const [provider, providerData] of Object.entries(health.providers)) {
      if (providerData.status === 'degraded') {
        report.alerts.push({
          level: 'error',
          provider,
          message: `Provider ${provider} is degraded with ${providerData.overallMetrics.queuedRequests} queued requests`
        });
      }

      if (providerData.status === 'throttled') {
        report.alerts.push({
          level: 'warning',
          provider,
          message: `Provider ${provider} is being throttled`
        });
      }

      // Check for stuck queues
      for (const [endpoint, endpointData] of Object.entries(providerData.endpoints)) {
        if (endpointData.metrics.oldestQueuedRequest > 300000) { // 5 minutes
          report.alerts.push({
            level: 'warning',
            provider,
            endpoint,
            message: `Queue for ${provider}:${endpoint} has requests waiting over 5 minutes`
          });
        }
      }
    }

    // Generate recommendations
    if (health.summary.totalQueuedRequests > 200) {
      report.recommendations.push('Consider increasing rate limits or adding more API keys');
    }

    if (health.summary.throttledProviders > health.summary.healthyProviders) {
      report.recommendations.push('Most providers are throttled - review usage patterns');
    }

    return report;
  }
}

// CLI interface
async function main() {
  const args = process.argv.slice(2);
  const healthChecker = new HealthChecker();
  
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Health Checker - Monitor API throttling health

Usage:
  node health-check.js [options]
  
Options:
  --provider <name>   Check specific provider
  --report            Generate full health report
  --metrics           Show metrics only
  --update-metrics    Update metrics and exit
  --export <file>     Export results to file
  --watch             Continuous monitoring
  
Examples:
  node health-check.js
  node health-check.js --provider twitter
  node health-check.js --report
  node health-check.js --export health.json
  node health-check.js --watch
`);
    return;
  }

  try {
    let result;
    
    if (args.includes('--update-metrics')) {
      result = healthChecker.updateMetrics();
      console.log('Metrics updated');
      
    } else if (args.includes('--metrics')) {
      result = healthChecker.getMetrics();
      
    } else if (args.includes('--report')) {
      result = healthChecker.generateReport();
      
    } else if (args.includes('--provider')) {
      const provider = args[args.indexOf('--provider') + 1];
      if (!provider) {
        console.error('Provider name is required');
        process.exit(1);
      }
      result = healthChecker.getProviderHealth(provider);
      
    } else if (args.includes('--watch')) {
      console.log('Starting continuous health monitoring...');
      console.log('Press Ctrl+C to stop\n');
      
      const monitor = () => {
        console.clear();
        console.log('=== API Health Monitor ===');
        console.log(`Last updated: ${new Date().toISOString()}\n`);
        
        const health = healthChecker.getAllHealth();
        
        // Status overview
        console.log(`Overall Status: ${health.status.toUpperCase()}`);
        console.log(`Providers: ${health.summary.healthyProviders} healthy, ${health.summary.throttledProviders} throttled, ${health.summary.degradedProviders} degraded`);
        console.log(`Total Queued: ${health.summary.totalQueuedRequests}\n`);
        
        // Provider details
        for (const [provider, data] of Object.entries(health.providers)) {
          const statusIcon = data.status === 'healthy' ? '🟢' : 
                           data.status === 'throttled' ? '🟡' : '🔴';
          console.log(`${statusIcon} ${provider}: ${data.status} (${data.overallMetrics.queuedRequests} queued)`);
        }
        
        setTimeout(monitor, 10000); // Update every 10 seconds
      };
      
      monitor();
      
      // Keep process alive
      await new Promise(() => {});
      
    } else {
      result = healthChecker.getAllHealth();
    }
    
    // Export to file if requested
    if (args.includes('--export')) {
      const exportFile = args[args.indexOf('--export') + 1];
      if (!exportFile) {
        console.error('Export filename is required');
        process.exit(1);
      }
      
      fs.writeFileSync(exportFile, JSON.stringify(result, null, 2));
      console.log(`Results exported to ${exportFile}`);
    } else if (result) {
      console.log(JSON.stringify(result, null, 2));
    }
    
  } catch (error) {
    console.error('Health check failed:', error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = HealthChecker;