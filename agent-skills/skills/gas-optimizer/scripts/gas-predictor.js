#!/usr/bin/env node

/**
 * Gas Predictor - Predict optimal gas prices and transaction timing
 * Usage: node gas-predictor.js --chain ethereum --priority medium
 */

const { ethers } = require('ethers');

const CHAIN_CONFIG = {
  ethereum: {
    rpcUrl: process.env.ETHEREUM_RPC_URL || 'https://eth.llamarpc.com',
    gasApi: 'https://api.etherscan.io/api?module=gastracker&action=gasoracle',
    apiKey: process.env.ETHERSCAN_API_KEY
  },
  base: {
    rpcUrl: process.env.BASE_RPC_URL || 'https://base.llamarpc.com',
    gasApi: 'https://api.basescan.org/api?module=gastracker&action=gasoracle',
    apiKey: process.env.BASESCAN_API_KEY
  }
};

const PRIORITY_LEVELS = {
  slow: { multiplier: 0.9, name: 'Slow (10+ min)' },
  medium: { multiplier: 1.0, name: 'Medium (3-5 min)' },
  fast: { multiplier: 1.2, name: 'Fast (<2 min)' },
  urgent: { multiplier: 1.5, name: 'Urgent (<30 sec)' }
};

class GasPredictor {
  constructor(chain = 'ethereum') {
    this.config = CHAIN_CONFIG[chain];
    if (!this.config) {
      throw new Error(`Unsupported chain: ${chain}`);
    }
    this.provider = new ethers.JsonRpcProvider(this.config.rpcUrl);
    this.chain = chain;
    this.gasHistory = [];
  }

  async getCurrentGasData() {
    try {
      // Try gas oracle API first
      if (this.config.gasApi && this.config.apiKey) {
        const gasData = await this.getGasFromOracle();
        if (gasData) return gasData;
      }
      
      // Fallback to RPC
      const feeData = await this.provider.getFeeData();
      return {
        safe: Math.floor(parseFloat(ethers.formatUnits(feeData.gasPrice || 0, 'gwei')) * 0.9),
        standard: Math.floor(parseFloat(ethers.formatUnits(feeData.gasPrice || 0, 'gwei'))),
        fast: Math.floor(parseFloat(ethers.formatUnits(feeData.gasPrice || 0, 'gwei')) * 1.2),
        source: 'rpc'
      };
    } catch (error) {
      console.error('Error getting gas data:', error.message);
      return { safe: 20, standard: 25, fast: 35, source: 'fallback' };
    }
  }

  async getGasFromOracle() {
    try {
      const fetch = (await import('node-fetch')).default;
      const url = `${this.config.gasApi}&apikey=${this.config.apiKey}`;
      const response = await fetch(url);
      const data = await response.json();
      
      if (data.status === '1' && data.result) {
        return {
          safe: parseInt(data.result.SafeGasPrice),
          standard: parseInt(data.result.StandardGasPrice),
          fast: parseInt(data.result.FastGasPrice),
          source: 'oracle'
        };
      }
    } catch (error) {
      // Fallback to RPC
    }
    return null;
  }

  async collectGasHistory(minutes = 60) {
    console.log(`Collecting gas data for ${minutes} minutes...`);
    const endTime = Date.now() + (minutes * 60 * 1000);
    
    while (Date.now() < endTime) {
      const gasData = await this.getCurrentGasData();
      this.gasHistory.push({
        timestamp: Date.now(),
        ...gasData
      });
      
      console.log(`Gas: ${gasData.standard} gwei (${gasData.source})`);
      await new Promise(resolve => setTimeout(resolve, 30000)); // 30 second intervals
    }
  }

  analyzeGasTrends() {
    if (this.gasHistory.length < 2) {
      return { trend: 'insufficient_data', confidence: 0 };
    }

    const recent = this.gasHistory.slice(-10);
    const older = this.gasHistory.slice(-20, -10);
    
    if (older.length === 0) {
      return { trend: 'insufficient_data', confidence: 0 };
    }

    const recentAvg = recent.reduce((sum, data) => sum + data.standard, 0) / recent.length;
    const olderAvg = older.reduce((sum, data) => sum + data.standard, 0) / older.length;
    
    const change = ((recentAvg - olderAvg) / olderAvg) * 100;
    
    let trend = 'stable';
    let confidence = Math.min(Math.abs(change) * 2, 90);
    
    if (change > 5) {
      trend = 'rising';
    } else if (change < -5) {
      trend = 'falling';
    }

    return { trend, change: change.toFixed(1), confidence: Math.floor(confidence) };
  }

  predictOptimalTime(targetGwei, maxWaitMinutes = 30) {
    const currentGas = this.gasHistory[this.gasHistory.length - 1]?.standard || 30;
    const trends = this.analyzeGasTrends();
    
    if (currentGas <= targetGwei) {
      return {
        recommendation: 'send_now',
        reason: `Current gas (${currentGas} gwei) is at/below target (${targetGwei} gwei)`,
        confidence: 95
      };
    }
    
    if (trends.trend === 'falling' && trends.confidence > 50) {
      const estimatedMinutes = Math.min(((currentGas - targetGwei) * 2), maxWaitMinutes);
      return {
        recommendation: 'wait',
        estimatedMinutes,
        reason: `Gas is trending down, likely to reach ${targetGwei} gwei in ~${estimatedMinutes} minutes`,
        confidence: trends.confidence
      };
    }
    
    if (trends.trend === 'rising' && currentGas > targetGwei * 1.5) {
      return {
        recommendation: 'wait_for_drop',
        reason: `Gas is rising and high (${currentGas} gwei). Consider waiting for next dip`,
        confidence: 70
      };
    }
    
    return {
      recommendation: 'send_with_higher_gas',
      suggestedGwei: Math.min(currentGas, targetGwei * 1.3),
      reason: `Gas stable around ${currentGas} gwei. Adjust target or send with current price`,
      confidence: 60
    };
  }

  getOptimalGasPrice(priority = 'medium') {
    const currentData = this.gasHistory[this.gasHistory.length - 1];
    if (!currentData) return null;
    
    const level = PRIORITY_LEVELS[priority];
    if (!level) {
      throw new Error(`Invalid priority: ${priority}. Use: slow, medium, fast, urgent`);
    }
    
    const basePrice = currentData.standard;
    const optimizedPrice = Math.ceil(basePrice * level.multiplier);
    
    return {
      gasPrice: optimizedPrice,
      priority: level.name,
      estimatedTime: this.estimateConfirmationTime(optimizedPrice, currentData),
      currentMarket: {
        safe: currentData.safe,
        standard: currentData.standard,
        fast: currentData.fast
      }
    };
  }

  estimateConfirmationTime(gasPrice, marketData) {
    const ratio = gasPrice / marketData.standard;
    
    if (ratio >= 1.4) return '<1 min';
    if (ratio >= 1.2) return '1-2 min';
    if (ratio >= 1.0) return '3-5 min';
    if (ratio >= 0.9) return '5-15 min';
    return '15+ min';
  }

  async monitorGasPrice(alertBelowGwei, durationMinutes = 60) {
    console.log(`Monitoring gas prices for ${durationMinutes} minutes, alert below ${alertBelowGwei} gwei`);
    
    const endTime = Date.now() + (durationMinutes * 60 * 1000);
    
    while (Date.now() < endTime) {
      const gasData = await this.getCurrentGasData();
      const timestamp = new Date().toISOString();
      
      console.log(`[${timestamp}] Gas: ${gasData.standard} gwei`);
      
      if (gasData.standard <= alertBelowGwei) {
        const alert = {
          alert: 'GAS_PRICE_TARGET_REACHED',
          timestamp,
          currentGas: gasData.standard,
          targetGas: alertBelowGwei,
          recommendation: 'SEND_TRANSACTIONS_NOW'
        };
        
        console.log('\n🚨 ALERT:', JSON.stringify(alert, null, 2));
        
        // Send to Telegram if configured
        if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
          await this.sendTelegramAlert(`🚨 Gas Alert: ${gasData.standard} gwei (target: ${alertBelowGwei})`);
        }
        
        break;
      }
      
      await new Promise(resolve => setTimeout(resolve, 60000)); // Check every minute
    }
  }

  async sendTelegramAlert(message) {
    try {
      const fetch = (await import('node-fetch')).default;
      const url = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`;
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: process.env.TELEGRAM_CHAT_ID,
          text: message
        })
      });
    } catch (error) {
      console.error('Failed to send Telegram alert:', error.message);
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  const chain = args.find(arg => arg.startsWith('--chain'))?.split('=')[1] || args[args.indexOf('--chain') + 1] || 'ethereum';
  const priority = args.find(arg => arg.startsWith('--priority'))?.split('=')[1] || args[args.indexOf('--priority') + 1] || 'medium';
  const targetGwei = parseInt(args.find(arg => arg.startsWith('--target-gwei'))?.split('=')[1] || args[args.indexOf('--target-gwei') + 1] || '0');
  const monitor = args.includes('--monitor');
  const alertBelow = parseInt(args.find(arg => arg.startsWith('--alert-below'))?.split('=')[1] || args[args.indexOf('--alert-below') + 1] || '20');
  const predictWindow = parseInt(args.find(arg => arg.startsWith('--predict-window'))?.split('=')[1]?.replace('h', '') || '1') * 60;

  try {
    const predictor = new GasPredictor(chain);
    
    if (monitor) {
      await predictor.monitorGasPrice(alertBelow, 60);
      return;
    }

    // Get current gas data
    const gasData = await predictor.getCurrentGasData();
    
    if (targetGwei > 0) {
      // Collect some history for prediction
      console.log('Analyzing gas trends...');
      await predictor.collectGasHistory(Math.min(predictWindow, 30));
      
      const prediction = predictor.predictOptimalTime(targetGwei);
      console.log(JSON.stringify({
        currentGas: gasData.standard,
        targetGas: targetGwei,
        prediction,
        timestamp: new Date().toISOString()
      }, null, 2));
    } else {
      // Get optimal gas price for priority level
      predictor.gasHistory.push({ timestamp: Date.now(), ...gasData });
      const optimal = predictor.getOptimalGasPrice(priority);
      
      console.log(JSON.stringify({
        chain,
        optimal,
        timestamp: new Date().toISOString()
      }, null, 2));
    }

  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { GasPredictor };