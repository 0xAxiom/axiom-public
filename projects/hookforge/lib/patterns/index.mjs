// Pattern Registry - Central hub for all hook patterns

import feeOnSwap from './fee-on-swap.mjs';
import accessControl from './access-control.mjs';
import dynamicFee from './dynamic-fee.mjs';
import twapOracle from './twap-oracle.mjs';
import feeSplit from './fee-split.mjs';

// Pattern registry
const patterns = new Map([
  [feeOnSwap.id, feeOnSwap],
  [accessControl.id, accessControl],
  [dynamicFee.id, dynamicFee],
  [twapOracle.id, twapOracle],
  [feeSplit.id, feeSplit]
]);

export default {
  // Get all patterns as array
  async getAllPatterns() {
    return Array.from(patterns.values());
  },

  // Get specific pattern by ID
  async getPattern(id) {
    return patterns.get(id);
  },

  // Get patterns by callback
  async getPatternsByCallback(callback) {
    return Array.from(patterns.values())
      .filter(pattern => pattern.callbacks.includes(callback));
  },

  // Get patterns by complexity level
  async getPatternsByComplexity(maxComplexity) {
    return Array.from(patterns.values())
      .filter(pattern => pattern.complexity <= maxComplexity);
  },

  // Get pattern metadata only
  async getPatternMetadata() {
    return Array.from(patterns.values()).map(pattern => ({
      id: pattern.id,
      name: pattern.name,
      description: pattern.description,
      complexity: pattern.complexity,
      callbacks: pattern.callbacks,
      flags: pattern.flags,
      gasEstimate: pattern.gasEstimate
    }));
  }
};

export { patterns };