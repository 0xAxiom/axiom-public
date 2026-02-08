#!/usr/bin/env node
/**
 * Agent Launch Monitor
 * Track post-launch metrics for tokens deployed via Agent Launchpad
 * 
 * Features:
 * - Price, volume, liquidity, holder tracking
 * - Milestone alerts (ATH, volume spikes, holder counts)
 * - Historical state persistence
 * - Multi-token support
 * 
 * Usage:
 *   ./monitor.mjs check <tokenAddress>     # One-time check
 *   ./monitor.mjs track <tokenAddress>     # Add to tracking list
 *   ./monitor.mjs status                   # All tracked tokens
 *   ./monitor.mjs alerts                   # Check for alert conditions
 */

import { createPublicClient, http, formatUnits, parseAbi } from 'viem';
import { base } from 'viem/chains';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE_FILE = path.join(__dirname, '..', 'state.json');
const CONFIG_FILE = path.join(__dirname, '..', 'config.json');

// Dexscreener API (no key needed, 300 req/min)
const DEXSCREENER_API = 'https://api.dexscreener.com';

// Etherscan V2 API for holder counts
const ETHERSCAN_API = 'https://api.etherscan.io/v2/api';
const ETHERSCAN_KEY = process.env.ETHERSCAN_API_KEY;

// Base RPC
const client = createPublicClient({
  chain: base,
  transport: http('https://mainnet.base.org'),
});

// ERC20 ABI for supply
const ERC20_ABI = parseAbi([
  'function totalSupply() view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function name() view returns (string)',
  'function symbol() view returns (string)',
]);

/**
 * Load persisted state
 */
function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('Failed to load state:', e.message);
  }
  return {
    tokens: {},
    alerts: [],
    lastCheck: null,
  };
}

/**
 * Save state
 */
function saveState(state) {
  state.lastCheck = new Date().toISOString();
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

/**
 * Load config with alert thresholds
 */
function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('Failed to load config:', e.message);
  }
  return {
    // Default alert thresholds
    priceChangeAlertPct: 20,      // Alert on 20%+ price change
    volumeSpikeMultiple: 3,       // Alert when volume 3x average
    holderMilestones: [100, 500, 1000, 5000, 10000],
    liquidityMinUsd: 1000,        // Alert if liquidity drops below
    checkIntervalMs: 300000,      // 5 minutes
  };
}

/**
 * Fetch token data from Dexscreener
 */
async function fetchDexscreener(tokenAddress) {
  const url = `${DEXSCREENER_API}/tokens/v1/base/${tokenAddress}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Dexscreener API error: ${res.status}`);
  const data = await res.json();
  
  // Returns array of pairs - find the main one (highest liquidity)
  if (!data || data.length === 0) return null;
  
  // Sort by liquidity, take highest
  const pairs = data.sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0));
  return pairs[0];
}

/**
 * Fetch holder count from Etherscan V2
 */
async function fetchHolderCount(tokenAddress) {
  if (!ETHERSCAN_KEY) return null;
  
  const url = `${ETHERSCAN_API}?chainid=8453&module=token&action=tokenholdercount&contractaddress=${tokenAddress}&apikey=${ETHERSCAN_KEY}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  
  const data = await res.json();
  if (data.status === '1' && data.result) {
    return parseInt(data.result);
  }
  return null;
}

/**
 * Get on-chain token info
 */
async function fetchOnchainInfo(tokenAddress) {
  try {
    const [name, symbol, decimals, totalSupply] = await Promise.all([
      client.readContract({ address: tokenAddress, abi: ERC20_ABI, functionName: 'name' }),
      client.readContract({ address: tokenAddress, abi: ERC20_ABI, functionName: 'symbol' }),
      client.readContract({ address: tokenAddress, abi: ERC20_ABI, functionName: 'decimals' }),
      client.readContract({ address: tokenAddress, abi: ERC20_ABI, functionName: 'totalSupply' }),
    ]);
    return {
      name,
      symbol,
      decimals,
      totalSupply: formatUnits(totalSupply, decimals),
    };
  } catch (e) {
    return null;
  }
}

/**
 * Check a single token and return metrics
 */
async function checkToken(tokenAddress) {
  const [dexData, holderCount, onchainInfo] = await Promise.all([
    fetchDexscreener(tokenAddress),
    fetchHolderCount(tokenAddress),
    fetchOnchainInfo(tokenAddress),
  ]);
  
  if (!dexData) {
    return { error: 'No DEX data found - token may not have liquidity yet' };
  }
  
  return {
    address: tokenAddress,
    name: onchainInfo?.name || dexData.baseToken?.name || 'Unknown',
    symbol: onchainInfo?.symbol || dexData.baseToken?.symbol || '???',
    
    // Price data
    priceUsd: parseFloat(dexData.priceUsd) || 0,
    priceChange24h: dexData.priceChange?.h24 || 0,
    priceChange1h: dexData.priceChange?.h1 || 0,
    
    // Volume
    volume24h: dexData.volume?.h24 || 0,
    volume1h: dexData.volume?.h1 || 0,
    
    // Liquidity
    liquidityUsd: dexData.liquidity?.usd || 0,
    
    // Market cap
    fdv: dexData.fdv || 0,
    marketCap: dexData.marketCap || 0,
    
    // Holders
    holders: holderCount,
    
    // Pair info
    pairAddress: dexData.pairAddress,
    dexId: dexData.dexId,
    
    // Timestamps
    pairCreatedAt: dexData.pairCreatedAt,
    checkedAt: new Date().toISOString(),
  };
}

/**
 * Detect alert conditions
 */
function detectAlerts(token, prevData, tokenState, config) {
  const alerts = [];
  
  if (!prevData) return alerts; // First check, no alerts
  
  // Price change alert
  if (prevData.priceUsd > 0) {
    const priceDelta = ((token.priceUsd - prevData.priceUsd) / prevData.priceUsd) * 100;
    if (Math.abs(priceDelta) >= config.priceChangeAlertPct) {
      alerts.push({
        type: priceDelta > 0 ? 'PRICE_PUMP' : 'PRICE_DUMP',
        message: `${token.symbol} price ${priceDelta > 0 ? '🚀' : '📉'} ${priceDelta.toFixed(1)}% ($${token.priceUsd.toFixed(6)})`,
        severity: Math.abs(priceDelta) >= 50 ? 'high' : 'medium',
      });
    }
  }
  
  // New ATH (compare to persisted ATH, not prevData)
  const previousAth = tokenState.athPrice || 0;
  if (token.priceUsd > previousAth && previousAth > 0) {
    alerts.push({
      type: 'NEW_ATH',
      message: `${token.symbol} hit new ATH! 🏆 $${token.priceUsd.toFixed(8)} (was $${previousAth.toFixed(8)})`,
      severity: 'high',
    });
  }
  
  // Volume spike
  if (prevData.volume24h > 0) {
    const volumeMultiple = token.volume24h / prevData.volume24h;
    if (volumeMultiple >= config.volumeSpikeMultiple) {
      alerts.push({
        type: 'VOLUME_SPIKE',
        message: `${token.symbol} volume spike! 📊 ${volumeMultiple.toFixed(1)}x ($${token.volume24h.toLocaleString()})`,
        severity: 'medium',
      });
    }
  }
  
  // Holder milestones
  if (token.holders && prevData.holders) {
    for (const milestone of config.holderMilestones) {
      if (token.holders >= milestone && prevData.holders < milestone) {
        alerts.push({
          type: 'HOLDER_MILESTONE',
          message: `${token.symbol} reached ${milestone} holders! 👥`,
          severity: 'medium',
        });
      }
    }
  }
  
  // Low liquidity warning
  if (token.liquidityUsd < config.liquidityMinUsd && prevData.liquidityUsd >= config.liquidityMinUsd) {
    alerts.push({
      type: 'LOW_LIQUIDITY',
      message: `${token.symbol} liquidity dropped below $${config.liquidityMinUsd}! ⚠️ ($${token.liquidityUsd.toFixed(0)})`,
      severity: 'high',
    });
  }
  
  return alerts;
}

/**
 * Format token metrics for display
 */
function formatMetrics(token) {
  if (token.error) return `❌ ${token.error}`;
  
  const lines = [
    `📊 ${token.name} (${token.symbol})`,
    `   Address: ${token.address}`,
    ``,
    `💰 Price: $${token.priceUsd.toFixed(8)}`,
    `   1h: ${token.priceChange1h >= 0 ? '+' : ''}${token.priceChange1h.toFixed(2)}%`,
    `   24h: ${token.priceChange24h >= 0 ? '+' : ''}${token.priceChange24h.toFixed(2)}%`,
    ``,
    `📈 Market Cap: $${token.marketCap.toLocaleString()}`,
    `   FDV: $${token.fdv.toLocaleString()}`,
    ``,
    `💧 Liquidity: $${token.liquidityUsd.toLocaleString()}`,
    `📊 Volume 24h: $${token.volume24h.toLocaleString()}`,
  ];
  
  if (token.holders) {
    lines.push(`👥 Holders: ${token.holders.toLocaleString()}`);
  }
  
  lines.push(``, `🔗 DEX: ${token.dexId} | Pair: ${token.pairAddress?.slice(0, 10)}...`);
  lines.push(`⏰ Checked: ${token.checkedAt}`);
  
  return lines.join('\n');
}

// CLI
const [,, command, ...args] = process.argv;

async function main() {
  const state = loadState();
  const config = loadConfig();
  
  switch (command) {
    case 'check': {
      const tokenAddress = args[0];
      if (!tokenAddress) {
        console.error('Usage: monitor.mjs check <tokenAddress>');
        process.exit(1);
      }
      console.log(`Checking ${tokenAddress}...\n`);
      const metrics = await checkToken(tokenAddress);
      console.log(formatMetrics(metrics));
      break;
    }
    
    case 'track': {
      const tokenAddress = args[0];
      const name = args[1] || 'Unknown';
      if (!tokenAddress) {
        console.error('Usage: monitor.mjs track <tokenAddress> [name]');
        process.exit(1);
      }
      
      console.log(`Adding ${tokenAddress} to tracking...`);
      const metrics = await checkToken(tokenAddress);
      
      if (metrics.error) {
        console.error(`❌ Cannot track: ${metrics.error}`);
        process.exit(1);
      }
      
      state.tokens[tokenAddress] = {
        addedAt: new Date().toISOString(),
        name: metrics.name,
        symbol: metrics.symbol,
        launchPrice: metrics.priceUsd,
        athPrice: metrics.priceUsd,
        history: [metrics],
      };
      
      saveState(state);
      console.log(`✅ Now tracking ${metrics.symbol}`);
      console.log(formatMetrics(metrics));
      break;
    }
    
    case 'untrack': {
      const tokenAddress = args[0];
      if (!tokenAddress || !state.tokens[tokenAddress]) {
        console.error('Token not found in tracking list');
        process.exit(1);
      }
      const symbol = state.tokens[tokenAddress].symbol;
      delete state.tokens[tokenAddress];
      saveState(state);
      console.log(`✅ Stopped tracking ${symbol}`);
      break;
    }
    
    case 'status': {
      const tokenAddresses = Object.keys(state.tokens);
      if (tokenAddresses.length === 0) {
        console.log('No tokens being tracked. Use: monitor.mjs track <address>');
        break;
      }
      
      console.log(`📋 Tracking ${tokenAddresses.length} token(s)\n`);
      
      for (const addr of tokenAddresses) {
        const tokenState = state.tokens[addr];
        const metrics = await checkToken(addr);
        
        if (!metrics.error) {
          // Update ATH
          if (metrics.priceUsd > (tokenState.athPrice || 0)) {
            tokenState.athPrice = metrics.priceUsd;
          }
          
          // Calculate ROI from launch
          const roi = tokenState.launchPrice > 0
            ? ((metrics.priceUsd - tokenState.launchPrice) / tokenState.launchPrice * 100).toFixed(1)
            : 'N/A';
          
          console.log(formatMetrics(metrics));
          console.log(`   🚀 Launch: $${tokenState.launchPrice?.toFixed(8) || 'N/A'} | ROI: ${roi}%`);
          console.log(`   🏆 ATH: $${tokenState.athPrice?.toFixed(8) || 'N/A'}`);
          console.log(`   📅 Tracking since: ${tokenState.addedAt}`);
        } else {
          console.log(`❌ ${addr}: ${metrics.error}`);
        }
        console.log('\n' + '─'.repeat(50) + '\n');
      }
      
      saveState(state);
      break;
    }
    
    case 'alerts': {
      const tokenAddresses = Object.keys(state.tokens);
      if (tokenAddresses.length === 0) {
        console.log('No tokens being tracked.');
        break;
      }
      
      const allAlerts = [];
      
      for (const addr of tokenAddresses) {
        const tokenState = state.tokens[addr];
        const metrics = await checkToken(addr);
        
        if (metrics.error) continue;
        
        // Get previous data point
        const prevData = tokenState.history?.slice(-1)[0] || null;
        
        // Detect alerts
        const alerts = detectAlerts(metrics, prevData, tokenState, config);
        
        // Update state
        if (metrics.priceUsd > (tokenState.athPrice || 0)) {
          tokenState.athPrice = metrics.priceUsd;
        }
        
        // Keep last 100 data points
        tokenState.history = tokenState.history || [];
        tokenState.history.push(metrics);
        if (tokenState.history.length > 100) {
          tokenState.history = tokenState.history.slice(-100);
        }
        
        // Collect alerts
        for (const alert of alerts) {
          allAlerts.push({
            ...alert,
            token: addr,
            symbol: metrics.symbol,
            timestamp: new Date().toISOString(),
          });
        }
      }
      
      saveState(state);
      
      if (allAlerts.length === 0) {
        console.log('✅ No alerts triggered');
      } else {
        console.log(`🚨 ${allAlerts.length} alert(s):\n`);
        for (const alert of allAlerts) {
          const icon = alert.severity === 'high' ? '🔴' : '🟡';
          console.log(`${icon} [${alert.type}] ${alert.message}`);
        }
        
        // Output JSON for piping to Telegram
        if (process.env.OUTPUT_JSON) {
          console.log('\n---JSON---');
          console.log(JSON.stringify(allAlerts));
        }
      }
      break;
    }
    
    case 'json': {
      // Output current status as JSON (for integrations)
      const tokenAddresses = Object.keys(state.tokens);
      const results = [];
      
      for (const addr of tokenAddresses) {
        const metrics = await checkToken(addr);
        results.push(metrics);
      }
      
      console.log(JSON.stringify(results, null, 2));
      break;
    }
    
    default:
      console.log(`Agent Launch Monitor - Track token performance post-launch

Commands:
  check <address>          One-time token check
  track <address> [name]   Add token to monitoring
  untrack <address>        Remove from monitoring
  status                   Show all tracked tokens
  alerts                   Check for alert conditions (for cron)
  json                     Output status as JSON

Environment:
  ETHERSCAN_API_KEY        For holder counts (optional)
  OUTPUT_JSON=1            Include JSON in alerts output

Examples:
  ./monitor.mjs check 0xf3ce...b07
  ./monitor.mjs track 0xf3ce...b07 "AXIOM"
  ./monitor.mjs alerts
`);
  }
}

main().catch(console.error);
