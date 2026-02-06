// Delta Math Validation - Validate fee calculations use correct patterns

export async function validateDeltaMath(solidityCode) {
  const results = {
    errors: [],
    warnings: [],
    suggestions: []
  };

  try {
    // Check for correct amountSpecified usage in fee calculations
    validateAmountSpecifiedUsage(solidityCode, results);
    
    // Check delta sign conventions
    validateDeltaSignConventions(solidityCode, results);
    
    // Check fee calculation patterns
    validateFeeCalculationPatterns(solidityCode, results);
    
    // Check delta construction patterns
    validateDeltaConstruction(solidityCode, results);
    
    // Check for common V4 math mistakes
    validateV4MathPatterns(solidityCode, results);

    return results;
  } catch (error) {
    results.errors.push({
      type: 'delta_math_validation_error',
      message: `Delta math validation failed: ${error.message}`,
      severity: 'error'
    });
    return results;
  }
}

function validateAmountSpecifiedUsage(code, results) {
  // V4 Critical: Fee base must be amountSpecified, not BalanceDelta
  const beforeSwapMatch = code.match(/function\s+beforeSwap[^{]*\{([^}]*)\}/s);
  if (!beforeSwapMatch) return;
  
  const beforeSwapBody = beforeSwapMatch[1];
  
  // Check for incorrect fee calculation using BalanceDelta
  const badFeePatterns = [
    /fee\s*=.*?BalanceDelta/i,
    /fee\s*=.*?delta\./i,
    /\*\s*feeRate.*?BalanceDelta/i
  ];
  
  for (const pattern of badFeePatterns) {
    if (pattern.test(beforeSwapBody)) {
      results.errors.push({
        type: 'incorrect_fee_base',
        message: 'Fee calculation should use params.amountSpecified, not BalanceDelta',
        detail: 'V4 convention: amountSpecified is the user input, BalanceDelta is the result',
        severity: 'error'
      });
      break;
    }
  }
  
  // Check for correct amountSpecified usage
  if (beforeSwapBody.includes('amountSpecified') && beforeSwapBody.includes('fee')) {
    // Look for correct pattern: abs(amountSpecified) * feeRate / 10000
    const correctPatterns = [
      /abs\s*\(\s*.*?amountSpecified.*?\)\s*\*.*?feeRate/,
      /uint256\s*\(\s*-?\s*.*?amountSpecified.*?\)\s*\*.*?feeRate/,
      /amountSpecified\s*<\s*0\s*\?.*?-.*?amountSpecified/
    ];
    
    const hasCorrectPattern = correctPatterns.some(pattern => pattern.test(beforeSwapBody));
    if (!hasCorrectPattern) {
      results.warnings.push({
        type: 'fee_calculation_pattern',
        message: 'Fee calculation should handle negative amountSpecified correctly',
        detail: 'Use abs(amountSpecified) or check if amountSpecified < 0 for exact input',
        severity: 'warning'
      });
    }
  }
  
  // Check for amountSpecified sign awareness
  if (beforeSwapBody.includes('amountSpecified') && !beforeSwapBody.includes('< 0')) {
    const hasSignCheck = /exactInput|zeroForOne.*amountSpecified|amountSpecified.*negative/.test(beforeSwapBody);
    if (!hasSignCheck) {
      results.suggestions.push({
        type: 'amount_specified_sign',
        message: 'Consider checking amountSpecified sign for exact input vs exact output',
        detail: 'amountSpecified < 0 indicates exact input (user sends tokens)',
        severity: 'suggestion'
      });
    }
  }
}

function validateDeltaSignConventions(code, results) {
  // Check for correct delta sign usage
  const deltaPatterns = [
    {
      pattern: /toBeforeSwapDelta\s*\(\s*([^,)]+)/,
      message: 'Check BeforeSwapDelta sign: positive = hook takes tokens, negative = hook gives tokens'
    },
    {
      pattern: /return\s*\([^,)]*,\s*([^,)]*delta[^,)]*),/i,
      message: 'Verify delta return value sign matches intended token flow'
    }
  ];
  
  for (const {pattern, message} of deltaPatterns) {
    const matches = code.match(pattern);
    if (matches) {
      const deltaExpr = matches[1].trim();
      
      // Check if delta expression involves fee (should be positive when hook takes fee)
      if (deltaExpr.includes('fee') && deltaExpr.includes('-')) {
        results.warnings.push({
          type: 'delta_sign_warning',
          message: 'Negative delta when taking fees may be incorrect',
          detail: 'Hook taking fees should typically use positive delta values',
          severity: 'warning'
        });
      }
    }
  }
}

function validateFeeCalculationPatterns(code, results) {
  // Check for proper fee calculation patterns
  const feePatterns = {
    basisPoints: {
      pattern: /fee.*?(\d+)\s*\/\s*10000/,
      message: 'Basis points calculation detected - ensure rate is in basis points'
    },
    percentage: {
      pattern: /fee.*?(\d+)\s*\/\s*100(?!\d)/,
      message: 'Percentage division by 100 - consider if basis points (10000) is intended'
    },
    overflow: {
      pattern: /fee\s*=\s*.*?\*.*?\*.*?\/(?!\s*10000)/,
      message: 'Multiple multiplications in fee calculation - check for overflow'
    }
  };
  
  for (const [type, {pattern, message}] of Object.entries(feePatterns)) {
    if (pattern.test(code)) {
      if (type === 'percentage') {
        results.warnings.push({
          type: 'fee_calculation_unit',
          message,
          detail: 'DeFi convention typically uses basis points (1 basis point = 0.01%)',
          severity: 'warning'
        });
      } else if (type === 'overflow') {
        results.suggestions.push({
          type: 'overflow_risk',
          message,
          detail: 'Consider using SafeMath or checking for intermediate overflow',
          severity: 'suggestion'
        });
      }
    }
  }
  
  // Check for fee rate bounds checking
  if (code.includes('feeRate') && !code.includes('> 10000')) {
    results.suggestions.push({
      type: 'fee_rate_bounds',
      message: 'Consider adding bounds check for feeRate (e.g., <= 10000 for 100% max)',
      detail: 'Prevents accidentally setting fees above 100%',
      severity: 'suggestion'
    });
  }
}

function validateDeltaConstruction(code, results) {
  // Check BeforeSwapDelta construction patterns
  if (code.includes('toBeforeSwapDelta')) {
    // Check for proper currency ordering in delta construction
    const deltaConstructions = code.matchAll(/toBeforeSwapDelta\s*\(\s*([^,)]+)\s*,\s*([^,)]+)\s*\)/g);
    
    for (const match of deltaConstructions) {
      const [, currency0Delta, currency1Delta] = match;
      
      // Check if zeroForOne logic is properly handled
      const contextBefore = code.substring(Math.max(0, match.index - 500), match.index);
      const hasZeroForOneLogic = /zeroForOne|params\.zeroForOne/.test(contextBefore);
      
      if (!hasZeroForOneLogic && !currency0Delta.includes('0') && !currency1Delta.includes('0')) {
        results.warnings.push({
          type: 'delta_currency_logic',
          message: 'BeforeSwapDelta construction should consider zeroForOne parameter',
          detail: 'Use params.zeroForOne to determine which currency delta applies to',
          severity: 'warning'
        });
      }
    }
  }
  
  // Check for ZERO_DELTA usage
  if (!code.includes('ZERO_DELTA') && code.includes('toBeforeSwapDelta')) {
    results.suggestions.push({
      type: 'zero_delta_usage',
      message: 'Consider using BeforeSwapDeltaLibrary.ZERO_DELTA for no-op cases',
      detail: 'More explicit than manually constructing zero deltas',
      severity: 'suggestion'
    });
  }
}

function validateV4MathPatterns(code, results) {
  // Check for SafeCast usage with deltas
  if (code.includes('int128') && !code.includes('SafeCast')) {
    const hasIntCasting = /toInt128\(\)|int128\s*\(/g.test(code);
    if (hasIntCasting) {
      results.suggestions.push({
        type: 'safe_cast_suggestion',
        message: 'Consider using SafeCast for int128 conversions',
        detail: 'SafeCast prevents silent overflow in type conversions',
        severity: 'suggestion'
      });
    }
  }
  
  // Check for FullMath usage in price calculations
  if ((code.includes('price') || code.includes('sqrt')) && code.includes('*') && !code.includes('FullMath')) {
    results.suggestions.push({
      type: 'full_math_suggestion',
      message: 'Consider using FullMath for price/sqrt calculations',
      detail: 'FullMath handles intermediate overflow in multiplication/division',
      severity: 'suggestion'
    });
  }
  
  // Check for proper precision handling
  const precisionPatterns = [
    {
      pattern: /\/\s*1e18/,
      message: 'Division by 1e18 - ensure precision is handled correctly'
    },
    {
      pattern: /\*\s*1e18/,
      message: 'Multiplication by 1e18 - check for overflow'
    }
  ];
  
  for (const {pattern, message} of precisionPatterns) {
    if (pattern.test(code)) {
      results.suggestions.push({
        type: 'precision_handling',
        message,
        detail: 'Fixed-point arithmetic requires careful precision management',
        severity: 'suggestion'
      });
    }
  }
  
  // Check for tick math usage
  if (code.includes('tick') && !code.includes('TickMath')) {
    const hasTickCalculations = /tick\s*[+\-*/]|getSqrtRatioAtTick/.test(code);
    if (hasTickCalculations) {
      results.suggestions.push({
        type: 'tick_math_library',
        message: 'Consider using TickMath library for tick calculations',
        detail: 'TickMath provides safe tick-to-price conversions',
        severity: 'suggestion'
      });
    }
  }
}