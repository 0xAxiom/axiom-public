/**
 * Risk Analyzer
 * 
 * Scores each package 0-100 on risk factors:
 * - Last publish age (25%)
 * - Maintainer count (20%)
 * - Depth in tree (15%)
 * - Downloads (15%)
 * - Size (10%)
 * - Deprecated (10%)
 * - License (5%)
 */

// Known copyleft licenses
const COPYLEFT_LICENSES = new Set([
  'GPL-2.0', 'GPL-3.0', 'AGPL-3.0', 'LGPL-2.1', 'LGPL-3.0',
  'GPL-2.0-only', 'GPL-3.0-only', 'AGPL-3.0-only',
  'GPL-2.0-or-later', 'GPL-3.0-or-later', 'AGPL-3.0-or-later',
  'LGPL-2.1-only', 'LGPL-3.0-only', 'LGPL-2.1-or-later', 'LGPL-3.0-or-later',
  'MPL-2.0', 'EUPL-1.1', 'EUPL-1.2', 'CPAL-1.0', 'OSL-3.0',
  'SSPL-1.0', 'BUSL-1.1',
]);

// Known permissive licenses
const PERMISSIVE_LICENSES = new Set([
  'MIT', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause', 'Apache-2.0',
  'Unlicense', '0BSD', 'CC0-1.0', 'Zlib', 'Artistic-2.0',
  'BlueOak-1.0.0', 'CC-BY-4.0',
]);

/**
 * Score: Last publish age (25% weight)
 * >2yr=80, >1yr=50, >6mo=20, else 0
 */
function scorePublishAge(lastPublish) {
  if (!lastPublish) return 60; // Unknown = moderate risk

  const ageMs = Date.now() - new Date(lastPublish).getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);

  if (ageDays > 730) return 80;  // >2 years
  if (ageDays > 365) return 50;  // >1 year
  if (ageDays > 180) return 20;  // >6 months
  return 0;
}

/**
 * Score: Maintainer count (20% weight)
 * 1=80, 2=50, 3-5=20, 5+=0
 */
function scoreMaintainerCount(count) {
  if (!count || count === 0) return 80; // Unknown or zero = high risk
  if (count === 1) return 80;
  if (count === 2) return 50;
  if (count <= 5) return 20;
  return 0;
}

/**
 * Score: Depth in dependency tree (15% weight)
 * depth*12, capped at 100
 */
function scoreDepth(depth) {
  return Math.min(depth * 12, 100);
}

/**
 * Score: Weekly downloads (15% weight)
 * <1000=80, <10000=50, <100000=20, else 0
 */
function scoreDownloads(downloads) {
  if (downloads < 0) return 40; // Unknown = moderate
  if (downloads < 1000) return 80;
  if (downloads < 10000) return 50;
  if (downloads < 100000) return 20;
  return 0;
}

/**
 * Score: Package size (10% weight)
 * >1MB=80, >500KB=50, >100KB=20, else 0
 */
function scoreSize(unpackedSize) {
  if (!unpackedSize) return 10; // Unknown = low risk
  if (unpackedSize > 1048576) return 80;   // >1MB
  if (unpackedSize > 524288) return 50;    // >500KB
  if (unpackedSize > 102400) return 20;    // >100KB
  return 0;
}

/**
 * Score: Deprecated status (10% weight)
 * deprecated=100, else 0
 */
function scoreDeprecated(deprecated) {
  return deprecated ? 100 : 0;
}

/**
 * Score: License risk (5% weight)
 * none=80, copyleft=50, permissive=0
 */
function scoreLicense(license) {
  if (!license || license === 'UNKNOWN' || license === 'NONE') return 80;
  
  const upper = license.toUpperCase();
  
  // Check for permissive first
  for (const perm of PERMISSIVE_LICENSES) {
    if (upper === perm.toUpperCase()) return 0;
  }
  
  // Check copyleft
  for (const copy of COPYLEFT_LICENSES) {
    if (upper === copy.toUpperCase()) return 50;
  }
  
  // Unknown license type — mild risk
  return 20;
}

/**
 * Calculate weighted risk score for a single package node.
 * Returns 0-100.
 */
function calculateRiskScore(node) {
  const metadata = node.metadata || {};
  
  const factors = {
    publishAge: { score: scorePublishAge(metadata.lastPublish), weight: 0.25 },
    maintainerCount: { score: scoreMaintainerCount(metadata.maintainers), weight: 0.20 },
    depth: { score: scoreDepth(node.depth || 0), weight: 0.15 },
    downloads: { score: scoreDownloads(node.downloads || -1), weight: 0.15 },
    size: { score: scoreSize(metadata.unpackedSize), weight: 0.10 },
    deprecated: { score: scoreDeprecated(metadata.deprecated), weight: 0.10 },
    license: { score: scoreLicense(metadata.license), weight: 0.05 },
  };

  let totalScore = 0;
  for (const factor of Object.values(factors)) {
    totalScore += factor.score * factor.weight;
  }

  return {
    score: Math.round(totalScore),
    factors,
  };
}

/**
 * Get risk level label from score.
 */
function getRiskLevel(score) {
  if (score <= 25) return 'low';
  if (score <= 50) return 'medium';
  if (score <= 75) return 'high';
  return 'critical';
}

/**
 * Get risk color for a level.
 */
function getRiskColor(level) {
  switch (level) {
    case 'low': return '#22c55e';
    case 'medium': return '#eab308';
    case 'high': return '#f97316';
    case 'critical': return '#ef4444';
    default: return '#666666';
  }
}

/**
 * Annotate an entire dependency tree with risk scores.
 * Mutates the tree nodes in-place and returns the tree.
 */
function analyzeTree(tree) {
  function walk(node) {
    const { score, factors } = calculateRiskScore(node);
    
    node.riskScore = score;
    node.riskLevel = getRiskLevel(score);
    node.riskColor = getRiskColor(node.riskLevel);
    node.riskFactors = factors;

    // Recurse into children
    if (node.dependencies && node.dependencies.length > 0) {
      for (const child of node.dependencies) {
        walk(child);
      }
    }

    return node;
  }

  return walk(tree);
}

/**
 * Generate a risk summary for the entire tree.
 * Returns top-N riskiest packages and aggregate stats.
 */
function generateRiskReport(tree) {
  const allPackages = [];

  function collect(node) {
    allPackages.push({
      name: node.name,
      version: node.version,
      riskScore: node.riskScore,
      riskLevel: node.riskLevel,
      riskFactors: node.riskFactors,
      depth: node.depth,
      deprecated: node.metadata?.deprecated || false,
    });

    for (const child of (node.dependencies || [])) {
      collect(child);
    }
  }

  collect(tree);

  // Sort by risk score descending
  allPackages.sort((a, b) => b.riskScore - a.riskScore);

  // Compute distribution
  const distribution = { low: 0, medium: 0, high: 0, critical: 0 };
  let totalRisk = 0;
  
  for (const pkg of allPackages) {
    distribution[pkg.riskLevel]++;
    totalRisk += pkg.riskScore;
  }

  const avgRisk = allPackages.length > 0 ? Math.round(totalRisk / allPackages.length) : 0;

  return {
    totalPackages: allPackages.length,
    averageRisk: avgRisk,
    overallLevel: getRiskLevel(avgRisk),
    distribution,
    topRisks: allPackages.slice(0, 10),
    deprecated: allPackages.filter(p => p.deprecated),
    allPackages,
  };
}

module.exports = {
  analyzeTree,
  generateRiskReport,
  calculateRiskScore,
  getRiskLevel,
  getRiskColor,
  // Exposed for testing
  scorePublishAge,
  scoreMaintainerCount,
  scoreDepth,
  scoreDownloads,
  scoreSize,
  scoreDeprecated,
  scoreLicense,
};
