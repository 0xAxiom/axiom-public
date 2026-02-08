#!/usr/bin/env node
/**
 * LP Range Alert - Monitor V4 positions and alert on status changes
 * 
 * Usage:
 *   node lp-range-alert.mjs --positions 1078751,1078720,1078695
 *   node lp-range-alert.mjs --config positions.json
 *   node lp-range-alert.mjs --positions 1078751 --telegram-chat 2104116566
 *   node lp-range-alert.mjs --positions 1078751 --dry-run
 * 
 * Config file format (positions.json):
 * {
 *   "positions": [1078751, 1078720, 1078695],
 *   "telegramChat": "2104116566",
 *   "alertThresholds": {
 *     "nearEdgePercent": 15,
 *     "ilWarningPercent": 10
 *   }
 * }
 * 
 * State is persisted to ~/.lp-alert-state.json to avoid duplicate alerts.
 * 
 * @author Axiom (@AxiomBot)
 */

import { createPublicClient, http, keccak256, encodeAbiParameters, parseAbiParameters, formatEther } from 'viem';
import { base } from 'viem/chains';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const STATE_FILE = join(homedir(), '.lp-alert-state.json');

const argv = yargs(hideBin(process.argv))
  .option('positions', { type: 'string', description: 'Comma-separated token IDs to monitor' })
  .option('config', { type: 'string', description: 'JSON config file path' })
  .option('telegram-chat', { type: 'string', description: 'Telegram chat ID for alerts' })
  .option('near-edge-pct', { type: 'number', default: 15, description: 'Alert when position within X% of edge' })
  .option('dry-run', { type: 'boolean', default: false, description: 'Check without sending alerts' })
  .option('json', { type: 'boolean', default: false, description: 'JSON output' })
  .option('force', { type: 'boolean', default: false, description: 'Force alert even if status unchanged' })
  .option('rpc', { type: 'string', description: 'Custom RPC URL' })
  .parse();

// Contracts
const CONTRACTS = {
  POSITION_MANAGER: '0x7c5f5a4bbd8fd63184577525326123b519429bdc',
  STATE_VIEW: '0xa3c0c9b65bad0b08107aa264b0f3db444b867a71',
  WETH: '0x4200000000000000000000000000000000000006',
};

// Token names for better alerts
const TOKEN_NAMES = {
  '0x4200000000000000000000000000000000000006': 'WETH',
  '0xf3ce5ddaab6c133f9875a4a46c55cf0b58111b07': 'AXIOM',
};

const rpcUrl = argv.rpc || process.env.BASE_RPC_URL || 'https://mainnet.base.org';
const publicClient = createPublicClient({
  chain: base,
  transport: http(rpcUrl),
  batch: {
    multicall: true, // Batch calls to reduce RPC requests
  },
});

// Decode int24 from uint24
const toInt24 = (val) => val > 0x7FFFFF ? val - 0x1000000 : val;

// Load saved state
function loadState() {
  try {
    if (existsSync(STATE_FILE)) {
      return JSON.parse(readFileSync(STATE_FILE, 'utf-8'));
    }
  } catch (e) {
    console.error('Warning: Could not load state file:', e.message);
  }
  return { positions: {}, lastCheck: null };
}

// Save state
function saveState(state) {
  try {
    writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch (e) {
    console.error('Warning: Could not save state file:', e.message);
  }
}

// Check a single position
async function checkPosition(tokenId) {
  const id = BigInt(tokenId);
  
  // Get pool key and position info
  const [poolKey, posInfo] = await publicClient.readContract({
    address: CONTRACTS.POSITION_MANAGER,
    abi: [{
      name: 'getPoolAndPositionInfo',
      type: 'function',
      inputs: [{ type: 'uint256' }],
      outputs: [
        { type: 'tuple', components: [
          { name: 'currency0', type: 'address' },
          { name: 'currency1', type: 'address' },
          { name: 'fee', type: 'uint24' },
          { name: 'tickSpacing', type: 'int24' },
          { name: 'hooks', type: 'address' }
        ]},
        { type: 'uint256' }
      ]
    }],
    functionName: 'getPoolAndPositionInfo',
    args: [id],
  });

  // Decode position ticks
  const tickLowerRaw = Number((posInfo >> 8n) & 0xFFFFFFn);
  const tickUpperRaw = Number((posInfo >> 32n) & 0xFFFFFFn);
  const tickLower = toInt24(tickLowerRaw);
  const tickUpper = toInt24(tickUpperRaw);

  // Get pool ID
  const poolId = keccak256(encodeAbiParameters(
    parseAbiParameters('address, address, uint24, int24, address'),
    [poolKey.currency0, poolKey.currency1, poolKey.fee, poolKey.tickSpacing, poolKey.hooks]
  ));

  // Get current pool state
  const [sqrtPriceX96, currentTick] = await publicClient.readContract({
    address: CONTRACTS.STATE_VIEW,
    abi: [{ 
      name: 'getSlot0', 
      type: 'function', 
      inputs: [{ name: 'poolId', type: 'bytes32' }], 
      outputs: [
        { name: 'sqrtPriceX96', type: 'uint160' }, 
        { name: 'tick', type: 'int24' }, 
        { name: 'protocolFee', type: 'uint24' }, 
        { name: 'lpFee', type: 'uint24' }
      ] 
    }],
    functionName: 'getSlot0',
    args: [poolId],
  });

  // Get liquidity
  const liquidity = await publicClient.readContract({
    address: CONTRACTS.POSITION_MANAGER,
    abi: [{ name: 'getPositionLiquidity', type: 'function', inputs: [{ type: 'uint256' }], outputs: [{ type: 'uint128' }] }],
    functionName: 'getPositionLiquidity',
    args: [id],
  });

  // Calculate metrics
  const inRange = currentTick >= tickLower && currentTick < tickUpper;
  const rangeWidth = tickUpper - tickLower;
  const distanceToLower = currentTick - tickLower;
  const distanceToUpper = tickUpper - currentTick;
  const positionPercent = ((currentTick - tickLower) / rangeWidth * 100);
  
  // Calculate price
  const Q96 = 2n ** 96n;
  const sqrtPrice = Number(sqrtPriceX96) / Number(Q96);
  const price = sqrtPrice ** 2;
  
  // Get token names
  const token0Name = TOKEN_NAMES[poolKey.currency0.toLowerCase()] || poolKey.currency0.slice(0, 8);
  const token1Name = TOKEN_NAMES[poolKey.currency1.toLowerCase()] || poolKey.currency1.slice(0, 8);

  // Determine status
  let status = 'OK';
  let alert = null;
  
  if (!inRange) {
    status = 'OUT_OF_RANGE';
    alert = currentTick < tickLower ? 'BELOW_RANGE' : 'ABOVE_RANGE';
  } else {
    const nearEdgeThreshold = argv.nearEdgePct / 100;
    if (positionPercent < nearEdgeThreshold * 100) {
      status = 'NEAR_LOWER_EDGE';
      alert = 'APPROACHING_LOWER';
    } else if (positionPercent > (1 - nearEdgeThreshold) * 100) {
      status = 'NEAR_UPPER_EDGE';
      alert = 'APPROACHING_UPPER';
    }
  }

  return {
    tokenId: tokenId.toString(),
    pool: `${token0Name}/${token1Name}`,
    inRange,
    status,
    alert,
    currentTick: Number(currentTick),
    tickLower,
    tickUpper,
    positionPercent: positionPercent.toFixed(1),
    distanceToLower,
    distanceToUpper,
    rangeWidth,
    price: price.toExponential(4),
    liquidity: liquidity.toString(),
    hasLiquidity: liquidity > 0n,
  };
}

// Format alert message for Telegram
function formatAlertMessage(position, previousStatus) {
  const emoji = {
    'OUT_OF_RANGE': '🚨',
    'NEAR_LOWER_EDGE': '⚠️',
    'NEAR_UPPER_EDGE': '⚠️',
    'OK': '✅',
  };

  const statusEmoji = emoji[position.status] || '📊';
  const changeNote = previousStatus && previousStatus !== position.status
    ? ` (was: ${previousStatus})`
    : '';

  let message = `${statusEmoji} **LP Position #${position.tokenId}**${changeNote}\n`;
  message += `Pool: ${position.pool}\n`;
  message += `Status: ${position.status}\n`;
  message += `Range coverage: ${position.positionPercent}%\n`;
  message += `Current tick: ${position.currentTick}\n`;
  message += `Range: [${position.tickLower}, ${position.tickUpper}]\n`;

  if (!position.inRange) {
    message += `\n⚠️ **Position is OUT OF RANGE** — not earning fees!\n`;
    if (position.alert === 'BELOW_RANGE') {
      message += `Price dropped below your range. Consider rebalancing lower.`;
    } else {
      message += `Price rose above your range. Consider rebalancing higher.`;
    }
  } else if (position.status.includes('NEAR')) {
    const edge = position.status.includes('LOWER') ? 'lower' : 'upper';
    message += `\n⚠️ Price approaching ${edge} edge of range. Monitor closely.`;
  }

  return message;
}

// Send Telegram alert (if chat ID provided)
async function sendTelegramAlert(message, chatId) {
  if (!chatId) {
    console.log('[Alert would be sent]:', message);
    return false;
  }

  // Use Moltbot's message tool via stdout instruction
  // In practice, this script would be called by Moltbot which handles the alert
  console.log(`TELEGRAM_ALERT:${chatId}:${message}`);
  return true;
}

async function main() {
  // Load config
  let config = {
    positions: [],
    telegramChat: argv.telegramChat,
    nearEdgePercent: argv.nearEdgePct,
  };

  if (argv.config) {
    try {
      const fileConfig = JSON.parse(readFileSync(argv.config, 'utf-8'));
      config = { ...config, ...fileConfig };
    } catch (e) {
      console.error('Error loading config:', e.message);
      process.exit(1);
    }
  }

  if (argv.positions) {
    config.positions = argv.positions.split(',').map(p => p.trim());
  }

  if (!config.positions || config.positions.length === 0) {
    console.error('No positions specified. Use --positions or --config');
    process.exit(1);
  }

  // Load previous state
  const state = loadState();
  const results = [];
  const alerts = [];

  // Check each position
  for (const tokenId of config.positions) {
    try {
      const position = await checkPosition(tokenId);
      const previousStatus = state.positions[tokenId]?.status;
      
      results.push(position);

      // Determine if we should alert
      const statusChanged = previousStatus !== position.status;
      const shouldAlert = argv.force || statusChanged;
      const isProblematic = position.status !== 'OK';

      if (shouldAlert && isProblematic) {
        alerts.push({
          position,
          previousStatus,
          message: formatAlertMessage(position, previousStatus),
        });
      }

      // Update state
      state.positions[tokenId] = {
        status: position.status,
        positionPercent: position.positionPercent,
        currentTick: position.currentTick,
        lastCheck: new Date().toISOString(),
      };

    } catch (e) {
      console.error(`Error checking position ${tokenId}:`, e.message);
      results.push({
        tokenId: tokenId.toString(),
        error: e.message,
        status: 'ERROR',
      });
    }
  }

  // Save state
  state.lastCheck = new Date().toISOString();
  if (!argv.dryRun) {
    saveState(state);
  }

  // Output results
  if (argv.json) {
    console.log(JSON.stringify({ results, alerts, state }, null, 2));
  } else {
    console.log('\n📊 LP Range Alert Check\n');
    console.log(`Positions checked: ${results.length}`);
    console.log(`Alerts triggered: ${alerts.length}\n`);

    for (const result of results) {
      if (result.error) {
        console.log(`❌ Position #${result.tokenId}: ${result.error}`);
        continue;
      }

      const emoji = result.status === 'OK' ? '✅' : result.inRange ? '⚠️' : '🚨';
      console.log(`${emoji} Position #${result.tokenId} (${result.pool})`);
      console.log(`   Status: ${result.status}`);
      console.log(`   Range: ${result.positionPercent}% (tick ${result.currentTick})`);
      console.log(`   Bounds: [${result.tickLower}, ${result.tickUpper}]`);
      if (!result.hasLiquidity) {
        console.log(`   ⚠️ No liquidity (withdrawn)`);
      }
      console.log();
    }

    if (alerts.length > 0) {
      console.log('--- ALERTS ---\n');
      for (const alert of alerts) {
        console.log(alert.message);
        console.log();
        
        if (!argv.dryRun && config.telegramChat) {
          // In real usage, Moltbot would pick up the TELEGRAM_ALERT output
          await sendTelegramAlert(alert.message, config.telegramChat);
        }
      }
    }
  }

  // Exit with error code if any positions are out of range
  const hasOutOfRange = results.some(r => r.status === 'OUT_OF_RANGE');
  process.exit(hasOutOfRange ? 1 : 0);
}

main().catch(e => {
  console.error('Fatal error:', e.message);
  process.exit(1);
});
