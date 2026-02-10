#!/usr/bin/env node

import { createPublicClient, http, formatUnits } from 'viem';
import { base, mainnet } from 'viem/chains';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ERC20 ABI - minimal for balanceOf
const ERC20_ABI = [
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'owner', type: 'address' }],
    outputs: [{ type: 'uint256' }]
  }
];

class FundSentinel {
  constructor(configPath = './config.json') {
    this.configPath = configPath;
    this.config = null;
    this.clients = {};
  }

  async loadConfig() {
    try {
      const configData = await fs.readFile(this.configPath, 'utf8');
      this.config = JSON.parse(configData);
      
      // Initialize RPC clients
      this.clients.base = createPublicClient({
        chain: base,
        transport: http(this.config.chains.base.rpcUrl)
      });
      
      this.clients.ethereum = createPublicClient({
        chain: mainnet,
        transport: http(this.config.chains.ethereum.rpcUrl)
      });
      
    } catch (error) {
      throw new Error(`Failed to load config: ${error.message}`);
    }
  }

  async getBalances(wallet, chainName, tokens) {
    const client = this.clients[chainName];
    const balances = {};
    
    try {
      // Get native ETH balance
      const ethBalance = await client.getBalance({ address: wallet });
      balances.ETH = formatUnits(ethBalance, 18);
      
      // Get token balances for this chain
      const chainTokens = Object.entries(tokens).filter(([_, token]) => token.chain === chainName);
      
      if (chainTokens.length > 0) {
        const calls = chainTokens.map(([tokenName, token]) => ({
          address: token.address,
          abi: ERC20_ABI,
          functionName: 'balanceOf',
          args: [wallet]
        }));
        
        const results = await client.multicall({ contracts: calls });
        
        chainTokens.forEach(([tokenName, tokenConfig], index) => {
          const result = results[index];
          if (result.status === 'success') {
            const tokenSymbol = tokenName.split('_')[0]; // USDC_BASE -> USDC
            balances[tokenSymbol] = formatUnits(result.result, tokenConfig.decimals);
          } else {
            const tokenSymbol = tokenName.split('_')[0];
            balances[tokenSymbol] = '0';
          }
        });
      }
      
    } catch (error) {
      console.error(`Error getting balances for ${wallet} on ${chainName}:`, error.message);
      // Return zero balances on error
      balances.ETH = '0';
      Object.entries(tokens)
        .filter(([_, token]) => token.chain === chainName)
        .forEach(([tokenName, _]) => {
          const tokenSymbol = tokenName.split('_')[0];
          balances[tokenSymbol] = '0';
        });
    }
    
    return balances;
  }

  async getCurrentSnapshot() {
    const snapshot = {};
    
    for (const [walletName, walletAddress] of Object.entries(this.config.wallets)) {
      snapshot[walletName] = {};
      
      for (const chainName of Object.keys(this.config.chains)) {
        snapshot[walletName][chainName] = await this.getBalances(
          walletAddress, 
          chainName, 
          this.config.tokens
        );
      }
    }
    
    return snapshot;
  }

  async loadPreviousSnapshot() {
    try {
      const data = await fs.readFile(this.config.snapshotFile, 'utf8');
      const snapshots = JSON.parse(data);
      return snapshots.length > 0 ? snapshots[snapshots.length - 1].snapshot : null;
    } catch (error) {
      return null; // No previous snapshot
    }
  }

  async saveSnapshot(snapshot) {
    const snapshotEntry = {
      timestamp: new Date().toISOString(),
      snapshot
    };
    
    let snapshots = [];
    try {
      const data = await fs.readFile(this.config.snapshotFile, 'utf8');
      snapshots = JSON.parse(data);
    } catch (error) {
      // File doesn't exist or is invalid, start fresh
    }
    
    snapshots.push(snapshotEntry);
    
    // Keep only last 100 snapshots
    if (snapshots.length > 100) {
      snapshots = snapshots.slice(-100);
    }
    
    await fs.writeFile(this.config.snapshotFile, JSON.stringify(snapshots, null, 2));
  }

  compareSnapshots(current, previous) {
    const alerts = [];
    const changes = [];
    
    if (!previous) {
      return { alerts, changes };
    }
    
    for (const [walletName, walletData] of Object.entries(current)) {
      const prevWalletData = previous[walletName];
      if (!prevWalletData) continue;
      
      for (const [chainName, chainData] of Object.entries(walletData)) {
        const prevChainData = prevWalletData[chainName];
        if (!prevChainData) continue;
        
        for (const [tokenSymbol, currentBalance] of Object.entries(chainData)) {
          const prevBalance = prevChainData[tokenSymbol] || '0';
          const currentNum = parseFloat(currentBalance);
          const prevNum = parseFloat(prevBalance);
          
          if (prevNum === 0 && currentNum === 0) continue;
          
          const change = {
            wallet: walletName,
            chain: chainName,
            token: tokenSymbol,
            previousBalance: prevBalance,
            currentBalance: currentBalance,
            changeAmount: (currentNum - prevNum).toFixed(6),
            changePercent: prevNum > 0 ? ((currentNum - prevNum) / prevNum * 100) : 0
          };
          
          changes.push(change);
          
          // Check thresholds
          if (prevNum > 0 && currentNum < prevNum) {
            const dropPercent = Math.abs(change.changePercent);
            const dropValue = Math.abs(currentNum - prevNum);
            
            if (dropPercent >= this.config.thresholds.balanceDropPercent && 
                dropValue >= this.config.thresholds.minAlertValueUsd / 100) { // Simple USD approximation
              
              const severity = dropPercent >= 50 ? 'HIGH' : 'MEDIUM';
              const message = `⚠️ ${walletName} ${tokenSymbol} on ${chainName} dropped ${dropPercent.toFixed(1)}% (${prevBalance} → ${currentBalance})`;
              
              alerts.push({
                severity,
                wallet: walletName,
                chain: chainName,
                token: tokenSymbol,
                previousBalance: prevBalance,
                currentBalance: currentBalance,
                changePercent: -dropPercent,
                message
              });
            }
          }
        }
      }
    }
    
    return { alerts, changes };
  }

  async run() {
    try {
      await this.loadConfig();
      
      const currentSnapshot = await this.getCurrentSnapshot();
      const previousSnapshot = await this.loadPreviousSnapshot();
      
      const { alerts, changes } = this.compareSnapshots(currentSnapshot, previousSnapshot);
      
      await this.saveSnapshot(currentSnapshot);
      
      const result = {
        timestamp: new Date().toISOString(),
        alerts,
        snapshot: currentSnapshot,
        changes
      };
      
      console.log(JSON.stringify(result, null, 2));
      
      // Exit with code 1 if there are alerts
      process.exit(alerts.length > 0 ? 1 : 0);
      
    } catch (error) {
      console.error('Error:', error.message);
      process.exit(2);
    }
  }
}

// Handle command line args
const configPath = process.argv[2] || './config.json';
const sentinel = new FundSentinel(configPath);
sentinel.run();