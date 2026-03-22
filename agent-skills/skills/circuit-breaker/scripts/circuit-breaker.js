#!/usr/bin/env node

const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

class CircuitBreaker {
  constructor(options = {}) {
    this.name = options.name;
    this.failureThreshold = options.failureThreshold || 5;
    this.timeout = options.timeout || 10000;
    this.resetTimeout = options.resetTimeout || 60000;
    
    this.stateFile = `/tmp/circuit-breaker-${this.name}.json`;
    this.loadState();
  }

  loadState() {
    try {
      if (fs.existsSync(this.stateFile)) {
        const data = JSON.parse(fs.readFileSync(this.stateFile, 'utf8'));
        this.state = data.state || 'CLOSED';
        this.failureCount = data.failureCount || 0;
        this.lastFailureTime = data.lastFailureTime || null;
        this.lastSuccessTime = data.lastSuccessTime || null;
      } else {
        this.reset();
      }
    } catch (error) {
      this.reset();
    }
  }

  saveState() {
    const state = {
      state: this.state,
      failureCount: this.failureCount,
      lastFailureTime: this.lastFailureTime,
      lastSuccessTime: this.lastSuccessTime
    };
    
    try {
      fs.writeFileSync(this.stateFile, JSON.stringify(state, null, 2));
    } catch (error) {
      console.error('Failed to save circuit breaker state:', error.message);
    }
  }

  reset() {
    this.state = 'CLOSED';
    this.failureCount = 0;
    this.lastFailureTime = null;
    this.lastSuccessTime = null;
    this.saveState();
  }

  getStatus() {
    return {
      name: this.name,
      state: this.state,
      failureCount: this.failureCount,
      failureThreshold: this.failureThreshold,
      lastFailureTime: this.lastFailureTime ? new Date(this.lastFailureTime).toISOString() : null,
      lastSuccessTime: this.lastSuccessTime ? new Date(this.lastSuccessTime).toISOString() : null,
      timeToNextRetry: this.state === 'OPEN' ? this.getTimeToNextRetry() : null
    };
  }

  getTimeToNextRetry() {
    if (this.state !== 'OPEN' || !this.lastFailureTime) return 0;
    const elapsed = Date.now() - this.lastFailureTime;
    const remaining = this.resetTimeout - elapsed;
    return Math.max(0, remaining);
  }

  async execute(operation) {
    // Check if circuit should transition from OPEN to HALF_OPEN
    if (this.state === 'OPEN') {
      if (Date.now() - this.lastFailureTime >= this.resetTimeout) {
        this.state = 'HALF_OPEN';
        this.saveState();
        console.log(`Circuit breaker ${this.name} transitioning to HALF_OPEN`);
      } else {
        throw new Error(`Circuit breaker ${this.name} is OPEN. Next retry in ${Math.ceil(this.getTimeToNextRetry() / 1000)}s`);
      }
    }

    try {
      const result = await operation();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  onSuccess() {
    this.failureCount = 0;
    this.lastSuccessTime = Date.now();
    this.state = 'CLOSED';
    this.saveState();
    console.log(`Circuit breaker ${this.name} reset to CLOSED after success`);
  }

  onFailure() {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.failureCount >= this.failureThreshold || this.state === 'HALF_OPEN') {
      this.state = 'OPEN';
      console.log(`Circuit breaker ${this.name} opened after ${this.failureCount} failures`);
    }

    this.saveState();
  }
}

async function executeCommand(command, timeout) {
  return new Promise((resolve, reject) => {
    const child = spawn('sh', ['-c', command], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    // Set timeout
    const timeoutId = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
      reject(new Error(`Command timed out after ${timeout}ms`));
    }, timeout);

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      if (timedOut) return;
      
      clearTimeout(timeoutId);
      
      if (code === 0) {
        resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
      } else {
        reject(new Error(`Command failed with exit code ${code}: ${stderr.trim() || stdout.trim()}`));
      }
    });

    child.on('error', (error) => {
      if (timedOut) return;
      clearTimeout(timeoutId);
      reject(error);
    });
  });
}

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {};
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];
    
    switch (arg) {
      case '--operation':
        options.operation = next;
        i++;
        break;
      case '--name':
        options.name = next;
        i++;
        break;
      case '--failure-threshold':
        options.failureThreshold = parseInt(next);
        i++;
        break;
      case '--timeout':
        options.timeout = parseInt(next);
        i++;
        break;
      case '--reset-timeout':
        options.resetTimeout = parseInt(next);
        i++;
        break;
      case '--status':
        options.showStatus = true;
        break;
      case '--reset':
        options.resetCircuit = true;
        break;
      case '--help':
        options.showHelp = true;
        break;
    }
  }
  
  return options;
}

function showHelp() {
  console.log(`
Circuit Breaker - Reliability Pattern Implementation

Usage:
  circuit-breaker.js --operation "command" --name "circuit-name" [options]
  circuit-breaker.js --status --name "circuit-name"
  circuit-breaker.js --reset --name "circuit-name"

Options:
  --operation          Command to execute
  --name              Circuit identifier (required)
  --failure-threshold  Failures before opening circuit (default: 5)
  --timeout           Operation timeout in ms (default: 10000)
  --reset-timeout     Time before trying HALF_OPEN in ms (default: 60000)
  --status            Show circuit status
  --reset             Manually reset circuit to CLOSED
  --help              Show this help

Examples:
  # API health check
  circuit-breaker.js --operation "curl -f -s https://api.example.com/health" --name "api"
  
  # Database connection test
  circuit-breaker.js --operation "pg_isready -h localhost" --name "db" --failure-threshold 3
  
  # Check status
  circuit-breaker.js --status --name "api"
`);
}

async function main() {
  const options = parseArgs();
  
  if (options.showHelp) {
    showHelp();
    return;
  }
  
  if (!options.name) {
    console.error('Error: --name is required');
    process.exit(1);
  }
  
  const breaker = new CircuitBreaker(options);
  
  if (options.showStatus) {
    console.log(JSON.stringify(breaker.getStatus(), null, 2));
    return;
  }
  
  if (options.resetCircuit) {
    breaker.reset();
    console.log(`Circuit breaker ${options.name} reset to CLOSED`);
    return;
  }
  
  if (!options.operation) {
    console.error('Error: --operation is required (unless using --status or --reset)');
    process.exit(1);
  }
  
  try {
    const result = await breaker.execute(async () => {
      return await executeCommand(options.operation, options.timeout);
    });
    
    console.log(result.stdout);
    if (result.stderr) {
      console.error(result.stderr);
    }
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
}

// Export for use as a module
module.exports = { CircuitBreaker };

// Run as CLI if called directly
if (require.main === module) {
  main().catch(error => {
    console.error(`Fatal error: ${error.message}`);
    process.exit(1);
  });
}