// Flag Validation - Ensure hook flags match implemented callbacks

export async function validateHookFlags(solidityCode) {
  const results = {
    errors: [],
    warnings: [],
    suggestions: []
  };

  try {
    const implementedCallbacks = extractImplementedCallbacks(solidityCode);
    const declaredFlags = extractHookFlags(solidityCode);
    
    // Check for missing flags
    const requiredFlags = getRequiredFlags(implementedCallbacks);
    for (const flag of requiredFlags) {
      if (!declaredFlags.includes(flag)) {
        results.errors.push({
          type: 'missing_flag',
          message: `Missing required flag: ${flag}`,
          detail: `Callback ${getCallbackForFlag(flag)} is implemented but flag is not set`,
          severity: 'error'
        });
      }
    }
    
    // Check for unnecessary flags  
    for (const flag of declaredFlags) {
      const requiredCallback = getCallbackForFlag(flag);
      if (!implementedCallbacks.includes(requiredCallback)) {
        results.warnings.push({
          type: 'unnecessary_flag',
          message: `Unnecessary flag: ${flag}`,
          detail: `Flag is set but callback ${requiredCallback} is not implemented`,
          severity: 'warning'
        });
      }
    }
    
    // Check for critical V4 flag patterns
    validateCriticalFlagPatterns(solidityCode, implementedCallbacks, declaredFlags, results);
    
    return results;
  } catch (error) {
    results.errors.push({
      type: 'flag_validation_error',
      message: `Flag validation failed: ${error.message}`,
      severity: 'error'
    });
    return results;
  }
}

function extractImplementedCallbacks(code) {
  const callbacks = [];
  const callbackPatterns = {
    beforeInitialize: /function\s+beforeInitialize\s*\(/,
    afterInitialize: /function\s+afterInitialize\s*\(/,
    beforeAddLiquidity: /function\s+beforeAddLiquidity\s*\(/,
    afterAddLiquidity: /function\s+afterAddLiquidity\s*\(/,
    beforeRemoveLiquidity: /function\s+beforeRemoveLiquidity\s*\(/,
    afterRemoveLiquidity: /function\s+afterRemoveLiquidity\s*\(/,
    beforeSwap: /function\s+beforeSwap\s*\(/,
    afterSwap: /function\s+afterSwap\s*\(/,
    beforeDonate: /function\s+beforeDonate\s*\(/,
    afterDonate: /function\s+afterDonate\s*\(/
  };
  
  for (const [callback, pattern] of Object.entries(callbackPatterns)) {
    if (pattern.test(code)) {
      callbacks.push(callback);
    }
  }
  
  return callbacks;
}

function extractHookFlags(code) {
  const flags = [];
  
  // Extract flags from getHookPermissions function
  const permissionsMatch = code.match(/function\s+getHookPermissions.*?{([\s\S]*?)}/);
  if (!permissionsMatch) {
    return flags;
  }
  
  const permissionsBody = permissionsMatch[1];
  
  const flagPatterns = {
    beforeInitialize: /beforeInitialize:\s*true/,
    afterInitialize: /afterInitialize:\s*true/,
    beforeAddLiquidity: /beforeAddLiquidity:\s*true/,
    afterAddLiquidity: /afterAddLiquidity:\s*true/,
    beforeRemoveLiquidity: /beforeRemoveLiquidity:\s*true/,
    afterRemoveLiquidity: /afterRemoveLiquidity:\s*true/,
    beforeSwap: /beforeSwap:\s*true/,
    afterSwap: /afterSwap:\s*true/,
    beforeDonate: /beforeDonate:\s*true/,
    afterDonate: /afterDonate:\s*true/,
    beforeSwapReturnDelta: /beforeSwapReturnDelta:\s*true/,
    afterSwapReturnDelta: /afterSwapReturnDelta:\s*true/,
    afterAddLiquidityReturnDelta: /afterAddLiquidityReturnDelta:\s*true/,
    afterRemoveLiquidityReturnDelta: /afterRemoveLiquidityReturnDelta:\s*true/
  };
  
  for (const [flag, pattern] of Object.entries(flagPatterns)) {
    if (pattern.test(permissionsBody)) {
      flags.push(flag);
    }
  }
  
  return flags;
}

function getRequiredFlags(implementedCallbacks) {
  const flags = [];
  
  // Basic callback flags
  const callbackToFlag = {
    beforeInitialize: 'beforeInitialize',
    afterInitialize: 'afterInitialize',
    beforeAddLiquidity: 'beforeAddLiquidity',
    afterAddLiquidity: 'afterAddLiquidity',
    beforeRemoveLiquidity: 'beforeRemoveLiquidity',
    afterRemoveLiquidity: 'afterRemoveLiquidity',
    beforeSwap: 'beforeSwap',
    afterSwap: 'afterSwap',
    beforeDonate: 'beforeDonate',
    afterDonate: 'afterDonate'
  };
  
  for (const callback of implementedCallbacks) {
    if (callbackToFlag[callback]) {
      flags.push(callbackToFlag[callback]);
    }
  }
  
  return flags;
}

function getCallbackForFlag(flag) {
  const flagToCallback = {
    beforeInitialize: 'beforeInitialize',
    afterInitialize: 'afterInitialize',
    beforeAddLiquidity: 'beforeAddLiquidity',
    afterAddLiquidity: 'afterAddLiquidity',
    beforeRemoveLiquidity: 'beforeRemoveLiquidity',
    afterRemoveLiquidity: 'afterRemoveLiquidity',
    beforeSwap: 'beforeSwap',
    afterSwap: 'afterSwap',
    beforeDonate: 'beforeDonate',
    afterDonate: 'afterDonate',
    beforeSwapReturnDelta: 'beforeSwap',
    afterSwapReturnDelta: 'afterSwap',
    afterAddLiquidityReturnDelta: 'afterAddLiquidity',
    afterRemoveLiquidityReturnDelta: 'afterRemoveLiquidity'
  };
  
  return flagToCallback[flag] || 'unknown';
}

function validateCriticalFlagPatterns(code, callbacks, flags, results) {
  // Critical V4 Pattern: beforeSwap + delta return requires beforeSwapReturnDelta flag
  if (callbacks.includes('beforeSwap')) {
    const returnsNonZeroDelta = checkBeforeSwapReturnsDelta(code);
    const hasDeltaFlag = flags.includes('beforeSwapReturnDelta');
    
    if (returnsNonZeroDelta && !hasDeltaFlag) {
      results.errors.push({
        type: 'missing_delta_flag',
        message: 'beforeSwapReturnDelta flag required when beforeSwap returns non-zero delta',
        detail: 'V4 requires this flag when beforeSwap modifies token balances',
        severity: 'error'
      });
    }
    
    if (!returnsNonZeroDelta && hasDeltaFlag) {
      results.warnings.push({
        type: 'unnecessary_delta_flag',
        message: 'beforeSwapReturnDelta flag set but beforeSwap returns ZERO_DELTA',
        detail: 'Consider removing flag if no delta modification is needed',
        severity: 'warning'
      });
    }
  }
  
  // Similar pattern for afterSwap
  if (callbacks.includes('afterSwap')) {
    const returnsNonZeroValue = checkAfterSwapReturnsValue(code);
    const hasDeltaFlag = flags.includes('afterSwapReturnDelta');
    
    if (returnsNonZeroValue && !hasDeltaFlag) {
      results.errors.push({
        type: 'missing_after_delta_flag',
        message: 'afterSwapReturnDelta flag required when afterSwap returns non-zero value',
        detail: 'V4 requires this flag when afterSwap modifies token balances',
        severity: 'error'
      });
    }
  }
}

function checkBeforeSwapReturnsDelta(code) {
  // Look for beforeSwap function and check if it returns non-zero delta
  const beforeSwapMatch = code.match(/function\s+beforeSwap\s*\([^)]*\)[^{]*{([\s\S]*?)(?=^\s*function|\s*$)/m);
  if (!beforeSwapMatch) return false;
  
  const beforeSwapBody = beforeSwapMatch[1];
  
  // Check for patterns that indicate delta return
  const deltaPatterns = [
    /toBeforeSwapDelta\s*\(\s*[^,)]+[^0][^,)]*\s*,/, // Non-zero first argument
    /toBeforeSwapDelta\s*\([^,)]*,\s*[^,)]+[^0][^)]*\s*\)/, // Non-zero second argument
    /BeforeSwapDelta\s+hookDelta\s*=.*?(?!ZERO_DELTA)/, // Non-ZERO_DELTA assignment
    /take\s*\(.*?\)/, // Hook takes tokens
    /settle\s*\(.*?\)/ // Hook settles tokens
  ];
  
  return deltaPatterns.some(pattern => pattern.test(beforeSwapBody));
}

function checkAfterSwapReturnsValue(code) {
  const afterSwapMatch = code.match(/function\s+afterSwap\s*\([^)]*\)[^{]*{([\s\S]*?)(?=^\s*function|\s*$)/m);
  if (!afterSwapMatch) return false;
  
  const afterSwapBody = afterSwapMatch[1];
  
  // Check for non-zero return values
  const nonZeroPatterns = [
    /return\s*\([^,)]*,\s*[^0][^)]*\s*\)/, // Non-zero second return value
    /return\s*\([^,)]*,\s*[^,)]+\s*\)/     // Any expression in second position
  ];
  
  return nonZeroPatterns.some(pattern => pattern.test(afterSwapBody));
}