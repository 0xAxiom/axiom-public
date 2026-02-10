#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';

/**
 * Multi-stage validation pipeline for LLM-generated code
 * Turns unreliable code generation into reliable output
 */

class CodeValidator {
  constructor() {
    this.maxRetries = 3;
    this.supportedLanguages = ['solidity', 'javascript', 'typescript', 'python'];
  }

  /**
   * Stage 1: Extract code from LLM output
   */
  extractCode(input, language = 'solidity') {
    const patterns = {
      solidity: [
        /```solidity\s*\n(.*?)```/gs,
        /```sol\s*\n(.*?)```/gs,
        /```\s*\n(.*?)```/gs
      ],
      javascript: [
        /```javascript\s*\n(.*?)```/gs,
        /```js\s*\n(.*?)```/gs,
        /```\s*\n(.*?)```/gs
      ],
      typescript: [
        /```typescript\s*\n(.*?)```/gs,
        /```ts\s*\n(.*?)```/gs,
        /```\s*\n(.*?)```/gs
      ],
      python: [
        /```python\s*\n(.*?)```/gs,
        /```py\s*\n(.*?)```/gs,
        /```\s*\n(.*?)```/gs
      ]
    };

    const langPatterns = patterns[language] || patterns.solidity;
    const matches = [];

    for (const pattern of langPatterns) {
      const found = [...input.matchAll(pattern)];
      matches.push(...found.map(match => match[1].trim()));
    }

    if (matches.length === 0) {
      // Fallback: try to find code-like content
      const lines = input.split('\n');
      let codeStart = -1;
      let codeEnd = -1;

      // Look for common code patterns
      const codeIndicators = {
        solidity: ['pragma solidity', 'contract ', 'function ', 'mapping'],
        javascript: ['function ', 'const ', 'let ', 'var ', '=>'],
        typescript: ['function ', 'const ', 'interface ', 'type '],
        python: ['def ', 'class ', 'import ', 'from ']
      };

      const indicators = codeIndicators[language] || codeIndicators.solidity;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (indicators.some(indicator => line.includes(indicator))) {
          if (codeStart === -1) codeStart = i;
          codeEnd = i;
        }
      }

      if (codeStart !== -1) {
        matches.push(lines.slice(codeStart, codeEnd + 1).join('\n'));
      }
    }

    if (matches.length === 0) {
      throw new Error('No code blocks found in input');
    }

    // For Solidity, prioritize longest match containing 'contract Strategy'
    if (language === 'solidity') {
      const strategyMatches = matches.filter(code => code.includes('contract Strategy'));
      if (strategyMatches.length > 0) {
        return strategyMatches.reduce((longest, current) => 
          current.length > longest.length ? current : longest
        );
      }
    }

    // Return longest match
    return matches.reduce((longest, current) => 
      current.length > longest.length ? current : longest
    );
  }

  /**
   * Stage 2: Basic syntax validation
   */
  validateSyntax(code, language = 'solidity') {
    const errors = [];

    switch (language) {
      case 'solidity':
        errors.push(...this.validateSoliditySyntax(code));
        break;
      case 'javascript':
      case 'typescript':
        errors.push(...this.validateJSSyntax(code));
        break;
      case 'python':
        errors.push(...this.validatePythonSyntax(code));
        break;
    }

    return errors;
  }

  validateSoliditySyntax(code) {
    const errors = [];

    // Check for pragma declaration
    if (!code.includes('pragma solidity')) {
      errors.push('Missing pragma solidity declaration');
    }

    // Check for contract declaration
    if (!code.match(/contract\s+\w+/)) {
      errors.push('Missing contract declaration');
    }

    // Check balanced braces
    const openBraces = (code.match(/\{/g) || []).length;
    const closeBraces = (code.match(/\}/g) || []).length;
    if (openBraces !== closeBraces) {
      errors.push(`Unbalanced braces: ${openBraces} open, ${closeBraces} close`);
    }

    // Check for required AMM Strategy functions
    if (code.includes('contract Strategy')) {
      const requiredFunctions = ['afterSwap', 'afterInitialize', 'getName'];
      for (const func of requiredFunctions) {
        if (!code.includes(func)) {
          errors.push(`Missing required function: ${func}`);
        }
      }
    }

    return errors;
  }

  validateJSSyntax(code) {
    const errors = [];

    // Check balanced braces, brackets, parentheses
    const pairs = [
      ['{', '}'],
      ['[', ']'],
      ['(', ')']
    ];

    for (const [open, close] of pairs) {
      const openCount = (code.match(new RegExp(`\\${open}`, 'g')) || []).length;
      const closeCount = (code.match(new RegExp(`\\${close}`, 'g')) || []).length;
      if (openCount !== closeCount) {
        errors.push(`Unbalanced ${open}${close}: ${openCount} open, ${closeCount} close`);
      }
    }

    return errors;
  }

  validatePythonSyntax(code) {
    const errors = [];

    // Check for basic indentation consistency
    const lines = code.split('\n').filter(line => line.trim());
    let indentLevel = 0;
    
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.endsWith(':')) {
        indentLevel++;
      }
      // Basic check - could be enhanced
    }

    return errors;
  }

  /**
   * Stage 3: Security scan for dangerous patterns
   */
  scanSecurity(code, language = 'solidity') {
    const warnings = [];

    switch (language) {
      case 'solidity':
        warnings.push(...this.scanSoliditySecurity(code));
        break;
      // Add other languages as needed
    }

    return warnings;
  }

  scanSoliditySecurity(code) {
    const warnings = [];

    // Dangerous patterns
    const dangerousPatterns = [
      { pattern: /selfdestruct\s*\(/i, message: 'selfdestruct() is dangerous and deprecated' },
      { pattern: /delegatecall\s*\(/i, message: 'delegatecall() can be dangerous - ensure trusted target' },
      { pattern: /assembly\s*\{/i, message: 'inline assembly detected - review carefully' },
      { pattern: /\.call\s*\(/i, message: 'low-level call detected - ensure proper error handling' },
      { pattern: /tx\.origin/i, message: 'tx.origin is vulnerable to phishing attacks' },
      { pattern: /block\.timestamp/i, message: 'block.timestamp can be manipulated by miners' }
    ];

    for (const { pattern, message } of dangerousPatterns) {
      if (pattern.test(code)) {
        warnings.push(`SECURITY WARNING: ${message}`);
      }
    }

    return warnings;
  }

  /**
   * Stage 4: Compile test
   */
  async compileTest(code, language = 'solidity') {
    switch (language) {
      case 'solidity':
        return await this.compileSolidity(code);
      case 'javascript':
        return await this.testJavaScript(code);
      // Add other languages
      default:
        return { success: true, errors: [], warnings: ['Compilation test not implemented for ' + language] };
    }
  }

  async compileSolidity(code) {
    return new Promise((resolve) => {
      // Create temp file
      const tempFile = `/tmp/test_contract_${Date.now()}.sol`;
      fs.writeFileSync(tempFile, code);

      // Try to compile with solc
      const solc = spawn('solc', ['--bin', '--abi', tempFile], { stdio: 'pipe' });
      
      let stdout = '';
      let stderr = '';

      solc.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      solc.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      const timeout = setTimeout(() => {
        solc.kill();
        resolve({
          success: false,
          errors: ['Compilation timeout'],
          warnings: []
        });
      }, 30000); // 30 second timeout

      solc.on('close', (code) => {
        clearTimeout(timeout);
        
        // Cleanup
        try {
          fs.unlinkSync(tempFile);
        } catch (e) {}

        if (code === 0 && !stderr.includes('Error')) {
          resolve({
            success: true,
            errors: [],
            warnings: stderr ? [stderr.trim()] : []
          });
        } else {
          resolve({
            success: false,
            errors: [stderr || 'Compilation failed'],
            warnings: []
          });
        }
      });

      solc.on('error', (err) => {
        clearTimeout(timeout);
        resolve({
          success: false,
          errors: ['Solidity compiler not found. Install with: npm install -g solc'],
          warnings: []
        });
      });
    });
  }

  async testJavaScript(code) {
    // Basic syntax check using Node.js
    try {
      new Function(code);
      return { success: true, errors: [], warnings: [] };
    } catch (error) {
      return {
        success: false,
        errors: [error.message],
        warnings: []
      };
    }
  }

  /**
   * Stage 5: Retry with LLM feedback
   */
  async retryWithFeedback(originalInput, errors, model = 'qwq:latest', language = 'solidity') {
    const prompt = `Fix this ${language} code error:

Original code had these issues:
${errors.join('\n')}

Please provide a corrected version of the code. Make sure it compiles and follows best practices.

Original input:
${originalInput}`;

    return new Promise((resolve, reject) => {
      const ollama = spawn('ollama', ['run', model, prompt], { stdio: 'pipe' });
      
      let output = '';
      
      ollama.stdout.on('data', (data) => {
        output += data.toString();
      });
      
      ollama.stderr.on('data', (data) => {
        console.error('Ollama error:', data.toString());
      });
      
      ollama.on('close', (code) => {
        if (code === 0) {
          resolve(output);
        } else {
          reject(new Error('Ollama execution failed'));
        }
      });

      ollama.on('error', (err) => {
        reject(new Error('Ollama not found. Install with: curl -fsSL https://ollama.ai/install.sh | sh'));
      });
    });
  }

  /**
   * Main validation pipeline
   */
  async validateCode(input, options = {}) {
    const {
      language = 'solidity',
      retry = false,
      model = 'qwq:latest',
      verbose = false
    } = options;

    const log = verbose ? console.log : () => {};
    
    log('🔍 Starting validation pipeline...');
    
    let currentInput = input;
    let attempts = 0;

    while (attempts < this.maxRetries) {
      attempts++;
      log(`\n--- Attempt ${attempts} ---`);

      try {
        // Stage 1: Extract code
        log('📝 Extracting code...');
        const extractedCode = this.extractCode(currentInput, language);
        log(`✅ Extracted ${extractedCode.length} characters of code`);

        // Stage 2: Syntax validation
        log('🔍 Validating syntax...');
        const syntaxErrors = this.validateSyntax(extractedCode, language);
        
        if (syntaxErrors.length > 0) {
          log(`❌ Syntax errors found: ${syntaxErrors.length}`);
          syntaxErrors.forEach(error => log(`  - ${error}`));
          
          if (!retry || attempts >= this.maxRetries) {
            return {
              success: false,
              code: extractedCode,
              errors: syntaxErrors,
              warnings: [],
              stage: 'syntax'
            };
          }
          
          log('🔄 Retrying with error feedback...');
          currentInput = await this.retryWithFeedback(currentInput, syntaxErrors, model, language);
          continue;
        }
        log('✅ Syntax validation passed');

        // Stage 3: Security scan
        log('🔒 Scanning for security issues...');
        const securityWarnings = this.scanSecurity(extractedCode, language);
        if (securityWarnings.length > 0) {
          log(`⚠️  Security warnings found: ${securityWarnings.length}`);
          securityWarnings.forEach(warning => log(`  - ${warning}`));
        } else {
          log('✅ Security scan passed');
        }

        // Stage 4: Compile test
        log('⚙️  Testing compilation...');
        const compileResult = await this.compileTest(extractedCode, language);
        
        if (!compileResult.success) {
          log(`❌ Compilation failed: ${compileResult.errors.length} errors`);
          compileResult.errors.forEach(error => log(`  - ${error}`));
          
          if (!retry || attempts >= this.maxRetries) {
            return {
              success: false,
              code: extractedCode,
              errors: compileResult.errors,
              warnings: [...securityWarnings, ...compileResult.warnings],
              stage: 'compilation'
            };
          }
          
          log('🔄 Retrying with compilation errors...');
          currentInput = await this.retryWithFeedback(currentInput, compileResult.errors, model, language);
          continue;
        }
        log('✅ Compilation test passed');

        // Success!
        return {
          success: true,
          code: extractedCode,
          errors: [],
          warnings: [...securityWarnings, ...compileResult.warnings],
          stage: 'complete',
          attempts
        };

      } catch (error) {
        log(`❌ Pipeline error: ${error.message}`);
        
        if (!retry || attempts >= this.maxRetries) {
          return {
            success: false,
            code: null,
            errors: [error.message],
            warnings: [],
            stage: 'extraction'
          };
        }
        
        log('🔄 Retrying with extraction error...');
        try {
          currentInput = await this.retryWithFeedback(currentInput, [error.message], model, language);
        } catch (retryError) {
          return {
            success: false,
            code: null,
            errors: [error.message, retryError.message],
            warnings: [],
            stage: 'retry'
          };
        }
      }
    }

    return {
      success: false,
      code: null,
      errors: [`Maximum retries (${this.maxRetries}) exceeded`],
      warnings: [],
      stage: 'retry_exhausted'
    };
  }
}

// CLI interface
async function main() {
  const args = process.argv.slice(2);
  
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Code Validation Pipeline

Usage: node validate.mjs --input <file> --lang <language> [options]

Options:
  --input <file>     Input file containing LLM output
  --lang <language>  Target language (solidity, javascript, typescript, python)
  --output <file>    Output file for validated code
  --retry            Enable retry with error feedback
  --model <model>    Ollama model for retries (default: qwq:latest)
  --verbose          Verbose output
  --help             Show this help

Examples:
  node validate.mjs --input /tmp/qwq_output.txt --lang solidity --output validated.sol
  node validate.mjs --input raw.txt --lang solidity --retry --model qwq:latest
`);
    return;
  }

  const inputFile = args[args.indexOf('--input') + 1];
  const language = args[args.indexOf('--lang') + 1] || 'solidity';
  const outputFile = args.includes('--output') ? args[args.indexOf('--output') + 1] : null;
  const retry = args.includes('--retry');
  const model = args.includes('--model') ? args[args.indexOf('--model') + 1] : 'qwq:latest';
  const verbose = args.includes('--verbose');

  if (!inputFile) {
    console.error('❌ Input file is required. Use --input <file>');
    process.exit(1);
  }

  if (!fs.existsSync(inputFile)) {
    console.error(`❌ Input file not found: ${inputFile}`);
    process.exit(1);
  }

  const input = fs.readFileSync(inputFile, 'utf8');
  const validator = new CodeValidator();

  try {
    const result = await validator.validateCode(input, {
      language,
      retry,
      model,
      verbose
    });

    if (result.success) {
      console.log(`\n✅ Validation successful! (${result.attempts} attempts)`);
      
      if (result.warnings.length > 0) {
        console.log('\n⚠️  Warnings:');
        result.warnings.forEach(warning => console.log(`  - ${warning}`));
      }
      
      if (outputFile) {
        fs.writeFileSync(outputFile, result.code);
        console.log(`📝 Validated code saved to: ${outputFile}`);
      } else {
        console.log('\n📋 Validated code:');
        console.log('=' .repeat(50));
        console.log(result.code);
        console.log('=' .repeat(50));
      }
      
      process.exit(0);
    } else {
      console.log(`\n❌ Validation failed at stage: ${result.stage}`);
      
      if (result.errors.length > 0) {
        console.log('\n🔍 Errors:');
        result.errors.forEach(error => console.log(`  - ${error}`));
      }
      
      if (result.warnings.length > 0) {
        console.log('\n⚠️  Warnings:');
        result.warnings.forEach(warning => console.log(`  - ${warning}`));
      }
      
      if (result.code && outputFile) {
        // Save partial result for debugging
        const debugFile = outputFile.replace(/(\.[^.]+)?$/, '_debug$1');
        fs.writeFileSync(debugFile, result.code);
        console.log(`🐛 Partial code saved for debugging: ${debugFile}`);
      }
      
      process.exit(1);
    }
  } catch (error) {
    console.error(`💥 Unexpected error: ${error.message}`);
    process.exit(1);
  }
}

// Export for use as module
export { CodeValidator, main as cli };

// Run as CLI if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error(`💥 Fatal error: ${error.message}`);
    process.exit(1);
  });
}