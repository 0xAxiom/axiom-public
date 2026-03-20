#!/usr/bin/env node

/**
 * Config Validator - Standalone configuration validation
 * Advanced validation rules and schema checking
 */

const fs = require('fs');

class ConfigValidator {
  constructor(schema = {}) {
    this.schema = schema;
  }

  // Validate configuration against comprehensive schema
  validate(config) {
    const errors = [];
    const warnings = [];
    
    this.validateRequired(config, errors);
    this.validateTypes(config, errors);
    this.validateRanges(config, errors);
    this.validateFormats(config, errors);
    this.validateDependencies(config, errors);
    this.checkSecurity(config, warnings);
    
    return {
      valid: errors.length === 0,
      errors,
      warnings
    };
  }

  // Check required fields
  validateRequired(config, errors) {
    if (!this.schema.required) return;
    
    for (const path of this.schema.required) {
      if (this.getNestedValue(config, path) === undefined) {
        errors.push(`Required field missing: ${path}`);
      }
    }
  }

  // Check data types
  validateTypes(config, errors) {
    if (!this.schema.types) return;
    
    for (const [path, expectedType] of Object.entries(this.schema.types)) {
      const value = this.getNestedValue(config, path);
      if (value !== undefined) {
        const actualType = this.getValueType(value);
        if (actualType !== expectedType) {
          errors.push(`Type mismatch for ${path}: expected ${expectedType}, got ${actualType}`);
        }
      }
    }
  }

  // Check value ranges
  validateRanges(config, errors) {
    if (!this.schema.ranges) return;
    
    for (const [path, range] of Object.entries(this.schema.ranges)) {
      const value = this.getNestedValue(config, path);
      if (typeof value === 'number') {
        if (range.min !== undefined && value < range.min) {
          errors.push(`${path} value ${value} below minimum ${range.min}`);
        }
        if (range.max !== undefined && value > range.max) {
          errors.push(`${path} value ${value} above maximum ${range.max}`);
        }
      }
    }
  }

  // Check format patterns
  validateFormats(config, errors) {
    if (!this.schema.formats) return;
    
    for (const [path, pattern] of Object.entries(this.schema.formats)) {
      const value = this.getNestedValue(config, path);
      if (typeof value === 'string') {
        const regex = new RegExp(pattern);
        if (!regex.test(value)) {
          errors.push(`${path} format invalid: ${value} does not match ${pattern}`);
        }
      }
    }
  }

  // Check field dependencies
  validateDependencies(config, errors) {
    if (!this.schema.dependencies) return;
    
    for (const [path, deps] of Object.entries(this.schema.dependencies)) {
      const value = this.getNestedValue(config, path);
      if (value !== undefined) {
        for (const depPath of deps) {
          if (this.getNestedValue(config, depPath) === undefined) {
            errors.push(`${path} requires ${depPath} to be set`);
          }
        }
      }
    }
  }

  // Security checks
  checkSecurity(config, warnings) {
    this.checkForSecrets(config, warnings);
    this.checkPermissions(config, warnings);
    this.checkNetworkSettings(config, warnings);
  }

  // Check for exposed secrets
  checkForSecrets(config, warnings, prefix = '') {
    for (const [key, value] of Object.entries(config)) {
      const path = prefix ? `${prefix}.${key}` : key;
      
      if (typeof value === 'string') {
        // Check for common secret patterns
        if (this.looksLikeSecret(key, value)) {
          warnings.push(`Potential secret exposed in plain text: ${path}`);
        }
      } else if (typeof value === 'object' && value !== null) {
        this.checkForSecrets(value, warnings, path);
      }
    }
  }

  // Check if key/value looks like a secret
  looksLikeSecret(key, value) {
    const secretKeys = /^(password|secret|key|token|auth|credential|api_key)$/i;
    const secretPatterns = [
      /^sk-[a-zA-Z0-9]{32,}$/, // OpenAI-style
      /^[0-9a-f]{32,}$/, // Hex tokens
      /^[A-Za-z0-9+/]{40,}={0,2}$/ // Base64 tokens
    ];
    
    if (secretKeys.test(key)) return true;
    
    return secretPatterns.some(pattern => pattern.test(value));
  }

  // Check permission settings
  checkPermissions(config, warnings) {
    const perms = this.getNestedValue(config, 'permissions');
    if (perms) {
      if (perms.world_readable) {
        warnings.push('World-readable permissions enabled');
      }
      if (perms.allow_all) {
        warnings.push('Permissive access control enabled');
      }
    }
  }

  // Check network configuration
  checkNetworkSettings(config, warnings) {
    const host = this.getNestedValue(config, 'server.host');
    if (host === '0.0.0.0') {
      warnings.push('Server bound to all interfaces (0.0.0.0)');
    }
    
    const ssl = this.getNestedValue(config, 'ssl.enabled');
    if (ssl === false) {
      warnings.push('SSL/TLS disabled');
    }
  }

  // Get nested value using dot notation
  getNestedValue(obj, path) {
    return path.split('.').reduce((current, key) => 
      (current && current[key] !== undefined) ? current[key] : undefined, obj);
  }

  // Get accurate type of value
  getValueType(value) {
    if (Array.isArray(value)) return 'array';
    if (value === null) return 'null';
    return typeof value;
  }

  // Load schema from file
  static loadSchema(schemaPath) {
    try {
      const content = fs.readFileSync(schemaPath, 'utf8');
      return JSON.parse(content);
    } catch (error) {
      throw new Error(`Failed to load schema: ${error.message}`);
    }
  }
}

// CLI interface
async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0 || args.includes('--help')) {
    console.log(`
Config Validator - Advanced configuration validation

Usage:
  config-validator.js [config-file] [options]

Options:
  --schema file        Use custom validation schema
  --strict             Treat warnings as errors
  --format json|text   Output format

Examples:
  config-validator.js config.json
  config-validator.js config.json --schema schema.json --strict
    `);
    return;
  }

  const configFile = args[0] || 'config.json';
  const schemaFile = args.includes('--schema') ? 
    args[args.indexOf('--schema') + 1] : null;
  const strict = args.includes('--strict');
  const format = args.includes('--format') ? 
    args[args.indexOf('--format') + 1] : 'json';

  try {
    // Load configuration
    if (!fs.existsSync(configFile)) {
      throw new Error(`Configuration file not found: ${configFile}`);
    }
    
    const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
    
    // Load schema
    let schema = {};
    if (schemaFile) {
      schema = ConfigValidator.loadSchema(schemaFile);
    } else {
      // Default schema for common patterns
      schema = {
        required: ['database.host'],
        types: {
          'database.port': 'number',
          'debug': 'boolean',
          'ssl.enabled': 'boolean'
        },
        ranges: {
          'database.port': { min: 1, max: 65535 },
          'server.port': { min: 1000, max: 65535 }
        },
        formats: {
          'database.host': '^[a-zA-Z0-9.-]+$',
          'email': '^[^@]+@[^@]+\\.[^@]+$'
        }
      };
    }
    
    // Validate
    const validator = new ConfigValidator(schema);
    const result = validator.validate(config);
    
    if (format === 'text') {
      console.log(`Validation ${result.valid ? 'PASSED' : 'FAILED'}`);
      if (result.errors.length > 0) {
        console.log('\nErrors:');
        result.errors.forEach(error => console.log(`  ❌ ${error}`));
      }
      if (result.warnings.length > 0) {
        console.log('\nWarnings:');
        result.warnings.forEach(warning => console.log(`  ⚠️  ${warning}`));
      }
    } else {
      console.log(JSON.stringify(result, null, 2));
    }
    
    // Exit with error code if validation failed or strict mode with warnings
    if (!result.valid || (strict && result.warnings.length > 0)) {
      process.exit(1);
    }
    
  } catch (error) {
    console.error(JSON.stringify({
      valid: false,
      errors: [error.message],
      warnings: []
    }, null, 2));
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = ConfigValidator;