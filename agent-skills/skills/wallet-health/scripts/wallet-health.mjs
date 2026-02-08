#!/usr/bin/env node
/**
 * wallet-health.mjs
 * 
 * Monitor wallet balances, gas levels, and claimable fees across multiple wallets.
 * Alerts when gas is low or when fees exceed threshold.
 * 
 * Usage:
 *   ./wallet-health.mjs check              # Check all wallets, output summary
 *   ./wallet-health.mjs check --json       # JSON output for programmatic use
 *   ./wallet-health.mjs alerts             # Only show items needing attention
 *   ./wallet-health.mjs alerts --telegram  # Send alerts to Telegram (requires TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID)
 * 
 * Environment:
 *   ETHERSCAN_API_KEY    - Required for balance lookups
 *   BASE_RPC_URL         - Optional, defaults to public RPC
 *   TELEGRAM_BOT_TOKEN   - Optional, for --telegram alerts
 *   TELEGRAM_CHAT_ID     - Optional, for --telegram alerts
 *   WALLET_CONFIG_PATH   - Optional, path to custom wallet config
 */

import { createPublicClient, http, formatEther, formatUnits } from 'viem';
import { base } from 'viem/chains';

// ═══════════════════════════════════════════════════════════════════════════════
// Configuration
// ═══════════════════════════════════════════════════════════════════════════════

const DEFAULT_WALLETS = {
  main: {
    address: '0x523Eff3dB03938eaa31a5a6FBd41E3B9d23edde5',
    label: 'Axiom Main',
    checkGas: true,
    checkClankerFees: true,
    minGasEth: 0.005,  // Alert if below this
  },
  bankr: {
    address: '0x19fe674a83e98c44ad4c2172e006c542b8e8fe08',
    label: 'Bankr Wallet',
    checkGas: true,
    checkClankerFees: false,
    minGasEth: 0.001,
  },
  hardware: {
    address: '0x0D9945F0a591094927df47DB12ACB1081cE9F0F6',
    label: 'MeltedMindz Hardware',
    checkGas: false,
    checkClankerFees: true,
    minGasEth: 0,
  },
};

const CONTRACTS = {
  clankerFeeLocker: '0xF3622742b1E446D92e45E22923Ef11C2fcD55D68',
  weth: '0x4200000000000000000000000000000000000006',
  usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
};

const THRESHOLDS = {
  minClaimableUsd: 10,  // Alert if claimable fees > $10
  wethPriceUsd: 2500,   // Rough WETH price for USD conversion
};

// ═══════════════════════════════════════════════════════════════════════════════
// ABIs
// ═══════════════════════════════════════════════════════════════════════════════

const CLANKER_FEE_LOCKER_ABI = [
  {
    name: 'availableFees',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'feeOwner', type: 'address' },
      { name: 'token', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
];

const ERC20_ABI = [
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'decimals',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint8' }],
  },
];

// ═══════════════════════════════════════════════════════════════════════════════
// Client Setup
// ═══════════════════════════════════════════════════════════════════════════════

const rpcUrl = process.env.BASE_RPC_URL || 'https://mainnet.base.org';
const client = createPublicClient({
  chain: base,
  transport: http(rpcUrl),
});

// ═══════════════════════════════════════════════════════════════════════════════
// Core Functions
// ═══════════════════════════════════════════════════════════════════════════════

async function getEthBalance(address) {
  const balance = await client.getBalance({ address });
  return parseFloat(formatEther(balance));
}

async function getTokenBalance(tokenAddress, walletAddress) {
  const balance = await client.readContract({
    address: tokenAddress,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [walletAddress],
  });
  
  const decimals = await client.readContract({
    address: tokenAddress,
    abi: ERC20_ABI,
    functionName: 'decimals',
  });
  
  return parseFloat(formatUnits(balance, decimals));
}

async function getClankerPendingFees(ownerAddress) {
  const wethFees = await client.readContract({
    address: CONTRACTS.clankerFeeLocker,
    abi: CLANKER_FEE_LOCKER_ABI,
    functionName: 'availableFees',
    args: [ownerAddress, CONTRACTS.weth],
  });
  
  return parseFloat(formatEther(wethFees));
}

async function checkWallet(walletId, config) {
  const result = {
    id: walletId,
    label: config.label,
    address: config.address,
    ethBalance: 0,
    usdcBalance: 0,
    clankerFeesWeth: 0,
    alerts: [],
  };

  try {
    // Get ETH balance
    result.ethBalance = await getEthBalance(config.address);
    
    // Check gas threshold
    if (config.checkGas && result.ethBalance < config.minGasEth) {
      result.alerts.push({
        type: 'low_gas',
        message: `Low gas: ${result.ethBalance.toFixed(6)} ETH (min: ${config.minGasEth})`,
        severity: 'warning',
      });
    }

    // Get USDC balance
    result.usdcBalance = await getTokenBalance(CONTRACTS.usdc, config.address);

    // Check Clanker fees
    if (config.checkClankerFees) {
      result.clankerFeesWeth = await getClankerPendingFees(config.address);
      const feesUsd = result.clankerFeesWeth * THRESHOLDS.wethPriceUsd;
      
      if (feesUsd >= THRESHOLDS.minClaimableUsd) {
        result.alerts.push({
          type: 'claimable_fees',
          message: `Claimable: ${result.clankerFeesWeth.toFixed(6)} WETH (~$${feesUsd.toFixed(2)})`,
          severity: 'info',
        });
      }
    }
  } catch (error) {
    result.alerts.push({
      type: 'error',
      message: `Failed to check: ${error.message}`,
      severity: 'error',
    });
  }

  return result;
}

async function checkAllWallets() {
  const results = [];
  
  for (const [walletId, config] of Object.entries(DEFAULT_WALLETS)) {
    const result = await checkWallet(walletId, config);
    results.push(result);
  }
  
  return results;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Output Formatting
// ═══════════════════════════════════════════════════════════════════════════════

function formatSummary(results) {
  const lines = ['📊 Wallet Health Summary', '═'.repeat(40)];
  
  let totalEth = 0;
  let totalUsdc = 0;
  let totalPendingWeth = 0;
  
  for (const wallet of results) {
    totalEth += wallet.ethBalance;
    totalUsdc += wallet.usdcBalance;
    totalPendingWeth += wallet.clankerFeesWeth;
    
    lines.push('');
    lines.push(`🏷️  ${wallet.label}`);
    lines.push(`    ${wallet.address.slice(0, 10)}...${wallet.address.slice(-8)}`);
    lines.push(`    ETH: ${wallet.ethBalance.toFixed(6)}`);
    lines.push(`    USDC: $${wallet.usdcBalance.toFixed(2)}`);
    
    if (wallet.clankerFeesWeth > 0) {
      lines.push(`    Pending Clanker: ${wallet.clankerFeesWeth.toFixed(6)} WETH`);
    }
    
    for (const alert of wallet.alerts) {
      const icon = alert.severity === 'warning' ? '⚠️' : alert.severity === 'error' ? '❌' : 'ℹ️';
      lines.push(`    ${icon} ${alert.message}`);
    }
  }
  
  lines.push('');
  lines.push('═'.repeat(40));
  lines.push(`💰 Totals:`);
  lines.push(`   ETH: ${totalEth.toFixed(6)} (~$${(totalEth * THRESHOLDS.wethPriceUsd).toFixed(2)})`);
  lines.push(`   USDC: $${totalUsdc.toFixed(2)}`);
  lines.push(`   Pending Fees: ${totalPendingWeth.toFixed(6)} WETH (~$${(totalPendingWeth * THRESHOLDS.wethPriceUsd).toFixed(2)})`);
  
  return lines.join('\n');
}

function formatAlerts(results) {
  const allAlerts = [];
  
  for (const wallet of results) {
    for (const alert of wallet.alerts) {
      allAlerts.push({
        wallet: wallet.label,
        ...alert,
      });
    }
  }
  
  if (allAlerts.length === 0) {
    return '✅ All wallets healthy. No alerts.';
  }
  
  const lines = ['🚨 Wallet Alerts', '═'.repeat(40)];
  
  for (const alert of allAlerts) {
    const icon = alert.severity === 'warning' ? '⚠️' : alert.severity === 'error' ? '❌' : 'ℹ️';
    lines.push(`${icon} [${alert.wallet}] ${alert.message}`);
  }
  
  return lines.join('\n');
}

async function sendTelegramAlert(message) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  
  if (!botToken || !chatId) {
    console.error('Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID');
    return false;
  }
  
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: 'HTML',
      }),
    });
    
    return response.ok;
  } catch (error) {
    console.error('Failed to send Telegram alert:', error.message);
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// CLI
// ═══════════════════════════════════════════════════════════════════════════════

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'check';
  const flags = args.slice(1);
  
  const jsonOutput = flags.includes('--json');
  const telegramOutput = flags.includes('--telegram');
  
  const results = await checkAllWallets();
  
  switch (command) {
    case 'check':
      if (jsonOutput) {
        console.log(JSON.stringify(results, null, 2));
      } else {
        console.log(formatSummary(results));
      }
      break;
      
    case 'alerts':
      const alertText = formatAlerts(results);
      
      if (jsonOutput) {
        const alerts = results.flatMap(r => r.alerts.map(a => ({ wallet: r.label, ...a })));
        console.log(JSON.stringify(alerts, null, 2));
      } else {
        console.log(alertText);
      }
      
      if (telegramOutput) {
        const hasAlerts = results.some(r => r.alerts.length > 0);
        if (hasAlerts) {
          await sendTelegramAlert(alertText);
          console.log('\n📤 Sent to Telegram');
        }
      }
      break;
      
    default:
      console.log(`
Wallet Health Monitor

Commands:
  check              Check all wallets, output summary
  check --json       JSON output for programmatic use
  alerts             Only show items needing attention  
  alerts --telegram  Send alerts to Telegram

Environment:
  ETHERSCAN_API_KEY  Required for balance lookups
  BASE_RPC_URL       Optional, defaults to public RPC
`);
  }
}

main().catch(console.error);
