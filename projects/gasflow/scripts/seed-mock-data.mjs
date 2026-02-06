#!/usr/bin/env node
/**
 * Seed GasFlow database with realistic mock data for screenshots
 */

import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const db = new Database(join(__dirname, '..', 'gasflow.db'));

// Chains config
const CHAINS = {
  1: { name: 'Ethereum', baseGwei: 0.5, volatility: 0.3 },
  8453: { name: 'Base', baseGwei: 0.004, volatility: 0.2 },
  42161: { name: 'Arbitrum', baseGwei: 0.02, volatility: 0.25 },
  137: { name: 'Polygon', baseGwei: 350, volatility: 0.15 },
  10: { name: 'Optimism', baseGwei: 0.00005, volatility: 0.2 }
};

// Convert gwei to wei (bigint string)
function gweiToWei(gwei) {
  return BigInt(Math.floor(gwei * 1e9)).toString();
}

// Generate realistic gas with some variance
function generateGas(baseGwei, volatility) {
  const variance = (Math.random() - 0.5) * 2 * volatility;
  return baseGwei * (1 + variance);
}

// Clear existing data
db.exec('DELETE FROM gas_snapshots');
db.exec('DELETE FROM gas_predictions');

console.log('🗑️  Cleared existing data');

// Insert mock snapshots for last 2 hours (every 5 seconds = 1440 records per chain)
const now = Date.now();
const twoHoursAgo = now - (2 * 60 * 60 * 1000);
const insertStmt = db.prepare(`
  INSERT INTO gas_snapshots (chain_id, timestamp, base_fee, priority_fee, pending_tx_count, block_number)
  VALUES (?, ?, ?, ?, ?, ?)
`);

let recordCount = 0;
const transaction = db.transaction(() => {
  for (const [chainId, config] of Object.entries(CHAINS)) {
    let blockNumber = chainId === '1' ? 24378600 : 
                      chainId === '8453' ? 41680000 :
                      chainId === '42161' ? 428300000 :
                      chainId === '137' ? 82514000 : 147275000;
    
    // Create a trend - gas was higher earlier, now lower (good for "wait" recommendation)
    const trendFactor = (t) => 1 + 0.3 * ((twoHoursAgo + t) - now) / (2 * 60 * 60 * 1000);
    
    for (let t = 0; t < 2 * 60 * 60 * 1000; t += 30000) { // Every 30 seconds
      const timestamp = twoHoursAgo + t;
      const baseFee = generateGas(config.baseGwei * trendFactor(t), config.volatility);
      const priorityFee = baseFee * 0.1 * Math.random();
      const pendingTx = Math.floor(Math.random() * 500) + 50;
      
      insertStmt.run(
        parseInt(chainId),
        timestamp,
        gweiToWei(baseFee),
        gweiToWei(priorityFee),
        pendingTx,
        blockNumber++
      );
      recordCount++;
    }
  }
});

transaction();
console.log(`✅ Inserted ${recordCount} gas snapshots`);

// Insert predictions
const predictionStmt = db.prepare(`
  INSERT INTO gas_predictions (chain_id, timestamp, predicted_15min, confidence_15min, predicted_30min, confidence_30min, predicted_60min, confidence_60min, recommendation, reasoning)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const predTransaction = db.transaction(() => {
  for (const [chainId, config] of Object.entries(CHAINS)) {
    const currentGas = config.baseGwei;
    
    // Predictions show gas going down - good time to wait
    const pred15 = currentGas * 0.9;
    const pred30 = currentGas * 0.85;
    const pred60 = currentGas * 0.8;
    
    predictionStmt.run(
      parseInt(chainId),
      now,
      gweiToWei(pred15),
      0.85,  // confidence_15min
      gweiToWei(pred30),
      0.78,  // confidence_30min
      gweiToWei(pred60),
      0.72,  // confidence_60min
      'wait',
      `Gas trending down. Expected ${Math.round((1 - 0.8) * 100)}% savings in 60 minutes.`
    );
  }
});

predTransaction();
console.log('✅ Inserted predictions for all chains');

db.close();
console.log('\n🎉 Mock data seeded successfully!');
console.log('Run: npm run dev (in dashboard/) to see the UI');
