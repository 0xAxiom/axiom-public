#!/usr/bin/env node

const https = require('https');
const http = require('http');
const { URL } = require('url');

async function discoverService(baseUrl) {
    const discovery = {
        baseUrl,
        timestamp: new Date().toISOString(),
        endpoints: [],
        authentication: [],
        documentation: [],
        capabilities: {},
        health: null
    };

    try {
        // First, do a basic health check
        discovery.health = await basicHealthCheck(baseUrl);
        
        // Try to discover OpenAPI/Swagger documentation
        const docEndpoints = [
            '/swagger.json',
            '/swagger/v1/swagger.json',
            '/api-docs',
            '/docs',
            '/openapi.json',
            '/v1/swagger.json',
            '/.well-known/openapi'
        ];
        
        for (const endpoint of docEndpoints) {
            try {
                const response = await makeRequest(baseUrl + endpoint);
                if (response.statusCode === 200) {
                    discovery.documentation.push({
                        type: 'openapi',
                        url: baseUrl + endpoint,
                        format: endpoint.includes('json') ? 'json' : 'unknown'
                    });
                }
            } catch (error) {
                // Silently continue
            }
        }
        
        // Try common API endpoints
        const commonEndpoints = [
            '/api',
            '/api/v1',
            '/api/v2',
            '/v1',
            '/v2',
            '/health',
            '/status',
            '/ping',
            '/info',
            '/version',
            '/users',
            '/user',
            '/data',
            '/search'
        ];
        
        for (const endpoint of commonEndpoints) {
            try {
                const response = await makeRequest(baseUrl + endpoint, {}, 'HEAD');
                if (response.statusCode >= 200 && response.statusCode < 500) {
                    discovery.endpoints.push({
                        path: endpoint,
                        statusCode: response.statusCode,
                        methods: parseAllowedMethods(response.headers.allow),
                        contentType: response.headers['content-type']
                    });
                }
            } catch (error) {
                // Silently continue
            }
        }
        
        // Check for authentication methods
        const authTests = [
            { path: '/api', header: 'Authorization', value: 'Bearer test' },
            { path: '/api', header: 'X-API-Key', value: 'test' },
            { path: '/api', header: 'X-Auth-Token', value: 'test' }
        ];
        
        for (const test of authTests) {
            try {
                const response = await makeRequest(baseUrl + test.path, {
                    [test.header]: test.value
                });
                
                if (response.statusCode === 401) {
                    discovery.authentication.push({
                        method: test.header,
                        detected: true,
                        note: 'Endpoint responds to authentication header'
                    });
                }
            } catch (error) {
                // Silently continue
            }
        }
        
        // Extract capabilities from initial response headers
        if (discovery.health && discovery.health.headers) {
            const headers = discovery.health.headers;
            
            // Rate limiting
            if (headers['x-ratelimit-limit']) {
                discovery.capabilities.rateLimit = {
                    limit: headers['x-ratelimit-limit'],
                    remaining: headers['x-ratelimit-remaining'],
                    reset: headers['x-ratelimit-reset']
                };
            }
            
            // CORS
            if (headers['access-control-allow-origin']) {
                discovery.capabilities.cors = {
                    origin: headers['access-control-allow-origin'],
                    methods: headers['access-control-allow-methods'],
                    headers: headers['access-control-allow-headers']
                };
            }
            
            // Server information
            if (headers.server) {
                discovery.capabilities.server = headers.server;
            }
        }
        
    } catch (error) {
        discovery.error = error.message;
    }
    
    return discovery;
}

async function basicHealthCheck(url) {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const client = urlObj.protocol === 'https:' ? https : http;
        
        const options = {
            hostname: urlObj.hostname,
            port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
            path: urlObj.pathname,
            method: 'HEAD',
            timeout: 5000
        };
        
        const req = client.request(options, (res) => {
            resolve({
                statusCode: res.statusCode,
                headers: res.headers,
                ok: res.statusCode >= 200 && res.statusCode < 300
            });
        });
        
        req.on('error', reject);
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('Request timeout'));
        });
        
        req.end();
    });
}

async function makeRequest(url, headers = {}, method = 'GET') {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const client = urlObj.protocol === 'https:' ? https : http;
        
        const options = {
            hostname: urlObj.hostname,
            port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
            path: urlObj.pathname + urlObj.search,
            method,
            headers: {
                'User-Agent': 'Service-Discovery/1.0',
                ...headers
            },
            timeout: 5000
        };
        
        const req = client.request(options, resolve);
        
        req.on('error', reject);
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('Request timeout'));
        });
        
        req.end();
    });
}

function parseAllowedMethods(allowHeader) {
    if (!allowHeader) return ['GET'];
    return allowHeader.split(',').map(method => method.trim().toUpperCase());
}

// CLI usage
if (require.main === module) {
    const args = process.argv.slice(2);
    
    if (args.length === 0) {
        console.log('Usage: node discover-service.js <base-url>');
        console.log('');
        console.log('Example: node discover-service.js https://api.github.com');
        process.exit(1);
    }
    
    const baseUrl = args[0];
    
    console.log(`Discovering service capabilities for: ${baseUrl}`);
    console.log('This may take a few seconds...\n');
    
    discoverService(baseUrl).then(discovery => {
        console.log('🔍 Service Discovery Report');
        console.log('═'.repeat(50));
        console.log(`Service: ${discovery.baseUrl}`);
        console.log(`Timestamp: ${discovery.timestamp}`);
        
        if (discovery.health) {
            console.log(`Status: ${discovery.health.ok ? '✅ Online' : '❌ Offline'} (${discovery.health.statusCode})`);
        }
        
        if (discovery.capabilities.server) {
            console.log(`Server: ${discovery.capabilities.server}`);
        }
        
        if (discovery.capabilities.rateLimit) {
            console.log(`Rate Limit: ${discovery.capabilities.rateLimit.limit} requests`);
        }
        
        if (discovery.documentation.length > 0) {
            console.log('\n📚 Documentation Found:');
            discovery.documentation.forEach(doc => {
                console.log(`  • ${doc.type.toUpperCase()}: ${doc.url}`);
            });
        }
        
        if (discovery.authentication.length > 0) {
            console.log('\n🔐 Authentication Methods:');
            discovery.authentication.forEach(auth => {
                console.log(`  • ${auth.method}: ${auth.note}`);
            });
        }
        
        if (discovery.endpoints.length > 0) {
            console.log('\n🛤️  Available Endpoints:');
            discovery.endpoints.forEach(endpoint => {
                const methods = endpoint.methods ? endpoint.methods.join(', ') : 'GET';
                console.log(`  • ${endpoint.path} [${methods}] (${endpoint.statusCode})`);
            });
        }
        
        if (discovery.capabilities.cors) {
            console.log('\n🌐 CORS Configuration:');
            console.log(`  • Origin: ${discovery.capabilities.cors.origin}`);
            if (discovery.capabilities.cors.methods) {
                console.log(`  • Methods: ${discovery.capabilities.cors.methods}`);
            }
        }
        
        if (discovery.error) {
            console.log(`\n❌ Error: ${discovery.error}`);
        }
        
    }).catch(error => {
        console.error('Service discovery failed:', error.message);
        process.exit(1);
    });
}

module.exports = { discoverService };