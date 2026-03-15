#!/usr/bin/env node

const fs = require('fs');
const { healthCheck } = require('./health-check.js');

async function batchHealthCheck(configPath) {
    let config;
    
    try {
        const configData = fs.readFileSync(configPath, 'utf8');
        config = JSON.parse(configData);
    } catch (error) {
        throw new Error(`Failed to read config file: ${error.message}`);
    }
    
    if (!config.services || !Array.isArray(config.services)) {
        throw new Error('Config must contain a "services" array');
    }
    
    console.log(`Testing ${config.services.length} services...`);
    
    const results = await Promise.allSettled(
        config.services.map(async service => {
            const options = {
                timeout: service.timeout || 10000,
                method: service.method || 'GET',
                headers: service.headers || {}
            };
            
            const result = await healthCheck(service.url, options);
            result.name = service.name || service.url;
            result.critical = service.critical || false;
            result.expectedStatus = service.expectedStatus || 200;
            
            // Check if status matches expected
            if (result.statusCode !== result.expectedStatus) {
                result.status = 'unhealthy';
                result.errors.push(`Expected status ${result.expectedStatus}, got ${result.statusCode}`);
            }
            
            return result;
        })
    );
    
    const summary = {
        timestamp: new Date().toISOString(),
        total: results.length,
        healthy: 0,
        degraded: 0,
        unhealthy: 0,
        criticalFailures: 0,
        services: []
    };
    
    results.forEach((result, index) => {
        if (result.status === 'fulfilled') {
            const service = result.value;
            summary.services.push(service);
            
            if (service.status === 'healthy') {
                summary.healthy++;
            } else if (service.status === 'degraded') {
                summary.degraded++;
            } else {
                summary.unhealthy++;
                if (service.critical) {
                    summary.criticalFailures++;
                }
            }
        } else {
            // Promise was rejected
            const service = config.services[index];
            summary.unhealthy++;
            if (service.critical) {
                summary.criticalFailures++;
            }
            
            summary.services.push({
                name: service.name || service.url,
                service: service.url,
                status: 'unhealthy',
                critical: service.critical || false,
                errors: [result.reason.message],
                timestamp: new Date().toISOString()
            });
        }
    });
    
    return summary;
}

function formatSummary(summary) {
    const output = [];
    
    output.push(`Service Health Summary (${summary.timestamp})`);
    output.push(`Total: ${summary.total} | Healthy: ${summary.healthy} | Degraded: ${summary.degraded} | Unhealthy: ${summary.unhealthy}`);
    
    if (summary.criticalFailures > 0) {
        output.push(`⚠️  CRITICAL: ${summary.criticalFailures} critical service(s) failed`);
    }
    
    output.push('');
    
    summary.services.forEach(service => {
        const status = service.status === 'healthy' ? '✅' : 
                      service.status === 'degraded' ? '⚠️' : '❌';
        
        const critical = service.critical ? ' (CRITICAL)' : '';
        const responseTime = service.responseTime ? ` (${service.responseTime}ms)` : '';
        
        output.push(`${status} ${service.name}${critical}${responseTime}`);
        
        if (service.errors && service.errors.length > 0) {
            service.errors.forEach(error => {
                output.push(`   Error: ${error}`);
            });
        }
    });
    
    return output.join('\n');
}

// CLI usage
if (require.main === module) {
    const args = process.argv.slice(2);
    
    if (args.length === 0) {
        console.log('Usage: node batch-health.js <config.json> [--json]');
        console.log('');
        console.log('Example config.json:');
        console.log(JSON.stringify({
            services: [
                {
                    name: "GitHub API",
                    url: "https://api.github.com",
                    critical: true,
                    timeout: 5000,
                    expectedStatus: 200
                },
                {
                    name: "Test Service",
                    url: "https://httpbin.org/status/200",
                    headers: {
                        "User-Agent": "Batch-Health-Check"
                    }
                }
            ]
        }, null, 2));
        process.exit(1);
    }
    
    const configPath = args[0];
    const outputJson = args.includes('--json');
    
    batchHealthCheck(configPath).then(summary => {
        if (outputJson) {
            console.log(JSON.stringify(summary, null, 2));
        } else {
            console.log(formatSummary(summary));
        }
        
        // Exit with error code if any critical services failed
        process.exit(summary.criticalFailures > 0 ? 1 : 0);
        
    }).catch(error => {
        console.error('Batch health check failed:', error.message);
        process.exit(1);
    });
}

module.exports = { batchHealthCheck };