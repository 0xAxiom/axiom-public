/**
 * Recommender - Risk scoring, action generation, alerts
 */

/**
 * Calculate overall portfolio risk score (0-100, higher = riskier)
 */
function calculateRiskScore(report) {
  let score = 0;
  let factors = [];
  
  // Check LP positions
  const lpPositions = report.positions.filter(p => p.type === 'lp_v3');
  const totalValue = report.portfolio.totalValueUsd;
  
  if (lpPositions.length === 0) {
    // No LP positions = lower risk but also no yield
    factors.push({ factor: 'no_lp', impact: 0, reason: 'No active LP positions' });
  } else {
    // Check each position
    for (const pos of lpPositions) {
      const positionWeight = totalValue > 0 ? pos.valueUsd / totalValue : 0;
      
      // Out of range risk
      if (!pos.health.inRange) {
        const impact = 15 * positionWeight;
        score += impact;
        factors.push({
          factor: 'out_of_range',
          position: pos.tokenId,
          impact,
          reason: `Position #${pos.tokenId} out of range`,
        });
      }
      
      // Impermanent loss risk
      if (pos.health.impermanentLoss !== null && pos.health.impermanentLoss < -5) {
        const ilSeverity = Math.min(Math.abs(pos.health.impermanentLoss) / 20, 1);
        const impact = 25 * ilSeverity * positionWeight;
        score += impact;
        factors.push({
          factor: 'impermanent_loss',
          position: pos.tokenId,
          impact,
          reason: `Position #${pos.tokenId} has ${pos.health.impermanentLoss.toFixed(1)}% IL`,
        });
      }
      
      // Low range utilization risk
      if (pos.health.inRange && pos.health.rangeUtilization < 20) {
        const impact = 10 * positionWeight;
        score += impact;
        factors.push({
          factor: 'narrow_margin',
          position: pos.tokenId,
          impact,
          reason: `Position #${pos.tokenId} near range boundary`,
        });
      }
    }
  }
  
  // Concentration risk (single position > 50% of portfolio)
  for (const pos of report.positions) {
    const concentration = totalValue > 0 ? pos.valueUsd / totalValue : 0;
    if (concentration > 0.5) {
      const impact = 10 * (concentration - 0.5);
      score += impact;
      factors.push({
        factor: 'concentration',
        position: pos.tokenId || pos.token,
        impact,
        reason: `${Math.round(concentration * 100)}% of portfolio in single position`,
      });
    }
  }
  
  // Market volatility (from 24h change)
  const volatility = Math.abs(report.portfolio.change24h);
  if (volatility > 10) {
    const impact = volatility * 0.5;
    score += impact;
    factors.push({
      factor: 'volatility',
      impact,
      reason: `${volatility.toFixed(1)}% 24h price movement`,
    });
  }
  
  return {
    score: Math.min(Math.round(score), 100),
    level: score < 20 ? 'low' : score < 50 ? 'medium' : score < 75 ? 'high' : 'critical',
    factors,
  };
}

/**
 * Generate suggested actions based on portfolio state
 */
function generateActions(report) {
  const actions = [];
  const gasOk = report.gas.percentile <= 60;
  
  // Check for collectible fees
  for (const pos of report.positions) {
    if (pos.type !== 'lp_v3') continue;
    
    if (pos.pendingFees?.totalUsd > 10) {
      const urgency = pos.pendingFees.totalUsd > 100 ? 'high' : 
                      pos.pendingFees.totalUsd > 50 ? 'medium' : 'low';
      
      actions.push({
        action: 'collect_fees',
        position: pos.tokenId,
        reason: `$${pos.pendingFees.totalUsd.toFixed(2)} in uncollected fees`,
        urgency,
        estimatedValue: pos.pendingFees.totalUsd,
        gasOptimal: gasOk,
      });
    }
    
    // Out of range positions
    if (!pos.health.inRange) {
      const urgency = pos.valueUsd > 1000 ? 'high' : 'medium';
      
      actions.push({
        action: 'rebalance',
        position: pos.tokenId,
        reason: 'Position out of range - not earning fees',
        urgency,
        estimatedValue: pos.valueUsd,
        gasOptimal: gasOk,
      });
    }
    
    // High IL positions
    if (pos.health.impermanentLoss !== null && pos.health.impermanentLoss < -15) {
      actions.push({
        action: 'exit',
        position: pos.tokenId,
        reason: `High impermanent loss (${pos.health.impermanentLoss.toFixed(1)}%) - consider exiting`,
        urgency: 'high',
        estimatedValue: pos.valueUsd,
        gasOptimal: gasOk,
      });
    }
    
    // Near range boundary
    if (pos.health.inRange && pos.health.rangeUtilization < 15) {
      actions.push({
        action: 'rebalance',
        position: pos.tokenId,
        reason: 'Position near range boundary - may go out of range soon',
        urgency: 'low',
        estimatedValue: pos.valueUsd,
        gasOptimal: gasOk,
      });
    }
  }
  
  // Check if should wait on all actions due to gas
  if (!gasOk && actions.length > 0) {
    const totalActionValue = actions.reduce((sum, a) => sum + (a.estimatedValue || 0), 0);
    
    // Add wait recommendation if gas is high
    if (report.gas.percentile > 75) {
      actions.unshift({
        action: 'wait',
        reason: `Gas at ${report.gas.percentile}th percentile - wait for better prices`,
        urgency: 'low',
        estimatedSavings: report.gas.estimatedSavings,
      });
    }
  }
  
  // If no actions, suggest compound or wait
  if (actions.length === 0) {
    if (report.portfolio.totalValueUsd > 0) {
      actions.push({
        action: 'wait',
        reason: 'All positions healthy - no action needed',
        urgency: 'low',
      });
    }
  }
  
  // Sort by urgency
  const urgencyOrder = { high: 0, medium: 1, low: 2 };
  actions.sort((a, b) => urgencyOrder[a.urgency] - urgencyOrder[b.urgency]);
  
  return actions;
}

/**
 * Enhance alerts with priority and grouping
 */
function prioritizeAlerts(alerts) {
  const severityOrder = { critical: 0, warning: 1, info: 2 };
  
  return alerts
    .sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity])
    .map((alert, idx) => ({
      ...alert,
      priority: idx + 1,
    }));
}

/**
 * Generate full recommendation report
 */
export function generateRecommendations(report) {
  const risk = calculateRiskScore(report);
  const actions = generateActions(report);
  const prioritizedAlerts = prioritizeAlerts(report.alerts);
  
  return {
    risk,
    actions,
    alerts: prioritizedAlerts,
    summary: generateSummary(report, risk, actions),
  };
}

/**
 * Generate human-readable summary
 */
function generateSummary(report, risk, actions) {
  const lines = [];
  
  // Portfolio value
  lines.push(`Portfolio: $${report.portfolio.totalValueUsd.toFixed(2)}`);
  
  if (report.portfolio.change24h !== 0) {
    const changeSign = report.portfolio.change24h >= 0 ? '+' : '';
    lines.push(`24h Change: ${changeSign}${report.portfolio.change24h.toFixed(2)}%`);
  }
  
  // Risk level
  lines.push(`Risk Level: ${risk.level.toUpperCase()} (${risk.score}/100)`);
  
  // Position count
  const lpCount = report.positions.filter(p => p.type === 'lp_v3').length;
  const tokenCount = report.positions.filter(p => p.type === 'token').length;
  lines.push(`Positions: ${tokenCount} tokens, ${lpCount} LPs`);
  
  // Top action
  if (actions.length > 0 && actions[0].action !== 'wait') {
    lines.push(`Top Action: ${actions[0].action.replace('_', ' ')} - ${actions[0].reason}`);
  }
  
  // Gas status
  lines.push(`Gas: ${report.gas.current} gwei (${report.gas.recommendation.replace('_', ' ')})`);
  
  return lines.join('\n');
}

export default {
  generateRecommendations,
  calculateRiskScore,
  generateActions,
};
