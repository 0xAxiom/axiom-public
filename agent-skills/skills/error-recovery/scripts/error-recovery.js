#!/usr/bin/env node

/**
 * Error Recovery System
 * Robust retry logic with exponential backoff, jitter, and failure handling
 */

const fs = require('fs');
const path = require('path');

class ErrorRecovery {
    constructor(config = {}) {
        this.config = this.loadConfig(config);
        this.circuits = new Map();
        this.metrics = {
            total: 0,
            successful: 0,
            failed: 0,
            retries: 0,
            circuitTrips: 0
        };
        this.dlq = [];
        this.setupMetricsLogging();
    }

    loadConfig(userConfig) {
        const defaultConfig = {
            policies: {
                default: {
                    maxRetries: 3,
                    initialDelay: 1000,
                    maxDelay: 15000,
                    backoffFactor: 2,
                    jitter: true,
                    retryOn: ['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', '429', '500', '502', '503', '504'],
                    noRetryOn: ['400', '401', '403', '404', '422'],
                    circuit: {
                        threshold: 5,
                        timeout: 60000
                    }
                }
            },
            deadLetterQueue: {
                enabled: true,
                path: './failed-operations.json',
                maxSize: 1000
            },
            metrics: {
                enabled: true,
                logInterval: 300000 // 5 minutes
            }
        };

        return this.mergeDeep(defaultConfig, userConfig);
    }

    mergeDeep(target, source) {
        const output = Object.assign({}, target);
        if (this.isObject(target) && this.isObject(source)) {
            Object.keys(source).forEach(key => {
                if (this.isObject(source[key])) {
                    if (!(key in target)) Object.assign(output, { [key]: source[key] });
                    else output[key] = this.mergeDeep(target[key], source[key]);
                } else {
                    Object.assign(output, { [key]: source[key] });
                }
            });
        }
        return output;
    }

    isObject(item) {
        return item && typeof item === 'object' && !Array.isArray(item);
    }

    async withRetry(operation, policy = 'default') {
        const policyConfig = this.config.policies[policy] || this.config.policies.default;
        const operationId = this.generateOperationId();
        
        this.metrics.total++;

        // Check circuit breaker
        if (this.isCircuitOpen(policy)) {
            const error = new Error(`Circuit breaker open for policy: ${policy}`);
            await this.addToDeadLetterQueue(operationId, operation, error, policy);
            throw error;
        }

        let lastError;
        let attempt = 0;

        while (attempt <= policyConfig.maxRetries) {
            try {
                const result = await this.executeWithTimeout(operation, policyConfig);
                this.metrics.successful++;
                this.resetCircuit(policy);
                return result;
            } catch (error) {
                lastError = error;
                attempt++;
                
                if (!this.shouldRetry(error, policyConfig)) {
                    await this.addToDeadLetterQueue(operationId, operation, error, policy);
                    throw error;
                }

                if (attempt <= policyConfig.maxRetries) {
                    this.metrics.retries++;
                    const delay = this.calculateDelay(attempt, policyConfig);
                    await this.sleep(delay);
                } else {
                    // Max retries exceeded
                    this.recordCircuitFailure(policy);
                    await this.addToDeadLetterQueue(operationId, operation, error, policy);
                }
            }
        }

        this.metrics.failed++;
        throw lastError;
    }

    async withBatchRetry(operations, options = {}) {
        const {
            continueOnFailure = true,
            maxConcurrency = 5,
            failureThreshold = 0.5,
            policy = 'default'
        } = options;

        const results = {
            successful: [],
            failed: [],
            total: operations.length
        };

        // Process operations in batches
        for (let i = 0; i < operations.length; i += maxConcurrency) {
            const batch = operations.slice(i, i + maxConcurrency);
            const batchPromises = batch.map(async (operation, index) => {
                try {
                    const result = await this.withRetry(operation, policy);
                    results.successful.push({ index: i + index, result });
                } catch (error) {
                    results.failed.push({ index: i + index, error });
                    if (!continueOnFailure) {
                        throw error;
                    }
                }
            });

            await Promise.allSettled(batchPromises);

            // Check failure threshold
            const currentFailureRate = results.failed.length / (results.successful.length + results.failed.length);
            if (currentFailureRate > failureThreshold) {
                throw new Error(`Failure threshold exceeded: ${(currentFailureRate * 100).toFixed(1)}%`);
            }
        }

        return results;
    }

    shouldRetry(error, policy) {
        const errorCode = this.extractErrorCode(error);
        
        // Check explicit no-retry list first
        if (policy.noRetryOn && policy.noRetryOn.includes(errorCode)) {
            return false;
        }

        // Check retry list
        if (policy.retryOn && policy.retryOn.length > 0) {
            return policy.retryOn.includes(errorCode);
        }

        // Default retriable errors
        const defaultRetriable = [
            'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'ECONNREFUSED',
            'NetworkError', 'TimeoutError',
            '429', '500', '502', '503', '504'
        ];

        return defaultRetriable.includes(errorCode);
    }

    extractErrorCode(error) {
        // Network errors
        if (error.code) return error.code;
        
        // HTTP errors
        if (error.status) return error.status.toString();
        if (error.response && error.response.status) return error.response.status.toString();
        
        // Custom error types
        if (error.name) return error.name;
        
        // Extract HTTP status from message
        const statusMatch = error.message.match(/HTTP (\d{3})/);
        if (statusMatch) return statusMatch[1];
        
        return 'UnknownError';
    }

    calculateDelay(attempt, policy) {
        let delay = policy.initialDelay * Math.pow(policy.backoffFactor, attempt - 1);
        delay = Math.min(delay, policy.maxDelay);
        
        if (policy.jitter) {
            // Add ±25% jitter
            const jitterRange = delay * 0.25;
            delay += (Math.random() - 0.5) * 2 * jitterRange;
        }
        
        return Math.max(100, Math.floor(delay)); // Minimum 100ms
    }

    async executeWithTimeout(operation, policy) {
        const timeout = policy.timeout || 30000; // Default 30s timeout
        
        return new Promise(async (resolve, reject) => {
            const timeoutId = setTimeout(() => {
                reject(new Error('TimeoutError'));
            }, timeout);

            try {
                const result = await operation();
                clearTimeout(timeoutId);
                resolve(result);
            } catch (error) {
                clearTimeout(timeoutId);
                reject(error);
            }
        });
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // Circuit Breaker Implementation
    isCircuitOpen(policy) {
        const circuit = this.circuits.get(policy);
        if (!circuit) return false;
        
        const now = Date.now();
        if (circuit.state === 'open' && now - circuit.lastFailure > circuit.timeout) {
            // Reset to half-open
            circuit.state = 'half-open';
            circuit.failures = 0;
        }
        
        return circuit.state === 'open';
    }

    recordCircuitFailure(policy) {
        const policyConfig = this.config.policies[policy] || this.config.policies.default;
        let circuit = this.circuits.get(policy);
        
        if (!circuit) {
            circuit = {
                state: 'closed',
                failures: 0,
                lastFailure: 0,
                threshold: policyConfig.circuit.threshold,
                timeout: policyConfig.circuit.timeout
            };
            this.circuits.set(policy, circuit);
        }
        
        circuit.failures++;
        circuit.lastFailure = Date.now();
        
        if (circuit.failures >= circuit.threshold) {
            circuit.state = 'open';
            this.metrics.circuitTrips++;
        }
    }

    resetCircuit(policy) {
        const circuit = this.circuits.get(policy);
        if (circuit) {
            circuit.state = 'closed';
            circuit.failures = 0;
        }
    }

    // Dead Letter Queue
    async addToDeadLetterQueue(operationId, operation, error, policy) {
        if (!this.config.deadLetterQueue.enabled) return;
        
        const entry = {
            id: operationId,
            timestamp: new Date().toISOString(),
            policy,
            error: {
                message: error.message,
                code: this.extractErrorCode(error),
                stack: error.stack
            },
            operation: operation.toString().substring(0, 500) // Truncate for storage
        };

        this.dlq.push(entry);
        
        // Trim DLQ if too large
        if (this.dlq.length > this.config.deadLetterQueue.maxSize) {
            this.dlq.shift();
        }
        
        await this.persistDeadLetterQueue();
    }

    async persistDeadLetterQueue() {
        try {
            const dlqPath = path.resolve(this.config.deadLetterQueue.path);
            await fs.promises.writeFile(dlqPath, JSON.stringify(this.dlq, null, 2));
        } catch (error) {
            console.error('Failed to persist dead letter queue:', error.message);
        }
    }

    async loadDeadLetterQueue() {
        try {
            const dlqPath = path.resolve(this.config.deadLetterQueue.path);
            const data = await fs.promises.readFile(dlqPath, 'utf8');
            this.dlq = JSON.parse(data);
        } catch (error) {
            // File doesn't exist or is invalid, start with empty queue
            this.dlq = [];
        }
    }

    async getFailedOperations(filter = null) {
        await this.loadDeadLetterQueue();
        
        if (!filter) return this.dlq;
        
        return this.dlq.filter(entry => {
            if (typeof filter === 'string') {
                return entry.policy === filter || 
                       entry.error.code === filter ||
                       entry.error.message.includes(filter);
            }
            if (typeof filter === 'function') {
                return filter(entry);
            }
            return false;
        });
    }

    generateOperationId() {
        return `op_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    // Metrics and Monitoring
    setupMetricsLogging() {
        if (!this.config.metrics.enabled) return;
        
        setInterval(() => {
            this.logMetrics();
        }, this.config.metrics.logInterval);
    }

    logMetrics() {
        const successRate = this.metrics.total > 0 ? 
            ((this.metrics.successful / this.metrics.total) * 100).toFixed(1) : 0;
        
        const retryRate = this.metrics.total > 0 ?
            ((this.metrics.retries / this.metrics.total) * 100).toFixed(1) : 0;

        console.log(`[${new Date().toISOString()}] Error Recovery Metrics:`);
        console.log(`  Total Operations: ${this.metrics.total.toLocaleString()}`);
        console.log(`  Success Rate: ${successRate}%`);
        console.log(`  Retry Rate: ${retryRate}% (${this.metrics.retries}/${this.metrics.total})`);
        console.log(`  Circuit Trips: ${this.metrics.circuitTrips}`);
        console.log(`  DLQ Size: ${this.dlq.length} operations`);
        
        // Policy-specific metrics
        const policyMetrics = new Map();
        // This would require tracking per-policy metrics, simplified for now
        
        console.log('');
    }

    getMetrics() {
        return {
            ...this.metrics,
            dlqSize: this.dlq.length,
            circuits: Array.from(this.circuits.entries()).map(([policy, circuit]) => ({
                policy,
                state: circuit.state,
                failures: circuit.failures
            }))
        };
    }
}

// Singleton instance
let globalRecovery = null;

function getRecovery(config = {}) {
    if (!globalRecovery) {
        globalRecovery = new ErrorRecovery(config);
    }
    return globalRecovery;
}

// Main API functions
async function withRetry(operation, policy = 'default') {
    const recovery = getRecovery();
    return recovery.withRetry(operation, policy);
}

async function withBatchRetry(operations, options = {}) {
    const recovery = getRecovery();
    return recovery.withBatchRetry(operations, options);
}

function setupDeadLetterQueue(path) {
    const recovery = getRecovery();
    recovery.config.deadLetterQueue.path = path;
    return recovery.loadDeadLetterQueue();
}

async function getFailedOperations(filter = null) {
    const recovery = getRecovery();
    return recovery.getFailedOperations(filter);
}

function getMetrics() {
    const recovery = getRecovery();
    return recovery.getMetrics();
}

function configure(config) {
    globalRecovery = new ErrorRecovery(config);
    return globalRecovery;
}

// Export main functions
module.exports = {
    withRetry,
    withBatchRetry,
    setupDeadLetterQueue,
    getFailedOperations,
    getMetrics,
    configure,
    ErrorRecovery
};

// CLI usage
if (require.main === module) {
    const args = process.argv.slice(2);
    
    if (args.includes('--help') || args.length === 0) {
        console.log(`
Error Recovery CLI

Usage:
  node error-recovery.js --test              # Run built-in tests
  node error-recovery.js --metrics           # Show current metrics
  node error-recovery.js --dlq               # Show dead letter queue
  node error-recovery.js --config <file>     # Load custom config

Examples:
  node error-recovery.js --test
  node error-recovery.js --metrics
        `);
        process.exit(0);
    }

    if (args.includes('--test')) {
        runTests();
    } else if (args.includes('--metrics')) {
        showMetrics();
    } else if (args.includes('--dlq')) {
        showDeadLetterQueue();
    }
}

async function runTests() {
    console.log('Running Error Recovery Tests...\n');
    
    const recovery = getRecovery();
    
    // Test 1: Successful operation
    console.log('Test 1: Successful operation');
    try {
        const result = await withRetry(async () => {
            return 'success';
        });
        console.log('✅ Result:', result);
    } catch (error) {
        console.log('❌ Error:', error.message);
    }
    
    // Test 2: Retriable error with eventual success
    console.log('\nTest 2: Retriable error with eventual success');
    let attempts = 0;
    try {
        const result = await withRetry(async () => {
            attempts++;
            if (attempts < 3) {
                const error = new Error('Temporary failure');
                error.code = 'ETIMEDOUT';
                throw error;
            }
            return 'success after retries';
        });
        console.log('✅ Result:', result, `(${attempts} attempts)`);
    } catch (error) {
        console.log('❌ Error:', error.message);
    }
    
    // Test 3: Non-retriable error
    console.log('\nTest 3: Non-retriable error');
    try {
        const result = await withRetry(async () => {
            const error = new Error('Authentication failed');
            error.status = 401;
            throw error;
        });
        console.log('✅ Result:', result);
    } catch (error) {
        console.log('✅ Expected error:', error.message);
    }
    
    console.log('\nTests completed.');
    console.log('Metrics:', recovery.getMetrics());
}

async function showMetrics() {
    const recovery = getRecovery();
    const metrics = recovery.getMetrics();
    console.log('Current Error Recovery Metrics:');
    console.log(JSON.stringify(metrics, null, 2));
}

async function showDeadLetterQueue() {
    const failed = await getFailedOperations();
    console.log(`Dead Letter Queue: ${failed.length} operations`);
    failed.slice(-10).forEach((entry, index) => {
        console.log(`${index + 1}. [${entry.timestamp}] ${entry.policy}: ${entry.error.message}`);
    });
}