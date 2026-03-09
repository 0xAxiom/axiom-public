#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class APIThrottle {
  constructor(configPath = '../config/providers.json') {
    this.configPath = path.join(__dirname, configPath);
    this.statePath = path.join(__dirname, '../state');
    this.queuePath = path.join(this.statePath, 'queues.json');
    this.limitsPath = path.join(this.statePath, 'limits.json');
    
    this.ensureDirectories();
    this.loadConfig();
    this.loadState();
  }

  ensureDirectories() {
    const dirs = [
      path.dirname(this.configPath),
      this.statePath
    ];
    
    dirs.forEach(dir => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    });
  }

  loadConfig() {
    try {
      if (fs.existsSync(this.configPath)) {
        this.config = JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
      } else {
        this.config = this.getDefaultConfig();
        this.saveConfig();
      }
    } catch (error) {
      console.error('Failed to load config:', error.message);
      this.config = this.getDefaultConfig();
    }
  }

  getDefaultConfig() {
    return {
      twitter: {
        baseUrl: 'https://api.twitter.com/2',
        rateLimits: {
          tweets: { requests: 15, window: '15m' },
          users: { requests: 75, window: '15m' }
        },
        backoff: 'exponential',
        maxRetries: 3
      },
      coingecko: {
        baseUrl: 'https://api.coingecko.com/api/v3',
        rateLimits: {
          price: { requests: 30, window: '1m' }
        },
        backoff: 'linear',
        maxRetries: 5
      }
    };
  }

  saveConfig() {
    fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2));
  }

  loadState() {
    try {
      this.queues = fs.existsSync(this.queuePath) 
        ? JSON.parse(fs.readFileSync(this.queuePath, 'utf8'))
        : {};
      
      this.limits = fs.existsSync(this.limitsPath)
        ? JSON.parse(fs.readFileSync(this.limitsPath, 'utf8'))
        : {};
    } catch (error) {
      console.error('Failed to load state:', error.message);
      this.queues = {};
      this.limits = {};
    }
  }

  saveState() {
    fs.writeFileSync(this.queuePath, JSON.stringify(this.queues, null, 2));
    fs.writeFileSync(this.limitsPath, JSON.stringify(this.limits, null, 2));
  }

  parseWindow(window) {
    const units = { s: 1000, m: 60000, h: 3600000 };
    const match = window.match(/^(\d+)([smh])$/);
    if (!match) throw new Error(`Invalid window format: ${window}`);
    return parseInt(match[1]) * units[match[2]];
  }

  isRateLimited(provider, endpoint) {
    const key = `${provider}:${endpoint}`;
    const limitData = this.limits[key];
    
    if (!limitData) return false;
    
    const now = Date.now();
    const windowMs = this.parseWindow(limitData.window);
    const windowStart = now - windowMs;
    
    // Clean old requests
    limitData.requests = limitData.requests.filter(time => time > windowStart);
    
    const config = this.config[provider]?.rateLimits[endpoint];
    if (!config) return false;
    
    return limitData.requests.length >= config.requests;
  }

  recordRequest(provider, endpoint) {
    const key = `${provider}:${endpoint}`;
    const config = this.config[provider]?.rateLimits[endpoint];
    
    if (!config) return;
    
    if (!this.limits[key]) {
      this.limits[key] = {
        requests: [],
        window: config.window
      };
    }
    
    this.limits[key].requests.push(Date.now());
    this.saveState();
  }

  calculateBackoff(provider, attempt) {
    const config = this.config[provider];
    if (!config) return 1000;
    
    const baseDelay = 1000; // 1 second
    
    switch (config.backoff) {
      case 'exponential':
        return baseDelay * Math.pow(2, attempt);
      case 'linear':
        return baseDelay * (attempt + 1);
      case 'fixed':
        return baseDelay;
      default:
        return baseDelay;
    }
  }

  async sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  generateRequestId() {
    return crypto.randomBytes(8).toString('hex');
  }

  async request(provider, endpoint, data = {}, options = {}) {
    const { priority = 'normal', immediate = false } = options;
    
    // Check rate limits unless immediate flag is set
    if (!immediate && this.isRateLimited(provider, endpoint)) {
      console.log(`Rate limited for ${provider}:${endpoint}, queuing request`);
      return this.queueRequest(provider, endpoint, data, priority);
    }
    
    try {
      // Record the request attempt
      this.recordRequest(provider, endpoint);
      
      // Simulate API call (in real implementation, this would make actual HTTP request)
      console.log(`Making request to ${provider}:${endpoint}`, data);
      
      // Return mock response for demonstration
      return {
        success: true,
        provider,
        endpoint,
        data,
        timestamp: new Date().toISOString(),
        requestId: this.generateRequestId()
      };
      
    } catch (error) {
      console.error(`Request failed for ${provider}:${endpoint}:`, error.message);
      throw error;
    }
  }

  queueRequest(provider, endpoint, data, priority = 'normal') {
    const requestId = this.generateRequestId();
    const queueKey = `${provider}:${endpoint}`;
    
    if (!this.queues[queueKey]) {
      this.queues[queueKey] = [];
    }
    
    const request = {
      id: requestId,
      provider,
      endpoint,
      data,
      priority,
      timestamp: Date.now(),
      retries: 0
    };
    
    // Insert based on priority
    const priorities = { high: 3, normal: 2, low: 1 };
    const priorityValue = priorities[priority] || 2;
    
    let inserted = false;
    for (let i = 0; i < this.queues[queueKey].length; i++) {
      const existingPriority = priorities[this.queues[queueKey][i].priority] || 2;
      if (priorityValue > existingPriority) {
        this.queues[queueKey].splice(i, 0, request);
        inserted = true;
        break;
      }
    }
    
    if (!inserted) {
      this.queues[queueKey].push(request);
    }
    
    this.saveState();
    console.log(`Queued request ${requestId} for ${provider}:${endpoint} with priority ${priority}`);
    
    return { queued: true, requestId };
  }

  getQueueStatus() {
    const status = {};
    
    for (const [queueKey, requests] of Object.entries(this.queues)) {
      const [provider, endpoint] = queueKey.split(':');
      if (!status[provider]) status[provider] = {};
      
      status[provider][endpoint] = {
        total: requests.length,
        high: requests.filter(r => r.priority === 'high').length,
        normal: requests.filter(r => r.priority === 'normal').length,
        low: requests.filter(r => r.priority === 'low').length,
        oldest: requests.length > 0 ? new Date(Math.min(...requests.map(r => r.timestamp))).toISOString() : null
      };
    }
    
    return status;
  }
}

// CLI interface
async function main() {
  const args = process.argv.slice(2);
  const throttle = new APIThrottle();
  
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
API Throttle - Intelligent rate limiting for AI agents

Usage:
  node throttle.js --provider <provider> --endpoint <endpoint> [options]
  node throttle.js --status
  
Options:
  --provider      API provider (twitter, coingecko, etc.)
  --endpoint      API endpoint name
  --data          JSON data for request
  --priority      Request priority (high, normal, low)
  --immediate     Skip rate limit check
  --status        Show queue status
  
Examples:
  node throttle.js --provider twitter --endpoint tweets --data '{"text":"hello"}'
  node throttle.js --provider coingecko --endpoint price --data '{"ids":"bitcoin"}' --priority high
  node throttle.js --status
`);
    return;
  }
  
  if (args.includes('--status')) {
    const status = throttle.getQueueStatus();
    console.log('Queue Status:');
    console.log(JSON.stringify(status, null, 2));
    return;
  }
  
  const provider = args[args.indexOf('--provider') + 1];
  const endpoint = args[args.indexOf('--endpoint') + 1];
  const dataArg = args[args.indexOf('--data') + 1];
  const priority = args[args.indexOf('--priority') + 1] || 'normal';
  const immediate = args.includes('--immediate');
  
  if (!provider || !endpoint) {
    console.error('Provider and endpoint are required');
    process.exit(1);
  }
  
  let data = {};
  if (dataArg) {
    try {
      data = JSON.parse(dataArg);
    } catch (error) {
      console.error('Invalid JSON in --data:', error.message);
      process.exit(1);
    }
  }
  
  try {
    const result = await throttle.request(provider, endpoint, data, { priority, immediate });
    console.log('Result:', JSON.stringify(result, null, 2));
  } catch (error) {
    console.error('Request failed:', error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = APIThrottle;