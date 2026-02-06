// Known Pitfalls Checker - Match against database of common V4 bugs

// Database of known V4 pitfalls from real experience
const KNOWN_PITFALLS = {
  settlePairOnHooks: {
    patterns: [
      /SETTLE_PAIR/,
      /Actions\.SETTLE_PAIR/,
      /settlePair\s*\(/
    ],
    severity: 'error',
    message: 'SETTLE_PAIR breaks on some hook pools (DeltaNotNegative error)',
    detail: 'Use CLOSE_CURRENCY (0x11) instead - it\'s the universal safe action for hook pools',
    solution: 'Replace SETTLE_PAIR/TAKE_PAIR with CLOSE_CURRENCY action code'
  },
  
  threeActionEncoding: {
    patterns: [
      /Actions\s*\[\s*[^}]*,\s*[^}]*,\s*[^}]*,\s*[^}]*\]/,
      /abi\.encode\s*\([^)]*,\s*[^)]*,\s*[^)]*,\s*[^)]*\)/
    ],
    severity: 'error',
    message: '3+ action encoding causes SliceOutOfBounds error',
    detail: 'V4 hook pools are limited to 2-action patterns maximum',
    solution: 'Combine actions or use CLOSE_CURRENCY for simpler patterns'
  },
  
  positionManagerApproval: {
    patterns: [
      /approve\s*\(\s*.*?PositionManager/,
      /PositionManager.*?approve/
    ],
    severity: 'error',
    message: 'Approving PositionManager instead of Permit2',
    detail: 'V4 uses Permit2 for token approvals, not PositionManager directly',
    solution: 'Approve Permit2 contract instead: token.approve(permit2Address, amount)'
  },
  
  tickRangeOrdering: {
    patterns: [
      /tickLower\s*>\s*tickUpper/,
      /upper.*?lower/
    ],
    severity: 'warning',
    message: 'Incorrect tick range ordering',
    detail: 'tickLower must be less than tickUpper',
    solution: 'Ensure tickLower < tickUpper and both are multiples of tickSpacing'
  },
  
  balanceDeltaFeeBase: {
    patterns: [
      /fee\s*=.*?BalanceDelta/,
      /feeRate\s*\*.*?delta\./,
      /\*\s*feeRate.*?BalanceDelta/
    ],
    severity: 'error',
    message: 'Using BalanceDelta as fee calculation base',
    detail: 'Fee base must be amountSpecified (user input), not BalanceDelta (result)',
    solution: 'Use params.amountSpecified for fee calculations'
  },
  
  missingDeltaFlag: {
    patterns: [
      /beforeSwap.*?returns.*?BeforeSwapDelta(?!.*beforeSwapReturnDelta:\s*true)/s,
      /toBeforeSwapDelta\s*\(\s*[^0][^,)]*(?!.*beforeSwapReturnDelta:\s*true)/s
    ],
    severity: 'error',
    message: 'Missing beforeSwapReturnDelta flag with non-zero delta',
    detail: 'V4 requires this flag when beforeSwap modifies token balances',
    solution: 'Set beforeSwapReturnDelta: true in getHookPermissions()'
  },
  
  externalCallsInHot: {
    patterns: [
      /(?:beforeSwap|afterSwap)[\s\S]*?(?:call\{|\.call\(|external)/,
      /(?:beforeSwap|afterSwap)[\s\S]*?(?:transfer\((?!.*poolManager)|send\()/
    ],
    severity: 'warning',
    message: 'External calls in hot path (swap callbacks)',
    detail: 'External calls in beforeSwap/afterSwap can fail or be expensive',
    solution: 'Move external calls outside callback or use try/catch'
  },
  
  reentrancyRisk: {
    patterns: [
      /(?:before|after)(?:Swap|AddLiquidity)[\s\S]*?(?:call\{|\.call\()/,
      /(?:before|after)(?:Swap|AddLiquidity)[\s\S]*?(?:delegatecall|staticcall)/
    ],
    severity: 'error',
    message: 'Potential reentrancy in hook callbacks',
    detail: 'Hook callbacks can be reentered through external calls',
    solution: 'Use reentrancy guards or avoid external calls in callbacks'
  },
  
  storageInTransientSlot: {
    patterns: [
      /(?:beforeSwap|afterSwap)[\s\S]*?(?:mapping\s*\([^)]*\)\s*(?:public|private))/,
      /(?:beforeSwap|afterSwap)[\s\S]*?(?:\w+\s*=\s*\w+\s*\[.*?\]\s*=)/
    ],
    severity: 'suggestion',
    message: 'Consider using transient storage for per-transaction state',
    detail: 'Transient storage (tstore/tload) is cheaper for temporary state',
    solution: 'Use transient storage for data that doesn\'t persist beyond transaction'
  },
  
  gasLimitExceeded: {
    patterns: [
      /(?:beforeSwap|afterSwap)[\s\S]*?(?:for\s*\([^}]*\{[^}]*\}){3,}/,
      /(?:beforeSwap|afterSwap)[\s\S]*?(?:while\s*\([^}]*\{[^}]*\}){2,}/
    ],
    severity: 'warning',
    message: 'Complex logic in swap callbacks may exceed gas limits',
    detail: 'beforeSwap has ~50k gas budget for complex operations',
    solution: 'Simplify logic or move expensive operations to afterSwap'
  },

  incorrectSqrtPriceDirection: {
    patterns: [
      /sqrtPriceLimitX96.*?0/,
      /sqrtPriceLimitX96:\s*0/
    ],
    severity: 'warning',
    message: 'sqrtPriceLimitX96 set to 0',
    detail: 'Use MIN_SQRT_RATIO + 1 or MAX_SQRT_RATIO - 1 for price limits',
    solution: 'Use proper sqrt price limits based on swap direction'
  },

  flagPermissionMismatch: {
    patterns: [
      /beforeSwap:\s*false(?=[\s\S]*function\s+beforeSwap)/,
      /afterSwap:\s*false(?=[\s\S]*function\s+afterSwap)/
    ],
    severity: 'error',
    message: 'Hook function implemented but permission flag set to false',
    detail: 'Each implemented callback needs corresponding permission flag',
    solution: 'Set the permission flag to true for implemented callbacks'
  }
};

export async function checkKnownPitfalls(solidityCode) {
  const results = {
    errors: [],
    warnings: [],
    suggestions: []
  };

  try {
    // Check each known pitfall pattern
    for (const [pitfallId, pitfall] of Object.entries(KNOWN_PITFALLS)) {
      const matches = checkPitfallPatterns(solidityCode, pitfall.patterns);
      
      if (matches.length > 0) {
        const issue = {
          type: pitfallId,
          message: pitfall.message,
          detail: pitfall.detail,
          solution: pitfall.solution,
          severity: pitfall.severity,
          matches: matches.length
        };
        
        switch (pitfall.severity) {
          case 'error':
            results.errors.push(issue);
            break;
          case 'warning':
            results.warnings.push(issue);
            break;
          case 'suggestion':
            results.suggestions.push(issue);
            break;
        }
      }
    }
    
    // Additional contextual checks
    checkCallbackGasPatterns(solidityCode, results);
    checkV4SpecificPatterns(solidityCode, results);
    checkSecurityPatterns(solidityCode, results);

    return results;
  } catch (error) {
    results.errors.push({
      type: 'pitfall_check_error',
      message: `Pitfall checking failed: ${error.message}`,
      severity: 'error'
    });
    return results;
  }
}

function checkPitfallPatterns(code, patterns) {
  const matches = [];
  
  for (const pattern of patterns) {
    const regex = new RegExp(pattern, 'gs');
    let match;
    
    while ((match = regex.exec(code)) !== null) {
      matches.push({
        match: match[0],
        index: match.index,
        line: getLineNumber(code, match.index)
      });
    }
  }
  
  return matches;
}

function getLineNumber(code, index) {
  return code.substring(0, index).split('\n').length;
}

function checkCallbackGasPatterns(code, results) {
  // Check for expensive operations in beforeSwap
  const beforeSwapMatch = code.match(/function\s+beforeSwap[^{]*\{([^}]*(?:\{[^}]*\}[^}]*)*)\}/s);
  if (beforeSwapMatch) {
    const beforeSwapBody = beforeSwapMatch[1];
    
    // Look for expensive operations
    const expensivePatterns = [
      { pattern: /sstore\s*\(/, message: 'Storage writes in beforeSwap are expensive' },
      { pattern: /sha3\s*\(|keccak256\s*\(/, message: 'Hashing operations consume significant gas' },
      { pattern: /ecrecover\s*\(/, message: 'Signature verification is very expensive' },
      { pattern: /for\s*\([^}]*\)[^}]*\{[^}]*\}/, message: 'Loops can exceed gas limits' }
    ];
    
    for (const {pattern, message} of expensivePatterns) {
      if (pattern.test(beforeSwapBody)) {
        results.warnings.push({
          type: 'expensive_operation_before_swap',
          message: `Expensive operation in beforeSwap: ${message}`,
          detail: 'beforeSwap has limited gas budget (~50k gas)',
          severity: 'warning'
        });
      }
    }
  }
}

function checkV4SpecificPatterns(code, results) {
  // Check for V4-specific imports
  const requiredImports = [
    'BaseHook',
    'Hooks',
    'IPoolManager',
    'PoolKey',
    'BeforeSwapDelta'
  ];
  
  for (const importName of requiredImports) {
    if (code.includes(importName) && !code.includes(`import {${importName}}`)) {
      // Check if it's imported in any form
      const importRegex = new RegExp(`import\\s+.*?${importName}.*?from`, 'g');
      if (!importRegex.test(code)) {
        results.suggestions.push({
          type: 'missing_import',
          message: `Missing or unclear import for ${importName}`,
          detail: `Ensure ${importName} is properly imported from v4-core or v4-periphery`,
          severity: 'suggestion'
        });
      }
    }
  }
  
  // Check for proper V4 action usage
  if (code.includes('Actions.') && !code.includes('CLOSE_CURRENCY')) {
    const actionPattern = /Actions\.(\w+)/g;
    const actions = new Set();
    let match;
    
    while ((match = actionPattern.exec(code)) !== null) {
      actions.add(match[1]);
    }
    
    if (actions.has('SETTLE_PAIR') || actions.has('TAKE_PAIR')) {
      results.warnings.push({
        type: 'risky_actions',
        message: 'Using SETTLE_PAIR/TAKE_PAIR which can fail on hook pools',
        detail: 'Consider using CLOSE_CURRENCY for more reliable hook pool compatibility',
        severity: 'warning'
      });
    }
  }
}

function checkSecurityPatterns(code, results) {
  // Check for access control patterns
  if (code.includes('onlyOwner') || code.includes('require(msg.sender')) {
    if (!code.includes('Ownable') && !code.includes('AccessControl')) {
      results.suggestions.push({
        type: 'access_control_pattern',
        message: 'Custom access control detected',
        detail: 'Consider using OpenZeppelin\'s Ownable or AccessControl for standardized access control',
        severity: 'suggestion'
      });
    }
  }
  
  // Check for integer overflow protection
  if ((code.includes('*') || code.includes('+')) && !code.includes('SafeMath') && !code.includes('overflow')) {
    const arithmeticInCallbacks = /(?:before|after)(?:Swap|AddLiquidity)[\s\S]*?(?:\+\+|--|\*|\+)/g;
    if (arithmeticInCallbacks.test(code)) {
      results.suggestions.push({
        type: 'overflow_protection',
        message: 'Arithmetic operations without explicit overflow protection',
        detail: 'Consider using SafeMath or checking for overflow in calculations',
        severity: 'suggestion'
      });
    }
  }
  
  // Check for front-running vulnerabilities
  if (code.includes('tx.origin')) {
    results.warnings.push({
      type: 'tx_origin_usage',
      message: 'Usage of tx.origin detected',
      detail: 'tx.origin can be manipulated and should generally be avoided',
      solution: 'Use msg.sender instead of tx.origin for access control',
      severity: 'warning'
    });
  }
  
  // Check for timestamp dependence
  if (code.includes('block.timestamp') || code.includes('now')) {
    const timestampInLogic = /(?:if|require|assert)[\s\S]*?(?:block\.timestamp|now)/g;
    if (timestampInLogic.test(code)) {
      results.suggestions.push({
        type: 'timestamp_dependence',
        message: 'Logic depends on block.timestamp',
        detail: 'Miners can manipulate timestamps within ~15 seconds',
        severity: 'suggestion'
      });
    }
  }
}