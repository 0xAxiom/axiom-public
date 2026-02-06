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

    const result = await generateFromTemplate(patternId, params);
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

    const result = await composePatterns(patterns, params || {});
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

    // For now, return a structured response indicating this would use LLM
    // In production, this would call OpenAI/Anthropic with V4-specialized prompt
    res.json({ 
      success: true,
      solidity: generateNLPlaceholder(prompt),
      test: generateTestPlaceholder(prompt),
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

import {BaseHook} from "v4-periphery/src/base/hooks/BaseHook.sol";
import {Hooks} from "v4-core/src/libraries/Hooks.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "v4-core/src/types/PoolId.sol";
import {BalanceDelta} from "v4-core/src/types/BalanceDelta.sol";
import {BeforeSwapDelta, BeforeSwapDeltaLibrary} from "v4-core/src/types/BeforeSwapDelta.sol";

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

// Start server
app.listen(PORT, () => {
  console.log(`🔨 HookForge server running on port ${PORT}`);
  console.log(`📱 Web UI: http://localhost:${PORT}`);
  console.log(`🔗 API: http://localhost:${PORT}/api`);
});

export default app;