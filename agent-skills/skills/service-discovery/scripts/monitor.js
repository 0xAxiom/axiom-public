#!/usr/bin/env node

const fs = require('fs');
const { healthCheck } = require('./health-check.js');

class ServiceMonitor {
    constructor(config, options = {}) {
        this.config = config;
        this.interval = options.interval || 300; // 5 minutes default
        this.logFile = options.logFile;
        this.alertThreshold = options.alertThreshold || 3; // Failed checks before alert
        this.running = false;
        this.failureCounts = new Map();
        this.stats = {
            startTime: new Date(),
            checksRun: 0,
            totalFailures: 0,
            services: new Map()
        };
    }
    
    async start() {
        if (this.running) return;
        
        console.log(`Starting service monitor (interval: ${this.interval}s)`);
        console.log(`Monitoring ${this.config.services.length} services`);
        
        this.running = true;
        await this.runChecks(); // Run immediately
        
        this.timer = setInterval(async () => {
            if (this.running) {
                await this.runChecks();
            }
        }, this.interval * 1000);
    }
    
    stop() {
        if (!this.running) return;
        
        console.log('Stopping service monitor');
        this.running = false;
        
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
        
        this.printSummary();
    }
    
    async runChecks() {
        const timestamp = new Date().toISOString();
        console.log(`[${timestamp}] Running health checks...`);
        
        const results = [];
        
        for (const service of this.config.services) {
            try {
                const options = {
                    timeout: service.timeout || 10000,
                    method: service.method || 'GET',
                    headers: service.headers || {}
                };
                
                const result = await healthCheck(service.url, options);
                result.name = service.name || service.url;
                result.critical = service.critical || false;
                
                this.updateStats(service, result);
                this.checkAlerts(service, result);
                
                results.push(result);
                
            } catch (error) {
                const result = {
                    name: service.name || service.url,
                    service: service.url,
                    status: 'unhealthy',
                    critical: service.critical || false,
                    errors: [error.message],
                    timestamp
                };
                
                this.updateStats(service, result);
                this.checkAlerts(service, result);
                
                results.push(result);
            }
        }
        
        this.stats.checksRun++;
        
        // Log results if file specified
        if (this.logFile) {
            this.logResults(results);
        }
        
        // Print status summary
        this.printStatus(results);
    }
    
    updateStats(service, result) {
        const serviceName = service.name || service.url;
        
        if (!this.stats.services.has(serviceName)) {
            this.stats.services.set(serviceName, {
                totalChecks: 0,
                failures: 0,
                avgResponseTime: 0,
                lastStatus: null,
                uptime: 0
            });
        }
        
        const serviceStats = this.stats.services.get(serviceName);
        serviceStats.totalChecks++;
        serviceStats.lastStatus = result.status;
        
        if (result.status === 'unhealthy') {
            serviceStats.failures++;
            this.stats.totalFailures++;
        } else {
            serviceStats.uptime++;
        }
        
        if (result.responseTime) {
            serviceStats.avgResponseTime = 
                (serviceStats.avgResponseTime * (serviceStats.totalChecks - 1) + result.responseTime) 
                / serviceStats.totalChecks;
        }
    }
    
    checkAlerts(service, result) {
        const serviceName = service.name || service.url;
        
        if (result.status === 'unhealthy') {
            const count = (this.failureCounts.get(serviceName) || 0) + 1;
            this.failureCounts.set(serviceName, count);
            
            if (count >= this.alertThreshold) {
                this.sendAlert(service, result, count);
                this.failureCounts.set(serviceName, 0); // Reset after alert
            }
        } else {
            // Service recovered, reset failure count
            if (this.failureCounts.has(serviceName)) {
                this.failureCounts.set(serviceName, 0);
            }
        }
    }
    
    sendAlert(service, result, failureCount) {
        const critical = service.critical ? ' (CRITICAL)' : '';
        console.log(`\n🚨 ALERT: ${service.name || service.url}${critical}`);
        console.log(`   Status: ${result.status}`);
        console.log(`   Failures: ${failureCount}/${this.alertThreshold}`);
        
        if (result.errors.length > 0) {
            console.log(`   Errors: ${result.errors.join(', ')}`);
        }
        
        console.log(`   Time: ${result.timestamp}\n`);
        
        // Here you could integrate with external alerting systems
        // e.g., send webhook, email, SMS, etc.
    }
    
    logResults(results) {
        const logEntry = {
            timestamp: new Date().toISOString(),
            results
        };
        
        try {
            fs.appendFileSync(this.logFile, JSON.stringify(logEntry) + '\n');
        } catch (error) {
            console.error(`Failed to write to log file: ${error.message}`);
        }
    }
    
    printStatus(results) {
        const healthy = results.filter(r => r.status === 'healthy').length;
        const degraded = results.filter(r => r.status === 'degraded').length;
        const unhealthy = results.filter(r => r.status === 'unhealthy').length;
        
        console.log(`Status: ${healthy} healthy, ${degraded} degraded, ${unhealthy} unhealthy`);
        
        // Show any current failures
        const failures = results.filter(r => r.status === 'unhealthy');
        if (failures.length > 0) {
            console.log('Current failures:');
            failures.forEach(failure => {
                const critical = failure.critical ? ' (CRITICAL)' : '';
                console.log(`  ❌ ${failure.name}${critical}`);
            });
        }
        
        console.log('');
    }
    
    printSummary() {
        const runtime = Math.floor((Date.now() - this.stats.startTime) / 1000);
        console.log('\n📊 Monitor Summary');
        console.log('═'.repeat(40));
        console.log(`Runtime: ${runtime} seconds`);
        console.log(`Total checks: ${this.stats.checksRun}`);
        console.log(`Total failures: ${this.stats.totalFailures}`);
        console.log('');
        
        console.log('Service Statistics:');
        for (const [name, stats] of this.stats.services) {
            const uptime = ((stats.uptime / stats.totalChecks) * 100).toFixed(1);
            const avgResponse = Math.round(stats.avgResponseTime);
            
            console.log(`  ${name}:`);
            console.log(`    Uptime: ${uptime}% (${stats.uptime}/${stats.totalChecks})`);
            console.log(`    Avg Response: ${avgResponse}ms`);
            console.log(`    Last Status: ${stats.lastStatus}`);
            console.log('');
        }
    }
}

// CLI usage
if (require.main === module) {
    const args = process.argv.slice(2);
    
    if (args.length === 0 || args.includes('--help')) {
        console.log('Usage: node monitor.js --config <config.json> [options]');
        console.log('');
        console.log('Options:');
        console.log('  --config <file>     Service configuration file');
        console.log('  --interval <sec>    Check interval in seconds (default: 300)');
        console.log('  --log <file>        Log file for results');
        console.log('  --threshold <num>   Alert threshold (default: 3)');
        console.log('  --help             Show this help');
        console.log('');
        console.log('Example:');
        console.log('  node monitor.js --config services.json --interval 60 --log monitor.log');
        process.exit(0);
    }
    
    let configFile, options = {};
    
    for (let i = 0; i < args.length; i++) {
        switch (args[i]) {
            case '--config':
                configFile = args[++i];
                break;
            case '--interval':
                options.interval = parseInt(args[++i]);
                break;
            case '--log':
                options.logFile = args[++i];
                break;
            case '--threshold':
                options.alertThreshold = parseInt(args[++i]);
                break;
        }
    }
    
    if (!configFile) {
        console.error('Error: --config is required');
        process.exit(1);
    }
    
    let config;
    try {
        const configData = fs.readFileSync(configFile, 'utf8');
        config = JSON.parse(configData);
    } catch (error) {
        console.error(`Failed to read config file: ${error.message}`);
        process.exit(1);
    }
    
    const monitor = new ServiceMonitor(config, options);
    
    // Handle graceful shutdown
    process.on('SIGINT', () => {
        console.log('\nReceived SIGINT, shutting down gracefully...');
        monitor.stop();
        process.exit(0);
    });
    
    process.on('SIGTERM', () => {
        console.log('\nReceived SIGTERM, shutting down gracefully...');
        monitor.stop();
        process.exit(0);
    });
    
    monitor.start().catch(error => {
        console.error('Monitor failed to start:', error.message);
        process.exit(1);
    });
}

module.exports = { ServiceMonitor };