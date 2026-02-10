# Code Generation Validator

A multi-stage validation pipeline that turns unreliable LLM code generation into reliable, compilable code.

## Problem Solved

When using local LLMs like QwQ for code generation:
- ~80% of generated Solidity fails to compile
- Output mixes code with verbose explanations  
- No validation before attempting compilation
- Wastes time debugging broken code

This skill provides a robust validation pipeline with automatic retry and error feedback.

## Features

### Multi-Stage Pipeline

1. **Extract** — Pull clean code from LLM output (handles mixed text, multiple blocks)
2. **Syntax Check** — Basic language syntax validation (balanced braces, required declarations)
3. **Security Scan** — Flag dangerous patterns (selfdestruct, delegatecall, assembly)
4. **Compile Test** — Run through actual compiler (solc, Node.js, etc.)
5. **Retry** — Auto-retry with specific error feedback (max 3 attempts)

### Language Support

- **Solidity** — Full pipeline with AMM Strategy validation
- **JavaScript/TypeScript** — Syntax + runtime testing
- **Python** — Basic syntax validation
- Extensible for other languages

### AMM Strategy Validation

Special handling for Uniswap V4 Strategy contracts:
- Validates required functions: `afterSwap`, `afterInitialize`, `getName`
- Prioritizes code blocks containing `contract Strategy`
- Security scan for common DeFi vulnerabilities

## Installation

```bash
# Clone or navigate to skill directory
cd ~/Github/axiom-public/agent-skills/skills/code-validator

# No additional dependencies required (uses Node.js built-ins)
# Optional: Install Solidity compiler for full validation
npm install -g solc

# Optional: Install Ollama for retry functionality  
curl -fsSL https://ollama.ai/install.sh | sh
ollama pull qwq:latest
```

## Usage

### CLI Interface

```bash
# Basic validation
node validate.mjs --input /tmp/qwq_output.txt --lang solidity --output validated.sol

# With retry on failure
node validate.mjs --input raw.txt --lang solidity --retry --model qwq:latest

# Verbose output for debugging
node validate.mjs --input code.txt --lang javascript --retry --verbose

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
  model: 'qwq:latest',
  verbose: false
});

if (result.success) {
  console.log('✅ Validated code:', result.code);
  console.log('⚠️  Warnings:', result.warnings);
} else {
  console.log('❌ Errors:', result.errors);
  console.log('🛑 Failed at stage:', result.stage);
}
```

## Configuration

### Extraction Patterns

The validator uses these patterns to extract code from LLM output:

```javascript
// Solidity
/```solidity\s*\n(.*?)```/gs
/```sol\s*\n(.*?)```/gs  
/```\s*\n(.*?)```/gs

// For AMM: prioritizes longest match containing 'contract Strategy'
```

### Security Scan Rules

Detects dangerous Solidity patterns:
- `selfdestruct()` - deprecated and dangerous
- `delegatecall()` - can be dangerous with untrusted targets
- `assembly {}` - inline assembly requires careful review
- `tx.origin` - vulnerable to phishing attacks
- `block.timestamp` - can be manipulated by miners

### Retry Strategy

- **Max retries:** 3 attempts
- **Error feedback:** Sends specific compilation errors back to LLM
- **Model support:** Any Ollama model (default: qwq:latest)
- **Timeout:** 30 seconds per compilation attempt

## Examples

### QwQ Solidity Generation

```bash
# Generate and validate AMM Strategy
ollama run qwq:latest "Write a Solidity contract called Strategy" > /tmp/test_raw.txt
node validate.mjs --input /tmp/test_raw.txt --lang solidity --output /tmp/test_validated.sol --retry
```

### Integration with Scripts

```bash
#!/bin/bash
# Auto-retry until valid code
MAX_ATTEMPTS=5
for i in $(seq 1 $MAX_ATTEMPTS); do
  ollama run qwq:latest "Write Solidity Strategy contract" > /tmp/raw_$i.txt
  if node validate.mjs --input /tmp/raw_$i.txt --lang solidity --output strategy.sol --retry; then
    echo "✅ Valid code generated on attempt $i"
    break
  fi
done
```

### Batch Validation

```javascript
import { CodeValidator } from './validate.mjs';

const validator = new CodeValidator();
const files = ['output1.txt', 'output2.txt', 'output3.txt'];

for (const file of files) {
  const content = await fs.readFile(file, 'utf8');
  const result = await validator.validateCode(content, { 
    language: 'solidity',
    retry: true 
  });
  
  if (result.success) {
    await fs.writeFile(`validated_${file}`, result.code);
  }
}
```

## Output Format

### Success Response
```javascript
{
  success: true,
  code: "pragma solidity ^0.8.0;\ncontract Strategy...",
  errors: [],
  warnings: ["Security: delegatecall detected"],
  stage: "complete",
  attempts: 2
}
```

### Error Response  
```javascript
{
  success: false,
  code: "partial code or null",
  errors: ["Missing contract declaration", "Unbalanced braces"],
  warnings: [],
  stage: "syntax" // or "extraction", "compilation", "retry"
}
```

## Performance

- **Extraction:** ~10ms for typical LLM output
- **Syntax validation:** ~5ms per check
- **Security scan:** ~15ms for Solidity contracts
- **Compilation:** ~2-5 seconds (depends on contract complexity)
- **Retry cycle:** ~30-60 seconds per attempt (includes LLM generation)

## Troubleshooting

### Common Issues

**"Solidity compiler not found"**
```bash
npm install -g solc
# or use Docker
docker run --rm -v $(pwd):/contracts ethereum/solc:stable /contracts/contract.sol
```

**"Ollama not found"**  
```bash
curl -fsSL https://ollama.ai/install.sh | sh
ollama pull qwq:latest
```

**"No code blocks found"**
- Check extraction patterns match your LLM's output format
- Use `--verbose` to debug extraction process
- LLM may be outputting plain text without code blocks

### Debugging

```bash
# Enable verbose output
node validate.mjs --input debug.txt --lang solidity --verbose

# Save partial results for debugging
node validate.mjs --input broken.txt --lang solidity --output debug.sol
# Creates debug_debug.sol with partial code
```

## Extensions

### Adding New Languages

```javascript
// Add to CodeValidator class
validateNewLanguageSyntax(code) {
  const errors = [];
  // Add syntax checks
  return errors;
}

async compileNewLanguage(code) {
  // Add compilation logic
  return { success: true, errors: [], warnings: [] };
}
```

### Custom Security Rules

```javascript
scanCustomSecurity(code) {
  const warnings = [];
  
  // Add custom patterns
  const patterns = [
    { pattern: /dangerous_function/, message: 'Custom warning' }
  ];
  
  // Scan code
  return warnings;
}
```

## Integration

Works seamlessly with:
- **Local LLMs:** QwQ, DeepSeek, Gemma
- **AMM Development:** Uniswap V4 strategies
- **CI/CD Pipelines:** Exit codes for automation
- **Agent Workflows:** Importable module interface

## Next Steps

1. **Language Extensions:** Add Go, Rust, Move validation
2. **Advanced Security:** Static analysis integration
3. **Performance Optimization:** Parallel compilation
4. **IDE Integration:** VSCode extension
5. **Web Interface:** Browser-based validation tool