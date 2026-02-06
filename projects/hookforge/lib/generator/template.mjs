// Template Generator — Generates hook code from pattern + params

import patternRegistry from '../patterns/index.mjs';

export async function generateFromTemplate(patternId, params) {
  const pattern = await patternRegistry.getPattern(patternId);
  
  if (!pattern) {
    throw new Error(`Pattern not found: ${patternId}`);
  }

  // Validate params
  const warnings = validateParams(pattern, params);
  
  // Generate Solidity code
  const solidity = pattern.solidity(params);
  
  // Generate test code
  const test = pattern.test ? pattern.test(params) : generateDefaultTest(pattern, params);

  return {
    patternId,
    solidity,
    test,
    warnings: [...warnings, ...pattern.pitfalls.map(p => ({ type: 'pitfall', message: p, severity: 'info' }))],
    gasEstimate: pattern.gasEstimate,
    metadata: {
      name: pattern.name,
      description: pattern.description,
      complexity: pattern.complexity,
      callbacks: pattern.callbacks,
      flags: pattern.flags
    }
  };
}

function validateParams(pattern, params) {
  const warnings = [];

  for (const paramDef of pattern.params) {
    const value = params[paramDef.name];
    
    if (value === undefined || value === null || value === '') {
      if (paramDef.default) {
        warnings.push({
          type: 'default_param',
          message: `Using default value for ${paramDef.name}: ${paramDef.default}`,
          severity: 'info'
        });
      } else {
        warnings.push({
          type: 'missing_param',
          message: `Missing required parameter: ${paramDef.name} (${paramDef.description})`,
          severity: 'warning'
        });
      }
    }

    // Type-specific validation
    if (paramDef.type === 'address' && value) {
      if (!/^0x[a-fA-F0-9]{40}$/.test(value)) {
        warnings.push({
          type: 'invalid_address',
          message: `Invalid address format for ${paramDef.name}: ${value}`,
          severity: 'warning'
        });
      }
      if (value === '0x0000000000000000000000000000000000000000') {
        warnings.push({
          type: 'zero_address',
          message: `Zero address provided for ${paramDef.name}`,
          severity: 'warning'
        });
      }
    }

    if (paramDef.type === 'uint256' && value) {
      const num = parseInt(value);
      if (isNaN(num) || num < 0) {
        warnings.push({
          type: 'invalid_uint',
          message: `Invalid uint256 value for ${paramDef.name}: ${value}`,
          severity: 'warning'
        });
      }
    }
  }

  return warnings;
}

function generateDefaultTest(pattern, params) {
  return `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Test.sol";

contract ${pattern.name.replace(/\s+/g, '')}Test is Test {
    function setUp() public {
        // Deploy hook with params
    }

    function testBasicFunctionality() public {
        // Verify ${pattern.name} works correctly
    }

    function testEdgeCases() public {
        // Test edge cases specific to ${pattern.name}
    }
}`;
}
