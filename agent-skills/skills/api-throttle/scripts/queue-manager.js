#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const APIThrottle = require('./throttle.js');

class QueueManager extends APIThrottle {
  constructor() {
    super();
    this.processing = false;
  }

  async processQueue(provider, endpoint) {
    const queueKey = `${provider}:${endpoint}`;
    const queue = this.queues[queueKey];
    
    if (!queue || queue.length === 0) {
      console.log(`No requests in queue for ${provider}:${endpoint}`);
      return { processed: 0 };
    }

    console.log(`Processing ${queue.length} requests for ${provider}:${endpoint}`);
    let processed = 0;
    let errors = 0;

    while (queue.length > 0 && !this.isRateLimited(provider, endpoint)) {
      const request = queue.shift();
      
      try {
        console.log(`Processing request ${request.id} (attempt ${request.retries + 1})`);
        
        const result = await this.request(provider, endpoint, request.data, { immediate: true });
        console.log(`✅ Request ${request.id} completed successfully`);
        processed++;
        
        // Small delay between requests
        await this.sleep(100);
        
      } catch (error) {
        console.error(`❌ Request ${request.id} failed:`, error.message);
        request.retries++;
        
        const maxRetries = this.config[provider]?.maxRetries || 3;
        
        if (request.retries < maxRetries) {
          console.log(`Retrying request ${request.id} (${request.retries}/${maxRetries})`);
          
          // Add backoff delay
          const delay = this.calculateBackoff(provider, request.retries);
          await this.sleep(delay);
          
          // Re-queue with same priority
          queue.unshift(request);
        } else {
          console.error(`🚨 Request ${request.id} exceeded max retries, dropping`);
          errors++;
        }
      }
    }

    this.saveState();
    
    const remaining = queue.length;
    console.log(`✅ Processed ${processed} requests, ${errors} errors, ${remaining} remaining`);
    
    return { processed, errors, remaining };
  }

  async processAllQueues() {
    console.log('Processing all queues...');
    
    const results = {};
    
    for (const queueKey of Object.keys(this.queues)) {
      const [provider, endpoint] = queueKey.split(':');
      
      console.log(`\n--- Processing ${provider}:${endpoint} ---`);
      results[queueKey] = await this.processQueue(provider, endpoint);
    }

    return results;
  }

  addToQueue(provider, endpoint, data, priority = 'normal') {
    const result = this.queueRequest(provider, endpoint, data, priority);
    console.log(`Added request to queue: ${result.requestId}`);
    return result;
  }

  removeFromQueue(requestId) {
    let found = false;
    
    for (const [queueKey, requests] of Object.entries(this.queues)) {
      const index = requests.findIndex(r => r.id === requestId);
      if (index !== -1) {
        requests.splice(index, 1);
        found = true;
        console.log(`Removed request ${requestId} from ${queueKey}`);
        break;
      }
    }
    
    if (found) {
      this.saveState();
    } else {
      console.log(`Request ${requestId} not found in any queue`);
    }
    
    return found;
  }

  clearQueue(provider, endpoint) {
    const queueKey = `${provider}:${endpoint}`;
    
    if (this.queues[queueKey]) {
      const count = this.queues[queueKey].length;
      this.queues[queueKey] = [];
      this.saveState();
      console.log(`Cleared ${count} requests from ${queueKey}`);
      return count;
    }
    
    console.log(`No queue found for ${queueKey}`);
    return 0;
  }

  getDetailedStatus() {
    const status = {
      timestamp: new Date().toISOString(),
      queues: {},
      totalRequests: 0
    };

    for (const [queueKey, requests] of Object.entries(this.queues)) {
      const [provider, endpoint] = queueKey.split(':');
      
      if (!status.queues[provider]) {
        status.queues[provider] = {};
      }

      const requestsByPriority = {
        high: requests.filter(r => r.priority === 'high'),
        normal: requests.filter(r => r.priority === 'normal'),
        low: requests.filter(r => r.priority === 'low')
      };

      status.queues[provider][endpoint] = {
        total: requests.length,
        byPriority: {
          high: requestsByPriority.high.length,
          normal: requestsByPriority.normal.length,
          low: requestsByPriority.low.length
        },
        oldestRequest: requests.length > 0 ? {
          id: requests[0].id,
          age: Date.now() - requests[0].timestamp,
          retries: requests[0].retries
        } : null,
        rateLimited: this.isRateLimited(provider, endpoint)
      };

      status.totalRequests += requests.length;
    }

    return status;
  }

  async startAutoProcessor(intervalMs = 30000) {
    if (this.processing) {
      console.log('Auto processor already running');
      return;
    }

    this.processing = true;
    console.log(`Starting auto processor (interval: ${intervalMs}ms)`);

    const process = async () => {
      if (!this.processing) return;

      try {
        const results = await this.processAllQueues();
        const totalProcessed = Object.values(results).reduce((sum, r) => sum + r.processed, 0);
        
        if (totalProcessed > 0) {
          console.log(`Auto processor: ${totalProcessed} requests processed`);
        }
      } catch (error) {
        console.error('Auto processor error:', error.message);
      }

      if (this.processing) {
        setTimeout(process, intervalMs);
      }
    };

    process();
  }

  stopAutoProcessor() {
    console.log('Stopping auto processor');
    this.processing = false;
  }
}

// CLI interface
async function main() {
  const args = process.argv.slice(2);
  const queueManager = new QueueManager();
  
  const command = args[0];
  
  if (!command || command === '--help' || command === '-h') {
    console.log(`
Queue Manager - Manage API request queues

Commands:
  add         Add request to queue
  process     Process queue(s)
  status      Show detailed queue status
  remove      Remove specific request
  clear       Clear queue
  auto        Start auto processor
  
Usage:
  node queue-manager.js add --provider <provider> --endpoint <endpoint> --data <json> [--priority high|normal|low]
  node queue-manager.js process [--provider <provider>] [--endpoint <endpoint>]
  node queue-manager.js status
  node queue-manager.js remove --id <requestId>
  node queue-manager.js clear --provider <provider> --endpoint <endpoint>
  node queue-manager.js auto [--interval <ms>]

Examples:
  node queue-manager.js add --provider twitter --endpoint tweets --data '{"text":"hello"}' --priority high
  node queue-manager.js process --provider twitter --endpoint tweets
  node queue-manager.js process
  node queue-manager.js status
  node queue-manager.js auto --interval 60000
`);
    return;
  }

  try {
    switch (command) {
      case 'add': {
        const provider = args[args.indexOf('--provider') + 1];
        const endpoint = args[args.indexOf('--endpoint') + 1];
        const dataArg = args[args.indexOf('--data') + 1];
        const priority = args[args.indexOf('--priority') + 1] || 'normal';

        if (!provider || !endpoint) {
          console.error('Provider and endpoint are required');
          process.exit(1);
        }

        let data = {};
        if (dataArg) {
          data = JSON.parse(dataArg);
        }

        const result = queueManager.addToQueue(provider, endpoint, data, priority);
        console.log(JSON.stringify(result, null, 2));
        break;
      }

      case 'process': {
        const provider = args[args.indexOf('--provider') + 1];
        const endpoint = args[args.indexOf('--endpoint') + 1];

        let result;
        if (provider && endpoint) {
          result = await queueManager.processQueue(provider, endpoint);
        } else {
          result = await queueManager.processAllQueues();
        }

        console.log('\nResults:', JSON.stringify(result, null, 2));
        break;
      }

      case 'status': {
        const status = queueManager.getDetailedStatus();
        console.log(JSON.stringify(status, null, 2));
        break;
      }

      case 'remove': {
        const requestId = args[args.indexOf('--id') + 1];
        
        if (!requestId) {
          console.error('Request ID is required');
          process.exit(1);
        }

        const removed = queueManager.removeFromQueue(requestId);
        console.log(JSON.stringify({ removed, requestId }, null, 2));
        break;
      }

      case 'clear': {
        const provider = args[args.indexOf('--provider') + 1];
        const endpoint = args[args.indexOf('--endpoint') + 1];

        if (!provider || !endpoint) {
          console.error('Provider and endpoint are required');
          process.exit(1);
        }

        const cleared = queueManager.clearQueue(provider, endpoint);
        console.log(JSON.stringify({ cleared, provider, endpoint }, null, 2));
        break;
      }

      case 'auto': {
        const intervalArg = args[args.indexOf('--interval') + 1];
        const interval = intervalArg ? parseInt(intervalArg) : 30000;

        console.log(`Starting auto processor with ${interval}ms interval`);
        console.log('Press Ctrl+C to stop');

        await queueManager.startAutoProcessor(interval);

        // Handle graceful shutdown
        process.on('SIGINT', () => {
          console.log('\nShutting down auto processor...');
          queueManager.stopAutoProcessor();
          process.exit(0);
        });

        // Keep process alive
        await new Promise(() => {});
        break;
      }

      default:
        console.error(`Unknown command: ${command}`);
        process.exit(1);
    }
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = QueueManager;