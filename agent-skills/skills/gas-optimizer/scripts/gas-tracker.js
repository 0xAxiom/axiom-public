#!/usr/bin/env node

/**
 * Gas Tracker - Analyze gas spending patterns across EVM chains
 * Usage: node gas-tracker.js --wallet 0x123... --chain ethereum --days 30
 */

const { ethers } = require('ethers');

const CHAIN_CONFIG = {
  ethereum: {
    rpcUrl: process.env.ETHEREUM_RPC_URL || 'https://eth.llamarpc.com',
    explorer: 'https://api.etherscan.io/api',
    apiKey: process.env.ETHERSCAN_API_KEY,
    chainId: 1
  },
  base: {
    rpcUrl: process.env.BASE_RPC_URL || 'https://base.llamarpc.com',
    explorer: 'https://api.basescan.org/api',
    apiKey: process.env.BASESCAN_API_KEY,
    chainId: 8453
  },
  arbitrum: {
    rpcUrl: process.env.ARBITRUM_RPC_URL || 'https://arb1.arbitrum.io/rpc',
    explorer: 'https://api.arbiscan.io/api',
    apiKey: process.env.ARBITRUM_API_KEY,
    chainId: 42161
  }
};

class GasTracker {
  constructor(chain = 'ethereum') {
    this.config = CHAIN_CONFIG[chain];
    if (!this.config) {
      throw new Error(`Unsupported chain: ${chain}`);
    }
    this.provider = new ethers.JsonRpcProvider(this.config.rpcUrl);
    this.chain = chain;
  }

  async getTransactionHistory(walletAddress, days = 30) {
    try {
      const endBlock = await this.provider.getBlockNumber();
      const startTimestamp = Math.floor(Date.now() / 1000) - (days * 24 * 60 * 60);
      
      // Get transactions from explorer API if available
      if (this.config.apiKey && this.config.explorer) {
        return await this.getTransactionsFromExplorer(walletAddress, startTimestamp);
      }
      
      // Fallback: scan recent blocks (limited)
      return await this.scanRecentBlocks(walletAddress, 1000);
    } catch (error) {
      console.error('Error fetching transaction history:', error.message);
      return [];
    }
  }

  async getTransactionsFromExplorer(walletAddress, startTimestamp) {
    const url = `${this.config.explorer}?module=account&action=txlist&address=${walletAddress}&startblock=0&endblock=latest&sort=desc&apikey=${this.config.apiKey}`;
    
    try {
      const fetch = (await import('node-fetch')).default;
      const response = await fetch(url);
      const data = await response.json();
      
      if (data.status !== '1') {
        throw new Error('Explorer API error: ' + data.message);
      }
      
      return data.result.filter(tx => parseInt(tx.timeStamp) >= startTimestamp);
    } catch (error) {
      console.error('Explorer API failed, using fallback method');
      return [];
    }
  }

  async scanRecentBlocks(walletAddress, blockCount) {
    const transactions = [];
    const currentBlock = await this.provider.getBlockNumber();
    const startBlock = Math.max(0, currentBlock - blockCount);
    
    console.log(`Scanning blocks ${startBlock} to ${currentBlock} (limited scan)...`);
    
    for (let blockNumber = currentBlock; blockNumber >= startBlock; blockNumber -= 100) {
      try {
        const block = await this.provider.getBlock(blockNumber, true);
        if (!block || !block.transactions) continue;
        
        for (const tx of block.transactions) {
          if (tx.from && tx.from.toLowerCase() === walletAddress.toLowerCase()) {
            const receipt = await this.provider.getTransactionReceipt(tx.hash);
            transactions.push({
              hash: tx.hash,
              gasUsed: receipt?.gasUsed?.toString() || '0',
              gasPrice: tx.gasPrice?.toString() || '0',
              timeStamp: block.timestamp.toString(),
              value: tx.value?.toString() || '0'
            });
          }
        }
      } catch (error) {
        // Skip failed blocks
        continue;
      }
    }
    
    return transactions;
  }

  analyzeGasSpending(transactions) {
    if (transactions.length === 0) {
      return {
        totalTransactions: 0,
        totalGasSpent: '0',
        totalCostETH: '0',
        averageCostPerTx: '0',
        dailyAverage: '0'
      };
    }

    let totalGasCost = BigInt(0);
    const dailyCosts = {};
    
    for (const tx of transactions) {
      const gasUsed = BigInt(tx.gasUsed || 0);
      const gasPrice = BigInt(tx.gasPrice || 0);
      const txCost = gasUsed * gasPrice;
      totalGasCost += txCost;
      
      const date = new Date(parseInt(tx.timeStamp) * 1000).toISOString().split('T')[0];
      if (!dailyCosts[date]) dailyCosts[date] = BigInt(0);
      dailyCosts[date] += txCost;
    }

    const totalCostETH = ethers.formatEther(totalGasCost);
    const averageCostPerTx = ethers.formatEther(totalGasCost / BigInt(transactions.length));
    
    const dailyValues = Object.values(dailyCosts);
    const dailyAverage = dailyValues.length > 0 
      ? ethers.formatEther(dailyValues.reduce((a, b) => a + b, BigInt(0)) / BigInt(dailyValues.length))
      : '0';

    return {
      totalTransactions: transactions.length,
      totalGasSpent: totalGasCost.toString(),
      totalCostETH: parseFloat(totalCostETH).toFixed(6),
      averageCostPerTx: parseFloat(averageCostPerTx).toFixed(6),
      dailyAverage: parseFloat(dailyAverage).toFixed(6),
      dailyBreakdown: Object.entries(dailyCosts).map(([date, cost]) => ({
        date,
        costETH: parseFloat(ethers.formatEther(cost)).toFixed(6)
      })).sort((a, b) => a.date.localeCompare(b.date))
    };
  }

  async getCurrentGasPrice() {
    try {
      const feeData = await this.provider.getFeeData();
      return {
        gasPrice: ethers.formatUnits(feeData.gasPrice || 0, 'gwei'),
        maxFeePerGas: feeData.maxFeePerGas ? ethers.formatUnits(feeData.maxFeePerGas, 'gwei') : null,
        maxPriorityFeePerGas: feeData.maxPriorityFeePerGas ? ethers.formatUnits(feeData.maxPriorityFeePerGas, 'gwei') : null
      };
    } catch (error) {
      console.error('Error getting current gas price:', error.message);
      return { gasPrice: '0', maxFeePerGas: null, maxPriorityFeePerGas: null };
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  const wallet = args.find(arg => arg.startsWith('--wallet'))?.split('=')[1] || args[args.indexOf('--wallet') + 1];
  const chain = args.find(arg => arg.startsWith('--chain'))?.split('=')[1] || args[args.indexOf('--chain') + 1] || 'ethereum';
  const days = parseInt(args.find(arg => arg.startsWith('--days'))?.split('=')[1] || args[args.indexOf('--days') + 1] || '30');
  const format = args.find(arg => arg.startsWith('--format'))?.split('=')[1] || args[args.indexOf('--format') + 1] || 'json';
  const analyze = args.includes('--analyze');

  if (!wallet && !analyze) {
    console.error('Usage: node gas-tracker.js --wallet 0x123... --chain ethereum --days 30');
    process.exit(1);
  }

  try {
    const tracker = new GasTracker(chain);
    
    if (analyze && !wallet) {
      // Analyze current gas conditions
      const gasPrice = await tracker.getCurrentGasPrice();
      const result = {
        chain,
        currentGas: gasPrice,
        timestamp: new Date().toISOString(),
        recommendations: {
          immediate: gasPrice.gasPrice < 30 ? 'Good time to transact' : 'Consider waiting',
          optimal: gasPrice.gasPrice < 20 ? 'Excellent gas prices' : 'Monitor for lower prices'
        }
      };
      
      console.log(format === 'csv' 
        ? `chain,gasPrice,recommendation\n${chain},${gasPrice.gasPrice},${result.recommendations.immediate}`
        : JSON.stringify(result, null, 2)
      );
      return;
    }

    console.log(`Fetching gas data for ${wallet} on ${chain}...`);
    const transactions = await tracker.getTransactionHistory(wallet, days);
    const analysis = tracker.analyzeGasSpending(transactions);
    const currentGas = await tracker.getCurrentGasPrice();

    const result = {
      wallet,
      chain,
      timeframe: `${days} days`,
      analysis,
      currentGas,
      timestamp: new Date().toISOString()
    };

    if (format === 'csv') {
      console.log('wallet,chain,totalTx,totalCostETH,avgCostPerTx,dailyAvg,currentGas');
      console.log(`${wallet},${chain},${analysis.totalTransactions},${analysis.totalCostETH},${analysis.averageCostPerTx},${analysis.dailyAverage},${currentGas.gasPrice}`);
    } else {
      console.log(JSON.stringify(result, null, 2));
    }

  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { GasTracker };