#!/usr/bin/env node

/**
 * RPC Guardian - Monitor RPC endpoint health and provide automatic failover
 * 
 * Usage:
 *   ./rpc-guardian.js --test --rpc https://mainnet.base.org
 *   ./rpc-guardian.js --monitor --config ./config/base-mainnet.json
 *   ./rpc-guardian.js --health-check
 *   ./rpc-guardian.js --best --network base-mainnet
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const configDir = path.join(__dirname, '..', 'config');
const dataDir = path.join(__dirname, '..', 'data');

// Ensure data directory exists
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

class RPCGuardian {
    constructor() {
        this.healthData = this.loadHealthData();
    }

    // Load historical health data
    loadHealthData() {
        const healthFile = path.join(dataDir, 'health.json');
        if (fs.existsSync(healthFile)) {
            try {
                return JSON.parse(fs.readFileSync(healthFile, 'utf8'));
            } catch (error) {
                console.warn('Failed to load health data:', error.message);
            }
        }
        return {};
    }

    // Save health data
    saveHealthData() {
        const healthFile = path.join(dataDir, 'health.json');
        fs.writeFileSync(healthFile, JSON.stringify(this.healthData, null, 2));
    }

    // Test single RPC endpoint
    async testEndpoint(endpoint, chainId = null) {
        const startTime = Date.now();
        try {
            const response = await fetch(endpoint.url || endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    method: 'eth_blockNumber',
                    params: [],
                    id: 1
                }),
                signal: AbortSignal.timeout(endpoint.timeout || 5000)
            });

            const latency = Date.now() - startTime;
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const data = await response.json();
            
            if (data.error) {
                throw new Error(`RPC Error: ${data.error.message}`);
            }

            const blockNumber = parseInt(data.result, 16);
            
            // Test chain ID if provided
            if (chainId) {
                const chainResponse = await fetch(endpoint.url || endpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        jsonrpc: '2.0',
                        method: 'eth_chainId',
                        params: [],
                        id: 2
                    }),
                    signal: AbortSignal.timeout(endpoint.timeout || 5000)
                });

                const chainData = await chainResponse.json();
                const actualChainId = parseInt(chainData.result, 16);
                
                if (actualChainId !== chainId) {
                    throw new Error(`Chain ID mismatch: expected ${chainId}, got ${actualChainId}`);
                }
            }

            return {
                success: true,
                latency,
                blockNumber,
                timestamp: Date.now(),
                error: null
            };

        } catch (error) {
            return {
                success: false,
                latency: Date.now() - startTime,
                blockNumber: null,
                timestamp: Date.now(),
                error: error.message
            };
        }
    }

    // Load network configuration
    loadNetworkConfig(network) {
        const configFile = path.join(configDir, `${network}.json`);
        if (!fs.existsSync(configFile)) {
            throw new Error(`Network config not found: ${configFile}`);
        }
        return JSON.parse(fs.readFileSync(configFile, 'utf8'));
    }

    // Update endpoint health statistics
    updateHealthStats(endpointUrl, result) {
        if (!this.healthData[endpointUrl]) {
            this.healthData[endpointUrl] = {
                totalTests: 0,
                successCount: 0,
                totalLatency: 0,
                lastSeen: null,
                recentResults: []
            };
        }

        const stats = this.healthData[endpointUrl];
        stats.totalTests++;
        stats.totalLatency += result.latency;
        stats.lastSeen = result.timestamp;

        if (result.success) {
            stats.successCount++;
        }

        // Keep only recent results (last 100)
        stats.recentResults.push({
            success: result.success,
            latency: result.latency,
            timestamp: result.timestamp
        });

        if (stats.recentResults.length > 100) {
            stats.recentResults.shift();
        }

        this.saveHealthData();
    }

    // Calculate endpoint score
    calculateScore(endpointUrl, recentLatency) {
        const stats = this.healthData[endpointUrl];
        if (!stats) return 0;

        const successRate = stats.successCount / stats.totalTests;
        const avgLatency = stats.totalLatency / stats.totalTests;
        const recency = Math.max(0, 1 - (Date.now() - stats.lastSeen) / (1000 * 60 * 60)); // Decay over 1 hour

        // Score based on success rate (0-50), latency (0-30), recency (0-20)
        const successScore = successRate * 50;
        const latencyScore = Math.max(0, 30 - (recentLatency || avgLatency) / 100);
        const recencyScore = recency * 20;

        return successScore + latencyScore + recencyScore;
    }

    // Find best endpoint for network
    async findBestEndpoint(network) {
        const config = this.loadNetworkConfig(network);
        const results = [];

        console.log(`Testing endpoints for ${network}...`);

        for (const endpoint of config.endpoints) {
            const result = await this.testEndpoint(endpoint, config.chainId);
            this.updateHealthStats(endpoint.url, result);
            
            const score = this.calculateScore(endpoint.url, result.latency);
            
            results.push({
                ...endpoint,
                ...result,
                score
            });

            console.log(`${endpoint.name}: ${result.success ? '✅' : '❌'} ${result.latency}ms (score: ${score.toFixed(1)})`);
        }

        // Sort by score (descending) and priority (ascending)
        results.sort((a, b) => {
            if (Math.abs(a.score - b.score) < 5) {
                return a.priority - b.priority; // Use priority for tie-breaking
            }
            return b.score - a.score;
        });

        return results[0];
    }

    // Monitor endpoints continuously
    async monitor(network, intervalMs = 30000) {
        console.log(`Starting continuous monitoring for ${network} (${intervalMs}ms intervals)`);
        
        while (true) {
            try {
                const best = await this.findBestEndpoint(network);
                console.log(`\n[${new Date().toISOString()}] Best endpoint: ${best.name} (${best.url})`);
                
                await new Promise(resolve => setTimeout(resolve, intervalMs));
            } catch (error) {
                console.error('Monitor error:', error.message);
                await new Promise(resolve => setTimeout(resolve, intervalMs));
            }
        }
    }

    // Health check all networks
    async healthCheck() {
        const configs = fs.readdirSync(configDir).filter(f => f.endsWith('.json'));
        
        console.log('🛡️ RPC Guardian Health Check\n');
        
        for (const configFile of configs) {
            const network = configFile.replace('.json', '');
            try {
                const best = await this.findBestEndpoint(network);
                const status = best.success ? '✅ HEALTHY' : '❌ DEGRADED';
                console.log(`${network}: ${status} - Best: ${best.name} (${best.latency}ms)`);
            } catch (error) {
                console.log(`${network}: ❌ ERROR - ${error.message}`);
            }
        }
    }

    // Generate performance report
    generateReport() {
        console.log('📊 RPC Performance Report\n');
        
        Object.entries(this.healthData).forEach(([url, stats]) => {
            const successRate = (stats.successCount / stats.totalTests * 100).toFixed(1);
            const avgLatency = (stats.totalLatency / stats.totalTests).toFixed(0);
            const lastSeen = new Date(stats.lastSeen).toLocaleString();
            
            console.log(`${url}:`);
            console.log(`  Success Rate: ${successRate}% (${stats.successCount}/${stats.totalTests})`);
            console.log(`  Avg Latency: ${avgLatency}ms`);
            console.log(`  Last Tested: ${lastSeen}`);
            console.log();
        });
    }
}

// CLI Interface
async function main() {
    const args = process.argv.slice(2);
    const guardian = new RPCGuardian();

    if (args.includes('--help')) {
        console.log(`
RPC Guardian - Monitor RPC endpoint health and provide automatic failover

Usage:
  ./rpc-guardian.js --test --rpc <url>              Test single endpoint
  ./rpc-guardian.js --monitor --network <name>      Monitor network continuously  
  ./rpc-guardian.js --best --network <name>         Find best endpoint for network
  ./rpc-guardian.js --health-check                  Check all configured networks
  ./rpc-guardian.js --report                        Show performance report

Options:
  --rpc <url>          RPC endpoint URL to test
  --network <name>     Network name (matches config file)
  --interval <ms>      Monitoring interval (default: 30000)
        `);
        process.exit(0);
    }

    if (args.includes('--test')) {
        const rpcIndex = args.indexOf('--rpc');
        if (rpcIndex === -1 || !args[rpcIndex + 1]) {
            console.error('Error: --test requires --rpc <url>');
            process.exit(1);
        }
        
        const rpcUrl = args[rpcIndex + 1];
        console.log(`Testing RPC endpoint: ${rpcUrl}`);
        
        const result = await guardian.testEndpoint({ url: rpcUrl });
        console.log(result.success ? '✅ SUCCESS' : '❌ FAILED');
        console.log(`Latency: ${result.latency}ms`);
        if (result.blockNumber) console.log(`Block: ${result.blockNumber}`);
        if (result.error) console.log(`Error: ${result.error}`);
        
        process.exit(result.success ? 0 : 1);
    }

    if (args.includes('--monitor')) {
        const networkIndex = args.indexOf('--network');
        const intervalIndex = args.indexOf('--interval');
        
        if (networkIndex === -1 || !args[networkIndex + 1]) {
            console.error('Error: --monitor requires --network <name>');
            process.exit(1);
        }
        
        const network = args[networkIndex + 1];
        const interval = intervalIndex !== -1 && args[intervalIndex + 1] ? 
            parseInt(args[intervalIndex + 1]) : 30000;
        
        await guardian.monitor(network, interval);
    }

    if (args.includes('--best')) {
        const networkIndex = args.indexOf('--network');
        if (networkIndex === -1 || !args[networkIndex + 1]) {
            console.error('Error: --best requires --network <name>');
            process.exit(1);
        }
        
        const network = args[networkIndex + 1];
        try {
            const best = await guardian.findBestEndpoint(network);
            console.log(JSON.stringify({
                name: best.name,
                url: best.url,
                latency: best.latency,
                success: best.success,
                score: best.score
            }, null, 2));
        } catch (error) {
            console.error('Error:', error.message);
            process.exit(1);
        }
    }

    if (args.includes('--health-check')) {
        await guardian.healthCheck();
    }

    if (args.includes('--report')) {
        guardian.generateReport();
    }
}

if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch(console.error);
}

export default RPCGuardian;