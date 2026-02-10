# Code Generation Validator

> Turn unreliable LLM code generation into reliable, compilable code.

A multi-stage validation pipeline that extracts, validates, scans, and compiles LLM-generated code with automatic retry functionality.

## Quick Start

```bash
# Basic usage
node validate.mjs --input llm_output.txt --lang solidity --output clean.sol

# With automatic retry
node validate.mjs --input raw.txt --lang solidity --retry --model qwq:latest
```

## The Problem

Local LLMs like QwQ are great at generating code, but:
- ~80% of Solidity output fails to compile
- Code is mixed with verbose explanations
- No validation before compilation attempts
- Wastes time debugging broken code

## The Solution

5-stage validation pipeline:

1. **🔍 Extract** — Pull clean code from mixed LLM output
2. **✅ Syntax Check** — Validate language-specific syntax rules
3. **🔒 Security Scan** — Flag dangerous patterns and vulnerabilities  
4. **⚙️  Compile Test** — Run through actual compiler
5. **🔄 Auto-Retry** — Re-prompt LLM with specific error feedback

## Features

- **Multi-language support:** Solidity, JavaScript, TypeScript, Python
- **Smart extraction:** Handles code blocks, mixed text, multiple snippets
- **Security scanning:** Built-in rules for common vulnerabilities
- **AMM Strategy validation:** Special handling for Uniswap V4 contracts
- **Automatic retry:** Feeds errors back to LLM for correction
- **CLI + Module:** Use standalone or import into projects

## Usage

### Command Line

```bash
# Validate QwQ Solidity output
ollama run qwq:latest "Write a Strategy contract" > output.txt
node validate.mjs --input output.txt --lang solidity --output strategy.sol --retry

# JavaScript validation  
node validate.mjs --input js_code.txt --lang javascript --verbose

# Help
node validate.mjs --help
```

### As Module

```javascript
import { CodeValidator } from './validate.mjs';

const validator = new CodeValidator();
const result = await validator.validateCode(llmOutput, {
  language: 'solidity',
  retry: true,
  model: 'qwq:latest'
});

if (result.success) {
  console.log('Validated code:', result.code);
} else {
  console.log('Validation failed:', result.errors);
}
```

## Example Output

### Success ✅
```
🔍 Starting validation pipeline...

--- Attempt 1 ---
📝 Extracting code...
✅ Extracted 1247 characters of code
🔍 Validating syntax...
✅ Syntax validation passed  
🔒 Scanning for security issues...
⚠️  Security warnings found: 1
  - SECURITY WARNING: delegatecall() can be dangerous - ensure trusted target
⚙️  Testing compilation...
✅ Compilation test passed

✅ Validation successful! (1 attempts)
📝 Validated code saved to: strategy.sol
```

### Retry Example 🔄
```
--- Attempt 1 ---
📝 Extracting code...
✅ Extracted 892 characters of code
🔍 Validating syntax...
❌ Syntax errors found: 2
  - Missing pragma solidity declaration
  - Missing required function: afterSwap
🔄 Retrying with error feedback...

--- Attempt 2 ---  
📝 Extracting code...
✅ Extracted 1156 characters of code
🔍 Validating syntax...
✅ Syntax validation passed
```

## Requirements

- **Node.js** 16+ (built-in dependencies only)
- **Solidity compiler** (optional, for full Solidity validation): `npm install -g solc`
- **Ollama** (optional, for retry functionality): `curl -fsSL https://ollama.ai/install.sh | sh`

## AMM Strategy Validation

Special features for Uniswap V4 Strategy contracts:

- ✅ Validates required functions: `afterSwap`, `afterInitialize`, `getName`
- ✅ Prioritizes code blocks containing `contract Strategy`  
- ✅ Security scan for DeFi-specific vulnerabilities
- ✅ Compilation test with Solidity compiler

## Security Scanning

Built-in detection for dangerous patterns:

| Pattern | Risk | Action |
|---------|------|--------|
| `selfdestruct()` | High | Deprecated and dangerous |
| `delegatecall()` | Medium | Ensure trusted target |
| `assembly {}` | Medium | Review inline assembly carefully |
| `tx.origin` | High | Vulnerable to phishing |
| `block.timestamp` | Low | Can be manipulated by miners |

## Performance

- **Extraction:** ~10ms
- **Syntax validation:** ~5ms  
- **Security scan:** ~15ms
- **Compilation:** ~2-5 seconds
- **Full retry cycle:** ~30-60 seconds

## Error Codes

- **0:** Success
- **1:** Validation failed (syntax, security, or compilation)
- **2:** Input file not found
- **3:** Missing required parameters

## Development

```bash
# Run tests with real QwQ output
ollama run qwq:latest "Write a Solidity contract" > test_input.txt
node validate.mjs --input test_input.txt --lang solidity --verbose

# Test JavaScript validation
echo "function test() { return 'hello'; }" | node validate.mjs --input /dev/stdin --lang javascript

# Test error handling
echo "invalid solidity code" | node validate.mjs --input /dev/stdin --lang solidity
```

## Integration Examples

### CI/CD Pipeline
```yaml
- name: Validate generated code
  run: |
    node validate.mjs --input generated.sol --lang solidity
    if [ $? -eq 0 ]; then
      echo "Code validation passed"
    else
      echo "Code validation failed"
      exit 1
    fi
```

### Agent Workflow
```javascript
// Generate code with LLM
const rawCode = await ollama.generate(prompt);

// Validate and get clean output
const validator = new CodeValidator();
const result = await validator.validateCode(rawCode, {
  language: 'solidity',
  retry: true
});

if (result.success) {
  await deployContract(result.code);
} else {
  throw new Error(`Code validation failed: ${result.errors.join(', ')}`);
}
```

## License

MIT License - See LICENSE file for details.

## Contributing

1. Fork the repository
2. Create feature branch
3. Add tests for new functionality  
4. Submit pull request

## Support

- 📋 **Issues:** Report bugs and feature requests
- 📖 **Documentation:** Full API docs in SKILL.md
- 💬 **Discussions:** Questions and usage examples