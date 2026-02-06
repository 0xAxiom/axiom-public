import Database from 'better-sqlite3';
import { GasSnapshot, GasPrediction } from './types';

export class GasDatabase {
  private db: Database.Database;

  constructor(dbPath: string = 'gasflow.db') {
    this.db = new Database(dbPath);
    this.initTables();
  }

  private initTables() {
    // Gas snapshots table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS gas_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chain_id INTEGER NOT NULL,
        timestamp INTEGER NOT NULL,
        base_fee TEXT NOT NULL,
        priority_fee TEXT NOT NULL,
        pending_tx_count INTEGER NOT NULL,
        block_number INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Predictions table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS gas_predictions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chain_id INTEGER NOT NULL,
        timestamp INTEGER NOT NULL,
        predicted_15min TEXT NOT NULL,
        confidence_15min REAL NOT NULL,
        predicted_30min TEXT NOT NULL,
        confidence_30min REAL NOT NULL,
        predicted_60min TEXT NOT NULL,
        confidence_60min REAL NOT NULL,
        recommendation TEXT NOT NULL,
        reasoning TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create indexes for better performance
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_gas_snapshots_chain_timestamp 
      ON gas_snapshots(chain_id, timestamp);
    `);

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_gas_predictions_chain_timestamp 
      ON gas_predictions(chain_id, timestamp);
    `);

    console.log('Database tables initialized');
  }

  insertGasSnapshot(snapshot: GasSnapshot) {
    const stmt = this.db.prepare(`
      INSERT INTO gas_snapshots (
        chain_id, timestamp, base_fee, priority_fee, pending_tx_count, block_number
      ) VALUES (?, ?, ?, ?, ?, ?)
    `);

    return stmt.run(
      snapshot.chainId,
      snapshot.timestamp,
      snapshot.baseFee.toString(),
      snapshot.priorityFee.toString(),
      snapshot.pendingTxCount,
      snapshot.blockNumber
    );
  }

  insertPrediction(prediction: GasPrediction) {
    const stmt = this.db.prepare(`
      INSERT INTO gas_predictions (
        chain_id, timestamp, predicted_15min, confidence_15min,
        predicted_30min, confidence_30min, predicted_60min, confidence_60min,
        recommendation, reasoning
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    return stmt.run(
      prediction.chainId,
      prediction.timestamp,
      prediction.predicted15min.fee.toString(),
      prediction.predicted15min.confidence,
      prediction.predicted30min.fee.toString(),
      prediction.predicted30min.confidence,
      prediction.predicted60min.fee.toString(),
      prediction.predicted60min.confidence,
      prediction.recommendation,
      prediction.reasoning
    );
  }

  getRecentSnapshots(chainId: number, hours: number = 24): GasSnapshot[] {
    const cutoff = Date.now() - (hours * 60 * 60 * 1000);
    const stmt = this.db.prepare(`
      SELECT * FROM gas_snapshots 
      WHERE chain_id = ? AND timestamp > ?
      ORDER BY timestamp DESC
    `);

    const rows = stmt.all(chainId, cutoff) as any[];
    return rows.map(row => ({
      chainId: row.chain_id,
      timestamp: row.timestamp,
      baseFee: BigInt(row.base_fee),
      priorityFee: BigInt(row.priority_fee),
      pendingTxCount: row.pending_tx_count,
      blockNumber: row.block_number
    }));
  }

  getLatestSnapshot(chainId: number): GasSnapshot | null {
    const stmt = this.db.prepare(`
      SELECT * FROM gas_snapshots 
      WHERE chain_id = ?
      ORDER BY timestamp DESC
      LIMIT 1
    `);

    const row = stmt.get(chainId) as any;
    if (!row) return null;

    return {
      chainId: row.chain_id,
      timestamp: row.timestamp,
      baseFee: BigInt(row.base_fee),
      priorityFee: BigInt(row.priority_fee),
      pendingTxCount: row.pending_tx_count,
      blockNumber: row.block_number
    };
  }

  getAllLatestSnapshots(): GasSnapshot[] {
    const stmt = this.db.prepare(`
      SELECT gs.* FROM gas_snapshots gs
      INNER JOIN (
        SELECT chain_id, MAX(timestamp) as max_timestamp
        FROM gas_snapshots
        GROUP BY chain_id
      ) latest ON gs.chain_id = latest.chain_id AND gs.timestamp = latest.max_timestamp
    `);

    const rows = stmt.all() as any[];
    return rows.map(row => ({
      chainId: row.chain_id,
      timestamp: row.timestamp,
      baseFee: BigInt(row.base_fee),
      priorityFee: BigInt(row.priority_fee),
      pendingTxCount: row.pending_tx_count,
      blockNumber: row.block_number
    }));
  }

  getLatestPrediction(chainId: number): GasPrediction | null {
    const stmt = this.db.prepare(`
      SELECT * FROM gas_predictions 
      WHERE chain_id = ?
      ORDER BY timestamp DESC
      LIMIT 1
    `);

    const row = stmt.get(chainId) as any;
    if (!row) return null;

    return {
      chainId: row.chain_id,
      timestamp: row.timestamp,
      predicted15min: {
        fee: BigInt(row.predicted_15min),
        confidence: row.confidence_15min
      },
      predicted30min: {
        fee: BigInt(row.predicted_30min),
        confidence: row.confidence_30min
      },
      predicted60min: {
        fee: BigInt(row.predicted_60min),
        confidence: row.confidence_60min
      },
      recommendation: row.recommendation,
      reasoning: row.reasoning
    };
  }

  // Clean old data (keep only 7 days)
  cleanOldData() {
    const cutoff = Date.now() - (7 * 24 * 60 * 60 * 1000);
    
    const snapshots = this.db.prepare('DELETE FROM gas_snapshots WHERE timestamp < ?');
    const predictions = this.db.prepare('DELETE FROM gas_predictions WHERE timestamp < ?');
    
    const snapshotsDeleted = snapshots.run(cutoff);
    const predictionsDeleted = predictions.run(cutoff);
    
    console.log(`Cleaned ${snapshotsDeleted.changes} old snapshots, ${predictionsDeleted.changes} old predictions`);
  }

  close() {
    this.db.close();
  }
}