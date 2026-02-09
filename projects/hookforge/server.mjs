import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';

// Pattern imports
import patternRegistry from './lib/patterns/index.mjs';

// Generator imports
import { generateFromTemplate } from './lib/generator/template.mjs';
import { composePatterns } from './lib/generator/composer.mjs';

// Validator import
import { validateHook } from './lib/validator/index.mjs';

// V4 Knowledge import
import v4Knowledge from './lib/v4-knowledge.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'ui')));

// Routes

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// Serve UI
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'ui', 'index.html'));
});

// API Routes

// Get all patterns with metadata
app.get('/api/patterns', async (req, res) => {
  try {
    const patterns = await patternRegistry.getAllPatterns();
    const metadata = patterns.map(pattern => ({
      id: pattern.id,
      name: pattern.name,
      description: pattern.description,
      complexity: pattern.complexity,
      callbacks: pattern.callbacks,
      flags: pattern.flags,
      gasEstimate: pattern.gasEstimate
    }));
    res.json({ patterns: metadata });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch patterns', message: error.message });
  }
});

// Get specific pattern
app.get('/api/patterns/:id', async (req, res) => {
  try {
    const pattern = await patternRegistry.getPattern(req.params.id);
    if (!pattern) {
      return res.status(404).json({ error: 'Pattern not found' });
    }
    res.json({ pattern });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch pattern', message: error.message });
  }
});

// Generate from template
app.post('/api/generate/template', async (req, res) => {
  try {
    const { patternId, params } = req.body;
    
    if (!patternId || !params) {
      return res.status(400).json({ error: 'Missing patternId or params' });
    }

    // Sanitize inputs
    const sanitizedPatternId = sanitizePatternId(patternId);
    const sanitizedParams = sanitizeParams(params);

    const result = await generateFromTemplate(sanitizedPatternId, sanitizedParams);
    res.json({ 
      success: true,
      solidity: result.solidity,
      test: result.test,
      warnings: result.warnings || []
    });
  } catch (error) {
    res.status(500).json({ error: 'Template generation failed', message: error.message });
  }
});

// Compose multiple patterns
app.post('/api/generate/compose', async (req, res) => {
  try {
    const { patterns, params } = req.body;
    
    if (!patterns || !Array.isArray(patterns) || patterns.length === 0) {
      return res.status(400).json({ error: 'Missing or invalid patterns array' });
    }

    // Sanitize inputs
    const sanitizedPatterns = patterns.map(sanitizePatternId);
    const sanitizedParams = sanitizeParams(params || {});

    const result = await composePatterns(sanitizedPatterns, sanitizedParams);
    res.json({ 
      success: true,
      solidity: result.solidity,
      test: result.test,
      warnings: result.warnings || []
    });
  } catch (error) {
    res.status(500).json({ error: 'Pattern composition failed', message: error.message });
  }
});

// Natural language generation
app.post('/api/generate/natural', async (req, res) => {
  try {
    const { prompt } = req.body;
    
    if (!prompt || typeof prompt !== 'string') {
      return res.status(400).json({ error: 'Missing or invalid prompt' });
    }

    // Sanitize prompt
    const sanitizedPrompt = sanitizePrompt(prompt);

    // For now, return a structured response indicating this would use LLM
    // In production, this would call OpenAI/Anthropic with V4-specialized prompt
    res.json({ 
      success: true,
      solidity: generateNLPlaceholder(sanitizedPrompt),
      test: generateTestPlaceholder(sanitizedPrompt),
      warnings: ['Natural language generation requires LLM integration']
    });
  } catch (error) {
    res.status(500).json({ error: 'Natural language generation failed', message: error.message });
  }
});

// Validate Solidity code
app.post('/api/validate', async (req, res) => {
  try {
    const { code } = req.body;
    
    if (!code || typeof code !== 'string') {
      return res.status(400).json({ error: 'Missing or invalid code' });
    }

    const validationResult = await validateHook(code);
    res.json({ 
      success: true,
      ...validationResult
    });
  } catch (error) {
    res.status(500).json({ error: 'Validation failed', message: error.message });
  }
});

// Get V4 pitfalls database
app.get('/api/pitfalls', (req, res) => {
  try {
    res.json({ 
      pitfalls: v4Knowledge.pitfalls,
      conventions: v4Knowledge.conventions,
      actionCodes: v4Knowledge.actionCodes
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch pitfalls', message: error.message });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ 
    error: 'Internal server error', 
    message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// Helper functions for NL generation placeholder
function generateNLPlaceholder(prompt) {
  return `// Generated from: "${prompt}"
// This would be generated by LLM with V4-specialized system prompt

pragma solidity ^0.8.26;

import {BaseHook} from "@uniswap/v4-periphery/contracts/BaseHook.sol";
import {Hooks} from "@uniswap/v4-core/contracts/libraries/Hooks.sol";
import {IPoolManager} from "@uniswap/v4-core/contracts/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/contracts/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/contracts/types/PoolId.sol";
import {BalanceDelta} from "@uniswap/v4-core/contracts/types/BalanceDelta.sol";
import {BeforeSwapDelta, BeforeSwapDeltaLibrary} from "@uniswap/v4-core/contracts/types/BeforeSwapDelta.sol";

contract GeneratedHook is BaseHook {
    using PoolIdLibrary for PoolKey;
    using BeforeSwapDeltaLibrary for BeforeSwapDelta;

    constructor(IPoolManager _poolManager) BaseHook(_poolManager) {}

    function getHookPermissions() public pure override returns (Hooks.Permissions memory) {
        return Hooks.Permissions({
            beforeInitialize: false,
            afterInitialize: false,
            beforeAddLiquidity: false,
            afterAddLiquidity: false,
            beforeRemoveLiquidity: false,
            afterRemoveLiquidity: false,
            beforeSwap: true,
            afterSwap: false,
            beforeDonate: false,
            afterDonate: false,
            beforeSwapReturnDelta: false,
            afterSwapReturnDelta: false,
            afterAddLiquidityReturnDelta: false,
            afterRemoveLiquidityReturnDelta: false
        });
    }

    function beforeSwap(
        address,
        PoolKey calldata key,
        IPoolManager.SwapParams calldata params,
        bytes calldata
    ) external override returns (bytes4, BeforeSwapDelta, uint24) {
        // Generated implementation would go here
        return (BaseHook.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
    }
}`;
}

function generateTestPlaceholder(prompt) {
  return `// Test for: "${prompt}"
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import "../src/GeneratedHook.sol";

contract GeneratedHookTest is Test {
    GeneratedHook hook;
    
    function setUp() public {
        // Test setup would be generated here
    }
    
    function testBasicFunctionality() public {
        // Generated tests based on the prompt
    }
}`;
}

// Input sanitization functions
function sanitizePatternId(patternId) {
  if (typeof patternId !== 'string') {
    throw new Error('Pattern ID must be a string');
  }
  
  // Only allow alphanumeric characters, dashes, and underscores
  const sanitized = patternId.replace(/[^a-zA-Z0-9\-_]/g, '');
  
  if (sanitized.length === 0 || sanitized.length > 50) {
    throw new Error('Invalid pattern ID format');
  }
  
  return sanitized;
}

function sanitizeParams(params) {
  if (typeof params !== 'object' || params === null) {
    return {};
  }
  
  const sanitized = {};
  
  for (const [key, value] of Object.entries(params)) {
    // Sanitize parameter keys
    const sanitizedKey = sanitizeParamKey(key);
    
    // Sanitize parameter values based on type
    sanitized[sanitizedKey] = sanitizeParamValue(value);
  }
  
  return sanitized;
}

function sanitizeParamKey(key) {
  if (typeof key !== 'string') {
    throw new Error('Parameter key must be a string');
  }
  
  // Only allow alphanumeric characters and underscores for parameter keys
  const sanitized = key.replace(/[^a-zA-Z0-9_]/g, '');
  
  if (sanitized.length === 0 || sanitized.length > 30) {
    throw new Error('Invalid parameter key format');
  }
  
  return sanitized;
}

function sanitizeParamValue(value) {
  if (typeof value === 'string') {
    // Remove potentially dangerous characters but preserve valid Solidity literals
    // Allow alphanumeric, spaces, dots, parentheses, and some symbols for addresses/numbers
    const sanitized = value.replace(/[<>'"`;\\]/g, '');
    
    if (sanitized.length > 200) {
      throw new Error('Parameter value too long');
    }
    
    return sanitized;
  }
  
  if (typeof value === 'number') {
    // Validate numeric parameters
    if (!Number.isFinite(value) || value < 0 || value > 1e18) {
      throw new Error('Invalid numeric parameter');
    }
    return value;
  }
  
  if (typeof value === 'boolean') {
    return value;
  }
  
  if (Array.isArray(value)) {
    // Sanitize array elements
    return value.map(sanitizeParamValue);
  }
  
  // Reject other types
  throw new Error('Unsupported parameter type');
}

function sanitizePrompt(prompt) {
  if (typeof prompt !== 'string') {
    throw new Error('Prompt must be a string');
  }
  
  // Remove potentially dangerous HTML/script tags and limit length
  const sanitized = prompt.replace(/<[^>]*>/g, '').substring(0, 1000);
  
  if (sanitized.trim().length === 0) {
    throw new Error('Prompt cannot be empty');
  }
  
  return sanitized;
}

// Start server
app.listen(PORT, () => {
  console.log(`🔨 HookForge server running on port ${PORT}`);
  console.log(`📱 Web UI: http://localhost:${PORT}`);
  console.log(`🔗 API: http://localhost:${PORT}/api`);
});

export default app;