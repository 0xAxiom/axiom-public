import { GasSnapshot, GasPrediction } from './types';
import { GasDatabase } from './database';

export class GasPredictor {
  private db: GasDatabase;

  constructor(db: GasDatabase) {
    this.db = db;
  }

  // Calculate moving average for a time window
  private calculateMovingAverage(snapshots: GasSnapshot[], windowSize: number): bigint {
    if (snapshots.length === 0) return 0n;

    const recent = snapshots.slice(-windowSize);
    const sum = recent.reduce((acc, snapshot) => acc + snapshot.baseFee + snapshot.priorityFee, 0n);
    return sum / BigInt(recent.length);
  }

  // Calculate trend direction (-1, 0, 1)
  private calculateTrend(snapshots: GasSnapshot[]): number {
    if (snapshots.length < 10) return 0;

    const recent = snapshots.slice(-10);
    const older = snapshots.slice(-20, -10);

    if (older.length === 0) return 0;

    const recentAvg = this.calculateMovingAverage(recent, recent.length);
    const olderAvg = this.calculateMovingAverage(older, older.length);

    const change = Number(recentAvg - olderAvg) / Number(olderAvg);

    if (change > 0.05) return 1; // Upward trend
    if (change < -0.05) return -1; // Downward trend
    return 0; // Stable
  }

  // Calculate volatility (standard deviation)
  private calculateVolatility(snapshots: GasSnapshot[]): number {
    if (snapshots.length < 2) return 0;

    const fees = snapshots.map(s => Number(s.baseFee + s.priorityFee));
    const mean = fees.reduce((a, b) => a + b, 0) / fees.length;
    const variance = fees.reduce((acc, fee) => acc + Math.pow(fee - mean, 2), 0) / fees.length;
    return Math.sqrt(variance);
  }

  // Detect if we're in a "rush hour" pattern
  private isRushHour(): boolean {
    const hour = new Date().getUTCHours();
    // Peak usage hours: 14-16 UTC (6-8am PT), 21-23 UTC (1-3pm PT)
    return (hour >= 14 && hour <= 16) || (hour >= 21 && hour <= 23);
  }

  // Generate prediction for a specific time horizon
  private generateTimeHorizonPrediction(
    currentFee: bigint,
    trend: number,
    volatility: number,
    minutes: number
  ): { fee: bigint; confidence: number } {
    let prediction = currentFee;
    let confidence = 0.8; // Base confidence

    // Apply trend projection
    const trendFactor = 1 + (trend * 0.02 * (minutes / 15)); // 2% change per 15min for strong trend
    prediction = BigInt(Math.round(Number(prediction) * trendFactor));

    // Adjust for volatility
    const volatilityFactor = Math.min(volatility / 1e9, 0.5); // Cap volatility impact
    confidence *= (1 - volatilityFactor);

    // Rush hour adjustments
    if (this.isRushHour() && trend >= 0) {
      prediction = BigInt(Math.round(Number(prediction) * 1.1)); // 10% higher in rush hour
      confidence *= 0.9;
    }

    // Confidence decreases with time horizon
    confidence *= Math.exp(-minutes / 60); // Exponential decay

    return {
      fee: prediction,
      confidence: Math.max(confidence, 0.1) // Minimum 10% confidence
    };
  }

  // Generate recommendation based on current conditions
  private generateRecommendation(
    currentFee: bigint,
    trend: number,
    predictions: {
      predicted15min: { fee: bigint; confidence: number };
      predicted30min: { fee: bigint; confidence: number };
      predicted60min: { fee: bigint; confidence: number };
    }
  ): { recommendation: 'wait' | 'execute_now' | 'urgent'; reasoning: string } {
    const current = Number(currentFee);
    const pred15 = Number(predictions.predicted15min.fee);
    const pred30 = Number(predictions.predicted30min.fee);

    // Calculate expected savings by waiting
    const savings15 = (current - pred15) / current;
    const savings30 = (current - pred30) / current;

    // High confidence drop expected
    if (savings15 > 0.1 && predictions.predicted15min.confidence > 0.6) {
      return {
        recommendation: 'wait',
        reasoning: `Gas expected to drop ${(savings15 * 100).toFixed(1)}% in 15 minutes`
      };
    }

    // Moderate savings with good confidence
    if (savings30 > 0.05 && predictions.predicted30min.confidence > 0.5) {
      return {
        recommendation: 'wait',
        reasoning: `Gas may drop ${(savings30 * 100).toFixed(1)}% in 30 minutes`
      };
    }

    // Strong upward trend - execute now
    if (trend > 0 && pred15 > current * 1.05) {
      return {
        recommendation: 'urgent',
        reasoning: 'Gas rising quickly, execute immediately'
      };
    }

    // Rush hour with upward trend
    if (this.isRushHour() && trend >= 0) {
      return {
        recommendation: 'execute_now',
        reasoning: 'Peak hours - gas unlikely to improve soon'
      };
    }

    // Default: current gas is reasonable
    return {
      recommendation: 'execute_now',
      reasoning: 'Current gas prices are reasonable'
    };
  }

  async generatePrediction(chainId: number): Promise<GasPrediction | null> {
    // Get historical data
    const snapshots = this.db.getRecentSnapshots(chainId, 24);
    if (snapshots.length < 5) {
      console.log(`Insufficient data for prediction on chain ${chainId}`);
      return null;
    }

    // Get latest snapshot
    const latest = snapshots[0]; // Most recent
    const currentFee = latest.baseFee + latest.priorityFee;

    // Calculate metrics
    const trend = this.calculateTrend(snapshots);
    const volatility = this.calculateVolatility(snapshots.slice(-60)); // Last 5 hours

    // Generate predictions for different time horizons
    const predicted15min = this.generateTimeHorizonPrediction(currentFee, trend, volatility, 15);
    const predicted30min = this.generateTimeHorizonPrediction(currentFee, trend, volatility, 30);
    const predicted60min = this.generateTimeHorizonPrediction(currentFee, trend, volatility, 60);

    // Generate recommendation
    const { recommendation, reasoning } = this.generateRecommendation(
      currentFee,
      trend,
      { predicted15min, predicted30min, predicted60min }
    );

    const prediction: GasPrediction = {
      chainId,
      timestamp: Date.now(),
      predicted15min,
      predicted30min,
      predicted60min,
      recommendation,
      reasoning
    };

    // Store prediction in database
    this.db.insertPrediction(prediction);

    console.log(`[Chain ${chainId}] Prediction: ${reasoning}`);

    return prediction;
  }

  async generateAllPredictions(): Promise<GasPrediction[]> {
    const chainIds = [8453, 42161, 137, 10]; // Base, Arbitrum, Polygon, Optimism
    const predictions: GasPrediction[] = [];

    for (const chainId of chainIds) {
      try {
        const prediction = await this.generatePrediction(chainId);
        if (prediction) {
          predictions.push(prediction);
        }
      } catch (error) {
        console.error(`Error generating prediction for chain ${chainId}:`, error);
      }
    }

    return predictions;
  }

  // Get summary of all chain conditions
  async getMarketSummary(): Promise<{
    totalChains: number;
    cheapestChain: number | null;
    mostExpensiveChain: number | null;
    averageGas: number;
    trendsUp: number;
    trendsDown: number;
  }> {
    const snapshots = this.db.getAllLatestSnapshots();
    
    if (snapshots.length === 0) {
      return {
        totalChains: 0,
        cheapestChain: null,
        mostExpensiveChain: null,
        averageGas: 0,
        trendsUp: 0,
        trendsDown: 0
      };
    }

    // Find cheapest and most expensive
    let cheapest = snapshots[0];
    let mostExpensive = snapshots[0];
    let totalGas = 0n;
    let trendsUp = 0;
    let trendsDown = 0;

    for (const snapshot of snapshots) {
      const totalFee = snapshot.baseFee + snapshot.priorityFee;
      
      if (totalFee < (cheapest.baseFee + cheapest.priorityFee)) {
        cheapest = snapshot;
      }
      if (totalFee > (mostExpensive.baseFee + mostExpensive.priorityFee)) {
        mostExpensive = snapshot;
      }
      
      totalGas += totalFee;

      // Check trend for this chain
      const recentSnapshots = this.db.getRecentSnapshots(snapshot.chainId, 2);
      const trend = this.calculateTrend(recentSnapshots);
      if (trend > 0) trendsUp++;
      if (trend < 0) trendsDown++;
    }

    const averageGas = Number(totalGas / BigInt(snapshots.length));

    return {
      totalChains: snapshots.length,
      cheapestChain: cheapest.chainId,
      mostExpensiveChain: mostExpensive.chainId,
      averageGas,
      trendsUp,
      trendsDown
    };
  }
}