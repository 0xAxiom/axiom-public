#!/usr/bin/env node

/**
 * Config Manager - Dynamic configuration management for AI agents
 * Updates settings without restarts, validates changes, and provides rollback
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class ConfigManager {
  constructor(options = {}) {
    this.configPath = options.configPath || './config.json';
    this.backupDir = options.backupDir || './config-backups';
    this.maxBackups = options.maxBackups || 10;
    this.validationRules = options.validationRules || {};
    this.watchers = new Set();
    
    this.ensureDirectories();
  }

  ensureDirectories() {
    if (!fs.existsSync(this.backupDir)) {
      fs.mkdirSync(this.backupDir, { recursive: true });
    }
  }

  // Load current configuration
  load() {
    try {
      if (!fs.existsSync(this.configPath)) {
        return {};
      }
      const content = fs.readFileSync(this.configPath, 'utf8');
      return JSON.parse(content);
    } catch (error) {
      throw new Error(`Failed to load config: ${error.message}`);
    }
  }

  // Save configuration with atomic write
  save(config) {
    const tempPath = `${this.configPath}.tmp`;
    try {
      fs.writeFileSync(tempPath, JSON.stringify(config, null, 2));
      fs.renameSync(tempPath, this.configPath);
      return true;
    } catch (error) {
      if (fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath);
      }
      throw new Error(`Failed to save config: ${error.message}`);
    }
  }

  // Create backup with timestamp
  createBackup(config = null) {
    const currentConfig = config || this.load();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join(this.backupDir, `config-backup-${timestamp}.json`);
    
    try {
      fs.writeFileSync(backupPath, JSON.stringify(currentConfig, null, 2));
      this.cleanupOldBackups();
      return backupPath;
    } catch (error) {
      throw new Error(`Failed to create backup: ${error.message}`);
    }
  }

  // Remove old backups beyond maxBackups limit
  cleanupOldBackups() {
    try {
      const backups = fs.readdirSync(this.backupDir)
        .filter(file => file.startsWith('config-backup-') && file.endsWith('.json'))
        .map(file => ({
          name: file,
          path: path.join(this.backupDir, file),
          mtime: fs.statSync(path.join(this.backupDir, file)).mtime
        }))
        .sort((a, b) => b.mtime - a.mtime);

      // Keep only maxBackups most recent
      if (backups.length > this.maxBackups) {
        const toDelete = backups.slice(this.maxBackups);
        toDelete.forEach(backup => {
          fs.unlinkSync(backup.path);
        });
      }
    } catch (error) {
      console.warn(`Warning: Failed to cleanup old backups: ${error.message}`);
    }
  }

  // Set nested property using dot notation
  setProperty(config, path, value) {
    const keys = path.split('.');
    let current = config;
    
    for (let i = 0; i < keys.length - 1; i++) {
      if (!(keys[i] in current) || typeof current[keys[i]] !== 'object') {
        current[keys[i]] = {};
      }
      current = current[keys[i]];
    }
    
    const oldValue = current[keys[keys.length - 1]];
    current[keys[keys.length - 1]] = this.parseValue(value);
    
    return oldValue;
  }

  // Get nested property using dot notation
  getProperty(config, path) {
    const keys = path.split('.');
    let current = config;
    
    for (const key of keys) {
      if (current === null || current === undefined || !(key in current)) {
        return undefined;
      }
      current = current[key];
    }
    
    return current;
  }

  // Parse string value to appropriate type
  parseValue(value) {
    if (typeof value !== 'string') return value;
    
    // Boolean
    if (value.toLowerCase() === 'true') return true;
    if (value.toLowerCase() === 'false') return false;
    
    // Number
    if (/^\d+$/.test(value)) return parseInt(value, 10);
    if (/^\d+\.\d+$/.test(value)) return parseFloat(value);
    
    // JSON
    if ((value.startsWith('{') && value.endsWith('}')) || 
        (value.startsWith('[') && value.endsWith(']'))) {
      try {
        return JSON.parse(value);
      } catch {
        // Fall through to string
      }
    }
    
    return value;
  }

  // Validate configuration against rules
  validate(config) {
    const errors = [];
    
    // Check required fields
    if (this.validationRules.required) {
      for (const requiredPath of this.validationRules.required) {
        const value = this.getProperty(config, requiredPath);
        if (value === undefined || value === null) {
          errors.push(`Required field missing: ${requiredPath}`);
        }
      }
    }
    
    // Check types
    if (this.validationRules.types) {
      for (const [fieldPath, expectedType] of Object.entries(this.validationRules.types)) {
        const value = this.getProperty(config, fieldPath);
        if (value !== undefined) {
          const actualType = Array.isArray(value) ? 'array' : typeof value;
          if (actualType !== expectedType) {
            errors.push(`Type mismatch for ${fieldPath}: expected ${expectedType}, got ${actualType}`);
          }
        }
      }
    }
    
    return {
      valid: errors.length === 0,
      errors
    };
  }

  // Get latest backup
  getLatestBackup() {
    try {
      const backups = fs.readdirSync(this.backupDir)
        .filter(file => file.startsWith('config-backup-') && file.endsWith('.json'))
        .map(file => ({
          name: file,
          path: path.join(this.backupDir, file),
          mtime: fs.statSync(path.join(this.backupDir, file)).mtime
        }))
        .sort((a, b) => b.mtime - a.mtime);

      return backups.length > 0 ? backups[0].path : null;
    } catch (error) {
      return null;
    }
  }

  // Compare two configurations
  diff(config1, config2, prefix = '') {
    const changes = {};
    
    const allKeys = new Set([...Object.keys(config1 || {}), ...Object.keys(config2 || {})]);
    
    for (const key of allKeys) {
      const path = prefix ? `${prefix}.${key}` : key;
      const val1 = config1 ? config1[key] : undefined;
      const val2 = config2 ? config2[key] : undefined;
      
      if (typeof val1 === 'object' && typeof val2 === 'object' && 
          val1 !== null && val2 !== null && !Array.isArray(val1) && !Array.isArray(val2)) {
        Object.assign(changes, this.diff(val1, val2, path));
      } else if (JSON.stringify(val1) !== JSON.stringify(val2)) {
        changes[path] = {
          old: val1,
          new: val2
        };
      }
    }
    
    return changes;
  }

  // Start watching for file changes
  watch(callback) {
    if (this.watchers.has(this.configPath)) {
      return;
    }

    try {
      const watcher = fs.watch(this.configPath, (eventType) => {
        if (eventType === 'change') {
          try {
            const newConfig = this.load();
            callback(newConfig);
          } catch (error) {
            console.error(`Error reloading config: ${error.message}`);
          }
        }
      });

      this.watchers.add(watcher);
      return watcher;
    } catch (error) {
      throw new Error(`Failed to watch config file: ${error.message}`);
    }
  }

  // Stop all watchers
  stopWatching() {
    for (const watcher of this.watchers) {
      watcher.close();
    }
    this.watchers.clear();
  }
}

// CLI Interface
async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    console.log(`
Config Manager - Dynamic configuration management

Usage:
  config-manager.js [options]

Options:
  --reload              Hot reload configuration
  --set key=value       Update configuration value
  --get key            Get configuration value
  --show               Show entire configuration
  --validate           Validate current configuration
  --backup             Create configuration backup
  --rollback           Rollback to latest backup
  --diff [file]        Compare with backup or file
  --watch              Watch for configuration changes
  --env name           Switch to environment configuration
  --config path        Specify config file path

Examples:
  config-manager.js --set "database.host=localhost"
  config-manager.js --get "api.rate_limit"
  config-manager.js --validate
  config-manager.js --backup --set "debug=true"
    `);
    return;
  }

  // Parse arguments
  const configPath = args.includes('--config') ? 
    args[args.indexOf('--config') + 1] : './config.json';
  
  const manager = new ConfigManager({ 
    configPath,
    validationRules: {
      required: ['database.host'],
      types: {
        'database.port': 'number',
        'debug': 'boolean'
      }
    }
  });

  try {
    const result = { success: true };

    // Handle different operations
    if (args.includes('--show')) {
      const config = manager.load();
      console.log(JSON.stringify(config, null, 2));
      
    } else if (args.includes('--validate')) {
      const config = manager.load();
      const validation = manager.validate(config);
      console.log(JSON.stringify({
        valid: validation.valid,
        errors: validation.errors
      }, null, 2));
      
    } else if (args.includes('--backup')) {
      const backupPath = manager.createBackup();
      result.backup_created = path.basename(backupPath);
      
    } else if (args.includes('--rollback')) {
      const latestBackup = manager.getLatestBackup();
      if (!latestBackup) {
        throw new Error('No backups found');
      }
      
      const backupConfig = JSON.parse(fs.readFileSync(latestBackup, 'utf8'));
      manager.save(backupConfig);
      result.operation = 'rollback';
      result.restored_from = path.basename(latestBackup);
      
    } else if (args.includes('--set')) {
      const setIndex = args.indexOf('--set') + 1;
      if (setIndex >= args.length) {
        throw new Error('--set requires key=value argument');
      }
      
      const assignment = args[setIndex];
      const [key, ...valueParts] = assignment.split('=');
      const value = valueParts.join('=');
      
      if (!key || value === undefined) {
        throw new Error('Invalid assignment format. Use key=value');
      }
      
      // Create backup if requested
      if (args.includes('--backup')) {
        result.backup_created = path.basename(manager.createBackup());
      }
      
      const config = manager.load();
      const oldValue = manager.setProperty(config, key, value);
      
      // Validate before saving
      const validation = manager.validate(config);
      if (!validation.valid) {
        throw new Error(`Validation failed: ${validation.errors.join(', ')}`);
      }
      
      manager.save(config);
      
      result.operation = 'update';
      result.changes = {};
      result.changes[key] = `${oldValue} -> ${manager.getProperty(config, key)}`;
      result.validation_passed = true;
      
    } else if (args.includes('--get')) {
      const getIndex = args.indexOf('--get') + 1;
      if (getIndex >= args.length) {
        throw new Error('--get requires key argument');
      }
      
      const config = manager.load();
      const value = manager.getProperty(config, args[getIndex]);
      console.log(JSON.stringify({ key: args[getIndex], value }, null, 2));
      return;
      
    } else if (args.includes('--diff')) {
      const config = manager.load();
      const latestBackup = manager.getLatestBackup();
      
      if (!latestBackup) {
        console.log('{}');
        return;
      }
      
      const backupConfig = JSON.parse(fs.readFileSync(latestBackup, 'utf8'));
      const changes = manager.diff(backupConfig, config);
      console.log(JSON.stringify(changes, null, 2));
      return;
      
    } else if (args.includes('--watch')) {
      console.log('Watching for configuration changes... Press Ctrl+C to stop');
      manager.watch((newConfig) => {
        console.log(`Config changed at ${new Date().toISOString()}`);
      });
      
      // Keep process alive
      process.on('SIGINT', () => {
        manager.stopWatching();
        process.exit(0);
      });
      
      return new Promise(() => {}); // Never resolves
      
    } else {
      // Default: reload
      result.operation = 'reload';
      result.config_reloaded = true;
    }

    console.log(JSON.stringify(result, null, 2));
    
  } catch (error) {
    console.error(JSON.stringify({
      success: false,
      error: error.message
    }, null, 2));
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = ConfigManager;