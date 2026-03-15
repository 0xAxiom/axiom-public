#!/usr/bin/env node

const https = require('https');
const http = require('http');
const { URL } = require('url');

async function healthCheck(serviceUrl, options = {}) {
    const startTime = Date.now();
    const result = {
        service: serviceUrl,
        status: 'unhealthy',
        responseTime: 0,
        statusCode: null,
        timestamp: new Date().toISOString(),
        errors: [],
        metadata: {}
    };

    try {
        const url = new URL(serviceUrl);
        const isHttps = url.protocol === 'https:';
        const client = isHttps ? https : http;
        
        const requestOptions = {
            hostname: url.hostname,
            port: url.port || (isHttps ? 443 : 80),
            path: url.pathname + url.search,
            method: options.method || 'GET',
            headers: options.headers || {},
            timeout: options.timeout || 10000
        };

        // Add default User-Agent if not provided
        if (!requestOptions.headers['User-Agent']) {
            requestOptions.headers['User-Agent'] = 'Service-Health-Check/1.0';
        }

        const response = await makeRequest(client, requestOptions);
        
        result.responseTime = Date.now() - startTime;
        result.statusCode = response.statusCode;
        result.metadata.contentType = response.headers['content-type'];
        result.metadata.server = response.headers.server;
        
        // Check rate limiting headers
        if (response.headers['x-ratelimit-limit']) {
            result.metadata.rateLimit = `${response.headers['x-ratelimit-limit']}/hour`;
            result.metadata.rateLimitRemaining = response.headers['x-ratelimit-remaining'];
        }
        
        // SSL validation for HTTPS
        if (isHttps && response.socket && response.socket.authorized === false) {
            result.errors.push('SSL certificate validation failed');
            result.metadata.ssl = 'invalid';
        } else if (isHttps) {
            result.metadata.ssl = 'valid';
        }
        
        // Status code evaluation
        if (response.statusCode >= 200 && response.statusCode < 300) {
            result.status = 'healthy';
        } else if (response.statusCode >= 300 && response.statusCode < 500) {
            result.status = 'degraded';
            result.errors.push(`HTTP ${response.statusCode}: ${response.statusMessage}`);
        } else {
            result.status = 'unhealthy';
            result.errors.push(`HTTP ${response.statusCode}: ${response.statusMessage}`);
        }
        
        // Response time evaluation
        if (result.responseTime > 5000) {
            result.errors.push('High response time (>5s)');
            if (result.status === 'healthy') result.status = 'degraded';
        }
        
    } catch (error) {
        result.responseTime = Date.now() - startTime;
        result.errors.push(error.message);
        result.status = 'unhealthy';
    }
    
    return result;
}

function makeRequest(client, options) {
    return new Promise((resolve, reject) => {
        const req = client.request(options, resolve);
        
        req.on('error', reject);
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('Request timeout'));
        });
        
        req.end();
    });
}

// CLI usage
if (require.main === module) {
    const args = process.argv.slice(2);
    
    if (args.length === 0) {
        console.log('Usage: node health-check.js <url> [--headers "key:value"] [--timeout ms] [--method METHOD]');
        process.exit(1);
    }
    
    const url = args[0];
    const options = {};
    
    // Parse command line arguments
    for (let i = 1; i < args.length; i++) {
        if (args[i] === '--headers' && args[i + 1]) {
            options.headers = options.headers || {};
            const headerParts = args[i + 1].split(':');
            options.headers[headerParts[0].trim()] = headerParts.slice(1).join(':').trim();
            i++;
        } else if (args[i] === '--timeout' && args[i + 1]) {
            options.timeout = parseInt(args[i + 1]);
            i++;
        } else if (args[i] === '--method' && args[i + 1]) {
            options.method = args[i + 1].toUpperCase();
            i++;
        }
    }
    
    healthCheck(url, options).then(result => {
        console.log(JSON.stringify(result, null, 2));
        process.exit(result.status === 'healthy' ? 0 : 1);
    }).catch(error => {
        console.error('Health check failed:', error.message);
        process.exit(1);
    });
}

module.exports = { healthCheck };