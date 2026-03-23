#!/usr/bin/env node

/**
 * Error Recovery CLI
 * Command-line interface for testing operations with retry policies
 */

const { execSync } = require('child_process');
const { withRetry, configure, getMetrics } = require('./error-recovery.js');

async function main() {
    const args = process.argv.slice(2);
    
    if (args.includes('--help') || args.length === 0) {
        console.log(`
Error Recovery CLI

Usage:
  retry-cli.js --operation <command> [--policy <name>] [--config <file>]
  retry-cli.js --test-url <url> [--policy <name>]
  retry-cli.js --metrics

Options:
  --operation    Shell command to execute with retry
  --test-url     HTTP URL to test with retry
  --policy       Retry policy to use (default: 'default')
  --config       Custom config file path
  --metrics      Show current metrics
  --verbose      Detailed output

Examples:
  retry-cli.js --operation "curl -f https://api.example.com/health"
  retry-cli.js --test-url https://httpstat.us/503 --policy api
  retry-cli.js --operation "node my-script.js" --policy database
        `);
        process.exit(0);
    }

    try {
        // Load custom config if provided
        const configIndex = args.indexOf('--config');
        if (configIndex !== -1 && configIndex + 1 < args.length) {
            const configPath = args[configIndex + 1];
            const config = require(require('path').resolve(configPath));
            configure(config);
        }

        const verbose = args.includes('--verbose');
        
        if (args.includes('--metrics')) {
            showMetrics();
            return;
        }

        const operationIndex = args.indexOf('--operation');
        const urlIndex = args.indexOf('--test-url');
        const policyIndex = args.indexOf('--policy');
        
        const policy = policyIndex !== -1 && policyIndex + 1 < args.length ? 
            args[policyIndex + 1] : 'default';

        if (operationIndex !== -1 && operationIndex + 1 < args.length) {
            const command = args[operationIndex + 1];
            await testShellCommand(command, policy, verbose);
        } else if (urlIndex !== -1 && urlIndex + 1 < args.length) {
            const url = args[urlIndex + 1];
            await testUrl(url, policy, verbose);
        } else {
            console.error('Error: --operation or --test-url required');
            process.exit(1);
        }

    } catch (error) {
        console.error('CLI Error:', error.message);
        process.exit(1);
    }
}

async function testShellCommand(command, policy, verbose) {
    console.log(`Testing shell command with retry (policy: ${policy})`);
    console.log(`Command: ${command}\n`);

    const startTime = Date.now();
    
    try {
        const result = await withRetry(async () => {
            if (verbose) {
                console.log(`Attempting: ${command}`);
            }
            
            try {
                const output = execSync(command, { 
                    encoding: 'utf8',
                    timeout: 30000,
                    stdio: verbose ? 'inherit' : 'pipe'
                });
                
                if (verbose) {
                    console.log('✅ Command succeeded');
                }
                
                return output;
            } catch (execError) {
                if (verbose) {
                    console.log(`❌ Command failed: ${execError.message}`);
                }
                
                // Convert exec error to retriable format
                const error = new Error(`Command failed: ${execError.message}`);
                if (execError.status) {
                    error.status = execError.status;
                }
                throw error;
            }
        }, policy);

        const duration = Date.now() - startTime;
        console.log(`\n✅ Operation succeeded after ${duration}ms`);
        if (result && !verbose) {
            console.log('Output:');
            console.log(result);
        }
        
    } catch (error) {
        const duration = Date.now() - startTime;
        console.log(`\n❌ Operation failed after ${duration}ms`);
        console.log('Final error:', error.message);
    }

    // Show metrics
    console.log('\nMetrics:');
    const metrics = getMetrics();
    console.log(`Total operations: ${metrics.total}`);
    console.log(`Success rate: ${((metrics.successful / metrics.total) * 100).toFixed(1)}%`);
    console.log(`Retry rate: ${((metrics.retries / metrics.total) * 100).toFixed(1)}%`);
}

async function testUrl(url, policy, verbose) {
    console.log(`Testing URL with retry (policy: ${policy})`);
    console.log(`URL: ${url}\n`);

    const startTime = Date.now();
    
    try {
        const result = await withRetry(async () => {
            if (verbose) {
                console.log(`Attempting HTTP request to: ${url}`);
            }

            // Use curl for HTTP testing (most reliable across systems)
            try {
                const output = execSync(`curl -f -s -w "HTTP %{http_code} - %{time_total}s" "${url}"`, {
                    encoding: 'utf8',
                    timeout: 30000
                });
                
                if (verbose) {
                    console.log('✅ HTTP request succeeded');
                    console.log('Response:', output);
                }
                
                return output;
            } catch (curlError) {
                if (verbose) {
                    console.log(`❌ HTTP request failed: ${curlError.message}`);
                }
                
                // Extract HTTP status from curl error if available
                const error = new Error(`HTTP request failed: ${curlError.message}`);
                const statusMatch = curlError.message.match(/curl: \(22\) The requested URL returned error: (\d+)/);
                if (statusMatch) {
                    error.status = statusMatch[1];
                }
                throw error;
            }
        }, policy);

        const duration = Date.now() - startTime;
        console.log(`\n✅ HTTP request succeeded after ${duration}ms`);
        console.log('Response:', result);
        
    } catch (error) {
        const duration = Date.now() - startTime;
        console.log(`\n❌ HTTP request failed after ${duration}ms`);
        console.log('Final error:', error.message);
    }

    // Show metrics
    console.log('\nMetrics:');
    const metrics = getMetrics();
    console.log(`Total operations: ${metrics.total}`);
    console.log(`Success rate: ${((metrics.successful / metrics.total) * 100).toFixed(1)}%`);
    console.log(`Retry rate: ${((metrics.retries / metrics.total) * 100).toFixed(1)}%`);
}

function showMetrics() {
    console.log('Current Error Recovery Metrics:');
    const metrics = getMetrics();
    
    console.log(`\nOverall Performance:`);
    console.log(`  Total Operations: ${metrics.total.toLocaleString()}`);
    console.log(`  Successful: ${metrics.successful.toLocaleString()}`);
    console.log(`  Failed: ${metrics.failed.toLocaleString()}`);
    console.log(`  Success Rate: ${metrics.total > 0 ? ((metrics.successful / metrics.total) * 100).toFixed(1) : 0}%`);
    
    console.log(`\nRetry Statistics:`);
    console.log(`  Total Retries: ${metrics.retries.toLocaleString()}`);
    console.log(`  Retry Rate: ${metrics.total > 0 ? ((metrics.retries / metrics.total) * 100).toFixed(1) : 0}%`);
    
    console.log(`\nCircuit Breaker:`);
    console.log(`  Circuit Trips: ${metrics.circuitTrips}`);
    console.log(`  DLQ Size: ${metrics.dlqSize} operations`);
    
    if (metrics.circuits.length > 0) {
        console.log(`\nCircuit Status:`);
        metrics.circuits.forEach(circuit => {
            console.log(`  ${circuit.policy}: ${circuit.state} (${circuit.failures} failures)`);
        });
    }
}

if (require.main === module) {
    main().catch(error => {
        console.error('Unexpected error:', error);
        process.exit(1);
    });
}

module.exports = { main, testShellCommand, testUrl, showMetrics };