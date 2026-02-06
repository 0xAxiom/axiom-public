import { createPublicClient, http, formatGwei } from 'viem';
import { mainnet, base, arbitrum, polygon, optimism } from 'viem/chains';
import { GasSnapshot, CHAINS, Chain } from './types';
import { GasDatabase } from './database';

export class GasCollector {
  private db: GasDatabase;
  private clients: Map<number, any> = new Map();
  private isRunning = false;

  constructor() {
    this.db = new GasDatabase();
    this.initClients();
  }

  private initClients() {
    // Initialize viem clients for each chain
    const chainConfigs = {
      [mainnet.id]: mainnet,
      [base.id]: base,
      [arbitrum.id]: arbitrum, 
      [polygon.id]: polygon,
      [optimism.id]: optimism
    };

    for (const [chainId, chainConfig] of Object.entries(chainConfigs)) {
      const client = createPublicClient({
        chain: chainConfig,
        transport: http(CHAINS[parseInt(chainId)].rpcUrl)
      });
      this.clients.set(parseInt(chainId), client);
    }

    console.log(`Initialized RPC clients for ${this.clients.size} chains`);
  }

  async collectGasData(chainId: number): Promise<GasSnapshot | null> {
    const client = this.clients.get(chainId);
    if (!client) {
      console.error(`No client found for chain ${chainId}`);
      return null;
    }

    try {
      // Get latest block and gas info
      const [block, feeHistory] = await Promise.all([
        client.getBlock({ blockTag: 'latest' }),
        client.getFeeHistory({
          blockCount: 1,
          rewardPercentiles: [50], // median priority fee
        })
      ]);

      // Try to get pending tx count (some RPCs don't support this)
      let pendingTxCount = 0;
      try {
        const pending = await client.getBlockTransactionCount({ blockTag: 'pending' });
        pendingTxCount = Number(pending);
      } catch {
        // Fallback: use latest block tx count as approximation
        pendingTxCount = block.transactions?.length || 0;
      }

      // Calculate base fee and priority fee
      const baseFee = block.baseFeePerGas || 0n;
      const priorityFee = feeHistory.reward?.[0]?.[0] || 0n;

      const snapshot: GasSnapshot = {
        chainId,
        timestamp: Date.now(),
        baseFee,
        priorityFee,
        pendingTxCount,
        blockNumber: Number(block.number)
      };

      // Store in database
      this.db.insertGasSnapshot(snapshot);

      console.log(`[${CHAINS[chainId].name}] Block ${block.number}: Base ${formatGwei(baseFee)} + Priority ${formatGwei(priorityFee)} gwei | Pending: ${pendingTxCount}`);

      return snapshot;
    } catch (error) {
      console.error(`Error collecting gas data for chain ${chainId}:`, error);
      return null;
    }
  }

  async collectAllChains(): Promise<GasSnapshot[]> {
    const promises = Array.from(this.clients.keys()).map(chainId => 
      this.collectGasData(chainId)
    );

    const results = await Promise.allSettled(promises);
    const snapshots: GasSnapshot[] = [];

    results.forEach((result, index) => {
      if (result.status === 'fulfilled' && result.value) {
        snapshots.push(result.value);
      } else {
        const chainId = Array.from(this.clients.keys())[index];
        console.error(`Failed to collect from chain ${chainId}:`, result.status === 'rejected' ? result.reason : 'No data');
      }
    });

    return snapshots;
  }

  async startPolling(intervalSeconds: number = 5) {
    if (this.isRunning) {
      console.log('Collector already running');
      return;
    }

    this.isRunning = true;
    console.log(`Starting gas collection every ${intervalSeconds} seconds...`);

    // Initial collection
    await this.collectAllChains();

    // Set up interval
    const interval = setInterval(async () => {
      if (!this.isRunning) {
        clearInterval(interval);
        return;
      }

      try {
        await this.collectAllChains();
      } catch (error) {
        console.error('Error during collection cycle:', error);
      }
    }, intervalSeconds * 1000);

    // Clean old data every hour
    const cleanupInterval = setInterval(() => {
      if (!this.isRunning) {
        clearInterval(cleanupInterval);
        return;
      }
      this.db.cleanOldData();
    }, 60 * 60 * 1000); // 1 hour
  }

  stop() {
    this.isRunning = false;
    console.log('Gas collector stopped');
  }

  getDatabase() {
    return this.db;
  }
}

// Main execution if run directly
if (require.main === module) {
  const collector = new GasCollector();
  
  // Handle graceful shutdown
  process.on('SIGINT', () => {
    console.log('\nShutting down collector...');
    collector.stop();
    collector.getDatabase().close();
    process.exit(0);
  });

  // Start collecting
  collector.startPolling(5).catch(console.error);
}