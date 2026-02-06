// Interface Validation - Check function signatures match IBaseHook

const REQUIRED_HOOK_SIGNATURES = {
  getHookPermissions: {
    signature: 'function getHookPermissions() public pure override returns (Hooks.Permissions memory)',
    required: true
  },
  beforeInitialize: {
    signature: 'function beforeInitialize(address, PoolKey calldata, uint160, bytes calldata) external override returns (bytes4)',
    required: false
  },
  afterInitialize: {
    signature: 'function afterInitialize(address, PoolKey calldata, uint160, int24, bytes calldata) external override returns (bytes4)',
    required: false
  },
  beforeAddLiquidity: {
    signature: 'function beforeAddLiquidity(address, PoolKey calldata, IPoolManager.ModifyLiquidityParams calldata, bytes calldata) external override returns (bytes4)',
    required: false
  },
  afterAddLiquidity: {
    signature: 'function afterAddLiquidity(address, PoolKey calldata, IPoolManager.ModifyLiquidityParams calldata, BalanceDelta, bytes calldata) external override returns (bytes4, BalanceDelta)',
    required: false
  },
  beforeRemoveLiquidity: {
    signature: 'function beforeRemoveLiquidity(address, PoolKey calldata, IPoolManager.ModifyLiquidityParams calldata, bytes calldata) external override returns (bytes4)',
    required: false
  },
  afterRemoveLiquidity: {
    signature: 'function afterRemoveLiquidity(address, PoolKey calldata, IPoolManager.ModifyLiquidityParams calldata, BalanceDelta, bytes calldata) external override returns (bytes4, BalanceDelta)',
    required: false
  },
  beforeSwap: {
    signature: 'function beforeSwap(address, PoolKey calldata, IPoolManager.SwapParams calldata, bytes calldata) external override returns (bytes4, BeforeSwapDelta, uint24)',
    required: false
  },
  afterSwap: {
    signature: 'function afterSwap(address, PoolKey calldata, IPoolManager.SwapParams calldata, BalanceDelta, bytes calldata) external override returns (bytes4, int128)',
    required: false
  },
  beforeDonate: {
    signature: 'function beforeDonate(address, PoolKey calldata, uint256, uint256, bytes calldata) external override returns (bytes4)',
    required: false
  },
  afterDonate: {
    signature: 'function afterDonate(address, PoolKey calldata, uint256, uint256, bytes calldata) external override returns (bytes4)',
    required: false
  }
};

export async function validateInterfaces(solidityCode) {
  const results = {
    errors: [],
    warnings: [],
    suggestions: []
  };

  try {
    // Check if contract extends BaseHook
    if (!extendsBaseHook(solidityCode)) {
      results.errors.push({
        type: 'missing_base_contract',
        message: 'Contract must extend BaseHook',
        detail: 'Use "contract YourHook is BaseHook" pattern',
        severity: 'error'
      });
    }

    // Validate each implemented function
    const implementedFunctions = extractFunctionSignatures(solidityCode);
    
    for (const [funcName, funcInfo] of Object.entries(REQUIRED_HOOK_SIGNATURES)) {
      const implemented = implementedFunctions[funcName];
      
      if (funcInfo.required && !implemented) {
        results.errors.push({
          type: 'missing_required_function',
          message: `Missing required function: ${funcName}`,
          detail: `Expected signature: ${funcInfo.signature}`,
          severity: 'error'
        });
        continue;
      }
      
      if (implemented) {
        const signatureErrors = validateFunctionSignature(funcName, implemented, funcInfo.signature);
        results.errors.push(...signatureErrors);
      }
    }

    // Check for proper override modifiers
    validateOverrideModifiers(solidityCode, results);
    
    // Check for proper visibility modifiers
    validateVisibilityModifiers(solidityCode, results);
    
    // Check for proper return types and patterns
    validateReturnPatterns(solidityCode, results);

    return results;
  } catch (error) {
    results.errors.push({
      type: 'interface_validation_error',
      message: `Interface validation failed: ${error.message}`,
      severity: 'error'
    });
    return results;
  }
}

function extendsBaseHook(code) {
  return /contract\s+\w+\s+is\s+BaseHook/.test(code);
}

function extractFunctionSignatures(code) {
  const functions = {};
  
  // More flexible regex to capture function signatures
  const functionRegex = /function\s+(\w+)\s*\([^)]*\)[^{]*(?=\{)/g;
  let match;
  
  while ((match = functionRegex.exec(code)) !== null) {
    const funcName = match[1];
    const fullMatch = match[0];
    functions[funcName] = {
      signature: fullMatch,
      full: match[0]
    };
  }
  
  return functions;
}

function validateFunctionSignature(funcName, implemented, expected) {
  const errors = [];
  
  // Normalize signatures for comparison (remove extra whitespace)
  const normalizeSignature = (sig) => {
    return sig.replace(/\s+/g, ' ')
              .replace(/\(\s+/g, '(')
              .replace(/\s+\)/g, ')')
              .replace(/,\s+/g, ', ')
              .trim();
  };
  
  const normalizedImplemented = normalizeSignature(implemented.signature);
  const normalizedExpected = normalizeSignature(expected);
  
  // Extract key components for more detailed validation
  const paramMismatch = checkParameterMismatch(funcName, normalizedImplemented, normalizedExpected);
  if (paramMismatch) {
    errors.push({
      type: 'signature_mismatch',
      message: `Function signature mismatch for ${funcName}`,
      detail: `Expected: ${normalizedExpected}\nFound: ${normalizedImplemented}`,
      severity: 'error'
    });
  }
  
  // Check for common V4 hook signature mistakes
  validateV4SpecificSignatures(funcName, implemented.signature, errors);
  
  return errors;
}

function checkParameterMismatch(funcName, implemented, expected) {
  // Extract parameter lists
  const extractParams = (sig) => {
    const match = sig.match(/\(([^)]*)\)/);
    return match ? match[1].split(',').map(p => p.trim()) : [];
  };
  
  const implParams = extractParams(implemented);
  const expParams = extractParams(expected);
  
  if (implParams.length !== expParams.length) {
    return true;
  }
  
  // For hooks, parameter order and types are critical
  for (let i = 0; i < implParams.length; i++) {
    const implParam = implParams[i].replace(/\s+/g, ' ').trim();
    const expParam = expParams[i].replace(/\s+/g, ' ').trim();
    
    // Allow parameter name differences but require type matching
    const implType = implParam.split(' ')[0];
    const expType = expParam.split(' ')[0];
    
    if (implType !== expType) {
      return true;
    }
  }
  
  return false;
}

function validateV4SpecificSignatures(funcName, signature, errors) {
  const v4Patterns = {
    beforeSwap: {
      returnType: /returns\s*\(\s*bytes4\s*,\s*BeforeSwapDelta\s*,\s*uint24\s*\)/,
      error: 'beforeSwap must return (bytes4, BeforeSwapDelta, uint24)'
    },
    afterSwap: {
      returnType: /returns\s*\(\s*bytes4\s*,\s*int128\s*\)/,
      error: 'afterSwap must return (bytes4, int128)'
    },
    getHookPermissions: {
      returnType: /returns\s*\(\s*Hooks\.Permissions\s+memory\s*\)/,
      error: 'getHookPermissions must return (Hooks.Permissions memory)'
    }
  };
  
  const pattern = v4Patterns[funcName];
  if (pattern && !pattern.returnType.test(signature)) {
    errors.push({
      type: 'v4_signature_error',
      message: `V4 signature error in ${funcName}`,
      detail: pattern.error,
      severity: 'error'
    });
  }
}

function validateOverrideModifiers(code, results) {
  // Extract all hook functions and check for override modifiers
  const hookFunctions = Object.keys(REQUIRED_HOOK_SIGNATURES);
  
  for (const funcName of hookFunctions) {
    const funcRegex = new RegExp(`function\\s+${funcName}\\s*\\([^)]*\\)[^{]*`, 'g');
    const match = funcRegex.exec(code);
    
    if (match && !match[0].includes('override')) {
      results.warnings.push({
        type: 'missing_override',
        message: `Function ${funcName} should have override modifier`,
        detail: 'V4 hooks must override base contract functions',
        severity: 'warning'
      });
    }
  }
}

function validateVisibilityModifiers(code, results) {
  // Check that hook functions are external
  const externalPattern = /function\s+(\w+)\s*\([^)]*\)\s+external/g;
  const publicPattern = /function\s+(\w+)\s*\([^)]*\)\s+public/g;
  
  let match;
  const externalFunctions = new Set();
  const publicFunctions = new Set();
  
  while ((match = externalPattern.exec(code)) !== null) {
    externalFunctions.add(match[1]);
  }
  
  while ((match = publicPattern.exec(code)) !== null) {
    publicFunctions.add(match[1]);
  }
  
  // Hook callback functions should be external
  const callbackFunctions = ['beforeInitialize', 'afterInitialize', 'beforeAddLiquidity', 
    'afterAddLiquidity', 'beforeRemoveLiquidity', 'afterRemoveLiquidity', 
    'beforeSwap', 'afterSwap', 'beforeDonate', 'afterDonate'];
  
  for (const funcName of callbackFunctions) {
    if (publicFunctions.has(funcName) && !externalFunctions.has(funcName)) {
      results.suggestions.push({
        type: 'visibility_suggestion',
        message: `Consider making ${funcName} external instead of public`,
        detail: 'External functions use slightly less gas than public functions',
        severity: 'suggestion'
      });
    }
  }
  
  // getHookPermissions should be public pure
  if (externalFunctions.has('getHookPermissions')) {
    results.suggestions.push({
      type: 'visibility_suggestion',
      message: 'getHookPermissions should be public pure, not external',
      detail: 'This function may be called internally and should be public',
      severity: 'suggestion'
    });
  }
}

function validateReturnPatterns(code, results) {
  // Check for proper return patterns in hook functions
  const checkBeforeSwapReturn = (code) => {
    const beforeSwapMatch = code.match(/function\s+beforeSwap[^{]*\{([^}]*)\}/s);
    if (beforeSwapMatch) {
      const body = beforeSwapMatch[1];
      if (!body.includes('BaseHook.beforeSwap.selector')) {
        results.warnings.push({
          type: 'missing_selector',
          message: 'beforeSwap should return BaseHook.beforeSwap.selector',
          detail: 'First return value should be BaseHook.beforeSwap.selector',
          severity: 'warning'
        });
      }
    }
  };
  
  checkBeforeSwapReturn(code);
  
  // Check for other common return patterns
  const returnSelectors = [
    'beforeInitialize', 'afterInitialize', 'beforeAddLiquidity', 'afterAddLiquidity',
    'beforeRemoveLiquidity', 'afterRemoveLiquidity', 'afterSwap', 'beforeDonate', 'afterDonate'
  ];
  
  for (const funcName of returnSelectors) {
    const funcMatch = code.match(new RegExp(`function\\s+${funcName}[^{]*\\{([^}]*?)return`, 's'));
    if (funcMatch && !funcMatch[1].includes(`BaseHook.${funcName}.selector`)) {
      results.suggestions.push({
        type: 'selector_suggestion',
        message: `Consider returning BaseHook.${funcName}.selector in ${funcName}`,
        detail: 'Using the correct selector helps with debugging and compatibility',
        severity: 'suggestion'
      });
    }
  }
}