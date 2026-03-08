#!/usr/bin/env node

/**
 * Fee Optimizer - Optimize transaction batching and cost estimation
 * Usage: node fee-optimizer.js --batch-estimate file1.json file2.json
 */

const { ethers } = require('ethers');
const fs = require('fs').promises;
const path = require('path');

const CHAIN_CONFIG = {
  ethereum: {
    rpcUrl: process.env.ETHEREUM_RPC_URL || 'https://eth.llamarpc.com',
    chainId: 1,
    nativeToken: 'ETH'
  },
  base: {
    rpcUrl: process.env.BASE_RPC_URL || 'https://base.llamarpc.com',
    chainId: 8453,
    nativeToken: 'ETH'
  },
  arbitrum: {
    rpcUrl: process.env.ARBITRUM_RPC_URL || 'https://arb1.arbitrum.io/rpc',
    chainId: 42161,
    nativeToken: 'ETH'
  }
};

// Common contract ABIs for batching
const MULTICALL_ABI = [
  "function aggregate(tuple(address target, bytes callData)[] calls) returns (uint256 blockNumber, bytes[] returnData)"
];

const ERC20_ABI = [
  "function transfer(address to, uint256 amount) returns (bool)",
  "function balanceOf(address owner) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)"
];

class FeeOptimizer {
  constructor(chain = 'ethereum') {
    this.config = CHAIN_CONFIG[chain];
    if (!this.config) {
      throw new Error(`Unsupported chain: ${chain}`);
    }
    this.provider = new ethers.JsonRpcProvider(this.config.rpcUrl);
    this.chain = chain;
  }

  async estimateTransactionCost(txData) {
    try {
      // Validate transaction data
      const tx = {
        to: txData.to,
        data: txData.data || '0x',
        value: txData.value || '0',
        from: txData.from || ethers.ZeroAddress
      };

      // Estimate gas limit
      const gasLimit = await this.provider.estimateGas(tx);
      
      // Get current gas price
      const feeData = await this.provider.getFeeData();
      const gasPrice = feeData.gasPrice || feeData.maxFeePerGas || 0;

      // Calculate total cost
      const totalCost = gasLimit * gasPrice;
      
      return {
        gasLimit: gasLimit.toString(),
        gasPrice: gasPrice.toString(),
        gasPriceGwei: ethers.formatUnits(gasPrice, 'gwei'),
        totalCostWei: totalCost.toString(),
        totalCostETH: ethers.formatEther(totalCost),
        success: true
      };

    } catch (error) {
      return {
        error: error.message,
        success: false,
        gasLimit: '0',
        gasPrice: '0',
        totalCostWei: '0',
        totalCostETH: '0'
      };
    }
  }

  async batchEstimate(transactionFiles) {
    const results = {
      individual: [],
      batchAnalysis: null,
      savings: null,
      recommendations: []
    };

    // Load and estimate individual transactions
    for (const file of transactionFiles) {
      try {
        const content = await fs.readFile(file, 'utf8');
        const txData = JSON.parse(content);
        
        if (Array.isArray(txData)) {
          // File contains multiple transactions
          for (let i = 0; i < txData.length; i++) {
            const estimate = await this.estimateTransactionCost(txData[i]);
            results.individual.push({
              file: `${file}[${i}]`,
              transaction: txData[i],
              estimate
            });
          }
        } else {
          // Single transaction
          const estimate = await this.estimateTransactionCost(txData);
          results.individual.push({
            file,
            transaction: txData,
            estimate
          });
        }
      } catch (error) {
        results.individual.push({
          file,
          error: error.message,
          estimate: { success: false }
        });
      }
    }

    // Calculate batch potential
    const successfulTxs = results.individual.filter(r => r.estimate.success);
    if (successfulTxs.length > 1) {
      results.batchAnalysis = await this.analyzeBatchPotential(successfulTxs);
    }

    // Generate recommendations
    results.recommendations = this.generateOptimizationRecommendations(results);

    return results;
  }

  async analyzeBatchPotential(transactions) {
    // Calculate individual costs
    const individualCosts = transactions.map(tx => BigInt(tx.estimate.totalCostWei));
    const totalIndividualCost = individualCosts.reduce((a, b) => a + b, BigInt(0));

    // Estimate batch transaction cost
    const batchCalldata = this.generateBatchCalldata(transactions);
    const batchEstimate = await this.estimateTransactionCost({
      to: this.getMulticallAddress(),
      data: batchCalldata,
      from: transactions[0]?.transaction?.from
    });

    if (!batchEstimate.success) {
      return {
        canBatch: false,
        reason: 'Batch estimation failed',
        error: batchEstimate.error
      };
    }

    const batchCost = BigInt(batchEstimate.totalCostWei);
    const savings = totalIndividualCost - batchCost;
    const savingsPercent = Number(savings * BigInt(10000) / totalIndividualCost) / 100;

    return {
      canBatch: true,
      individualCostETH: ethers.formatEther(totalIndividualCost),
      batchCostETH: ethers.formatEther(batchCost),
      savingsETH: ethers.formatEther(savings),
      savingsPercent: savingsPercent.toFixed(2),
      transactionCount: transactions.length,
      batchGasLimit: batchEstimate.gasLimit,
      recommended: savingsPercent > 10 // Recommend if >10% savings
    };
  }

  generateBatchCalldata(transactions) {
    // Simplified batch encoding - would need multicall contract
    const calls = transactions.map(tx => ({
      target: tx.transaction.to,
      callData: tx.transaction.data || '0x'
    }));

    const multicallInterface = new ethers.Interface(MULTICALL_ABI);
    return multicallInterface.encodeFunctionData('aggregate', [calls]);
  }

  getMulticallAddress() {
    // Common multicall addresses (would be configurable in production)
    const addresses = {
      ethereum: '0x5BA1e12693Dc8F9c48aAD8770482f4739bEeD696',
      base: '0xcA11bde05977b3631167028862bE2a173976CA11',
      arbitrum: '0xcA11bde05977b3631167028862bE2a173976CA11'
    };
    return addresses[this.chain] || addresses.ethereum;
  }

  generateOptimizationRecommendations(results) {
    const recommendations = [];

    if (results.batchAnalysis?.canBatch && results.batchAnalysis.recommended) {
      recommendations.push({
        type: 'batch_transactions',
        priority: 'high',
        description: `Batch ${results.batchAnalysis.transactionCount} transactions to save ${results.batchAnalysis.savingsPercent}% (${results.batchAnalysis.savingsETH} ETH)`,
        action: 'Use multicall contract to execute all transactions in single batch'
      });
    }

    const failedTxs = results.individual.filter(r => !r.estimate.success);
    if (failedTxs.length > 0) {
      recommendations.push({
        type: 'fix_failed_estimates',
        priority: 'high',
        description: `${failedTxs.length} transactions failed estimation`,
        action: 'Review transaction data and fix invalid parameters',
        failedTransactions: failedTxs.map(tx => ({ file: tx.file, error: tx.error }))
      });
    }

    const highGasTxs = results.individual.filter(r => 
      r.estimate.success && parseFloat(r.estimate.gasPriceGwei) > 50
    );

    if (highGasTxs.length > 0) {
      recommendations.push({
        type: 'high_gas_warning',
        priority: 'medium',
        description: `${highGasTxs.length} transactions have high gas prices (>50 gwei)`,
        action: 'Consider waiting for lower gas prices or adjusting priority'
      });
    }

    return recommendations;
  }

  async optimizePendingTransactions(walletAddress) {
    try {
      // Get pending transactions (this would typically require a mempool API)
      console.log('Note: Pending transaction optimization requires mempool access');
      console.log('Consider using services like Blocknative or Flashbots for production use');

      // Placeholder for pending tx optimization
      return {
        message: 'Pending transaction optimization not implemented - requires mempool API',
        suggestions: [
          'Use Flashbots for MEV protection',
          'Monitor mempool with Blocknative',
          'Implement gas price bumping for stuck transactions'
        ]
      };

    } catch (error) {
      return { error: error.message };
    }
  }

  async estimateOptimalTiming(transactions, maxWaitHours = 24) {
    // Simulate gas price over time (simplified model)
    const currentGasPrice = await this.getCurrentGasPrice();
    const totalCost = this.calculateTotalCost(transactions, currentGasPrice);

    // Simple prediction based on historical patterns
    const timeWindows = [];
    for (let hours = 0; hours < maxWaitHours; hours += 2) {
      const predictedGasPrice = this.predictGasPrice(currentGasPrice, hours);
      const predictedCost = this.calculateTotalCost(transactions, predictedGasPrice);
      const savings = ((totalCost - predictedCost) / totalCost) * 100;

      timeWindows.push({
        hoursFromNow: hours,
        predictedGasPriceGwei: predictedGasPrice,
        estimatedCostETH: ethers.formatEther(predictedCost),
        savingsPercent: savings.toFixed(2)
      });
    }

    const optimalWindow = timeWindows.reduce((best, current) => 
      parseFloat(current.savingsPercent) > parseFloat(best.savingsPercent) ? current : best
    );

    return {
      currentCostETH: ethers.formatEther(totalCost),
      currentGasPriceGwei: currentGasPrice,
      optimalTiming: optimalWindow,
      allWindows: timeWindows
    };
  }

  async getCurrentGasPrice() {
    const feeData = await this.provider.getFeeData();
    return parseFloat(ethers.formatUnits(feeData.gasPrice || 0, 'gwei'));
  }

  calculateTotalCost(transactions, gasPriceGwei) {
    const gasPriceWei = ethers.parseUnits(gasPriceGwei.toString(), 'gwei');
    let totalCost = BigInt(0);

    for (const tx of transactions) {
      if (tx.estimate?.success) {
        const gasLimit = BigInt(tx.estimate.gasLimit);
        totalCost += gasLimit * gasPriceWei;
      }
    }

    return totalCost;
  }

  predictGasPrice(currentPrice, hoursFromNow) {
    // Simplified gas price prediction (in production, use ML models or historical data)
    const timeOfDay = (new Date().getHours() + hoursFromNow) % 24;
    
    // Simple model: gas is typically lower at night (2-8 AM UTC)
    let multiplier = 1.0;
    if (timeOfDay >= 2 && timeOfDay <= 8) {
      multiplier = 0.7; // 30% lower at night
    } else if (timeOfDay >= 14 && timeOfDay <= 18) {
      multiplier = 1.3; // 30% higher during peak hours
    }

    return currentPrice * multiplier;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const chain = args.find(arg => arg.startsWith('--chain'))?.split('=')[1] || args[args.indexOf('--chain') + 1] || 'ethereum';
  const optimizePending = args.includes('--optimize-pending');
  const wallet = args.find(arg => arg.startsWith('--wallet'))?.split('=')[1] || args[args.indexOf('--wallet') + 1];
  
  // Get transaction files (any args that aren't flags)
  const transactionFiles = args.filter(arg => !arg.startsWith('--') && !Object.values(CHAIN_CONFIG).some(c => arg === c.name));

  try {
    const optimizer = new FeeOptimizer(chain);

    if (optimizePending) {
      if (!wallet) {
        console.error('Wallet address required for pending transaction optimization');
        process.exit(1);
      }
      
      const result = await optimizer.optimizePendingTransactions(wallet);
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    if (transactionFiles.length === 0) {
      console.error('Usage: node fee-optimizer.js [--chain ethereum] [--optimize-pending --wallet 0x...] file1.json [file2.json...]');
      process.exit(1);
    }

    console.log(`Analyzing ${transactionFiles.length} transaction files on ${chain}...`);
    const results = await optimizer.batchEstimate(transactionFiles);
    
    console.log(JSON.stringify(results, null, 2));

  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { FeeOptimizer };