// Validation Pipeline - Main validator that runs all checks

import { validateHookFlags } from './flags.mjs';
import { validateInterfaces } from './interfaces.mjs';
import { validateDeltaMath } from './delta-math.mjs';
import { checkKnownPitfalls } from './pitfalls.mjs';
import { estimateGas } from './gas.mjs';

export async function validateHook(solidityCode) {
  const results = {
    errors: [],
    warnings: [],
    suggestions: [],
    gasEstimate: { total: 0, perCallback: {} },
    score: 0,
    passed: false
  };

  try {
    // Run all validation checks in parallel for performance
    const [
      flagResults,
      interfaceResults, 
      deltaMathResults,
      pitfallResults,
      gasResults
    ] = await Promise.all([
      validateHookFlags(solidityCode),
      validateInterfaces(solidityCode),
      validateDeltaMath(solidityCode),
      checkKnownPitfalls(solidityCode),
      estimateGas(solidityCode)
    ]);

    // Aggregate results
    results.errors = [
      ...flagResults.errors,
      ...interfaceResults.errors,
      ...deltaMathResults.errors,
      ...pitfallResults.errors,
      ...gasResults.errors
    ];

    results.warnings = [
      ...flagResults.warnings,
      ...interfaceResults.warnings,
      ...deltaMathResults.warnings,
      ...pitfallResults.warnings,
      ...gasResults.warnings
    ];

    results.suggestions = [
      ...flagResults.suggestions,
      ...interfaceResults.suggestions,
      ...deltaMathResults.suggestions,
      ...pitfallResults.suggestions,
      ...gasResults.suggestions
    ];

    results.gasEstimate = gasResults.gasEstimate;

    // Calculate quality score (0-100)
    results.score = calculateQualityScore(results);
    results.passed = results.errors.length === 0 && results.score >= 70;

    return results;
  } catch (error) {
    results.errors.push({
      type: 'validation_error',
      message: `Validation pipeline failed: ${error.message}`,
      severity: 'error'
    });
    return results;
  }
}

function calculateQualityScore(results) {
  let score = 100;
  
  // Deduct points for issues
  score -= results.errors.length * 20;      // Major issues
  score -= results.warnings.length * 10;    // Medium issues
  score -= Math.min(results.suggestions.length * 2, 20); // Minor issues (capped)
  
  // Gas efficiency bonus/penalty
  if (results.gasEstimate.total > 0) {
    if (results.gasEstimate.total < 50000) {
      score += 5; // Efficient gas usage
    } else if (results.gasEstimate.total > 200000) {
      score -= 10; // Excessive gas usage
    }
  }
  
  return Math.max(0, Math.min(100, score));
}

export { validateHookFlags, validateInterfaces, validateDeltaMath, checkKnownPitfalls, estimateGas };