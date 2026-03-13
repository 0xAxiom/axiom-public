#!/usr/bin/env node

/**
 * Log Analyzer - Parse agent logs for errors, performance, and anomalies
 * Usage: node analyze-logs.js --file app.log [options]
 */

const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const readFile = promisify(fs.readFile);
const readdir = promisify(fs.readdir);
const stat = promisify(fs.stat);

class LogAnalyzer {
  constructor(options = {}) {
    this.options = {
      level: options.level || 'all', // all, error, warn, info, debug
      from: options.from ? new Date(options.from) : null,
      to: options.to ? new Date(options.to) : null,
      metrics: options.metrics || false,
      watch: options.watch || false,
      pattern: options.pattern || '*.log',
      output: options.output || null,
      ...options
    };
    
    this.stats = {
      totalLines: 0,
      errors: [],
      warnings: [],
      performance: [],
      hourlyCount: {},
      errorTypes: {},
      responseTimeStats: {
        times: [],
        avg: 0,
        p95: 0,
        p99: 0
      }
    };
  }

  // Parse different log formats
  parseLine(line) {
    line = line.trim();
    if (!line) return null;

    // Try JSON format first
    try {
      return JSON.parse(line);
    } catch {}

    // Try common log formats
    const patterns = {
      // Combined log format (Apache/Nginx)
      combined: /^(\S+) \S+ \S+ \[([^\]]+)\] "(\S+) ([^"]*)" (\d+) (\d+|-) "([^"]*)" "([^"]*)"/,
      // Custom timestamp format
      timestamp: /^(\d{4}-\d{2}-\d{2}[\sT]\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z?)\s+(\w+)\s+(.+)$/,
      // Simple level format
      level: /^(\w+):\s*(.+)$/
    };

    for (const [format, regex] of Object.entries(patterns)) {
      const match = line.match(regex);
      if (match) {
        switch (format) {
          case 'combined':
            return {
              ip: match[1],
              timestamp: new Date(match[2]),
              method: match[3],
              path: match[4],
              status: parseInt(match[5]),
              size: match[6] === '-' ? 0 : parseInt(match[6]),
              referer: match[7],
              userAgent: match[8]
            };
          case 'timestamp':
            return {
              timestamp: new Date(match[1]),
              level: match[2].toLowerCase(),
              message: match[3]
            };
          case 'level':
            return {
              level: match[1].toLowerCase(),
              message: match[2],
              timestamp: new Date()
            };
        }
      }
    }

    // Fallback: treat as plain message
    return {
      message: line,
      level: 'info',
      timestamp: new Date()
    };
  }

  // Check if log entry matches filters
  matchesFilters(entry) {
    // Level filter
    if (this.options.level !== 'all' && entry.level !== this.options.level) {
      return false;
    }

    // Date range filter
    if (this.options.from && entry.timestamp < this.options.from) {
      return false;
    }
    if (this.options.to && entry.timestamp > this.options.to) {
      return false;
    }

    return true;
  }

  // Extract performance metrics
  extractPerformance(entry) {
    const message = entry.message || '';
    
    // Look for response time patterns
    const timePatterns = [
      /(\d+)ms/,
      /(\d+\.\d+)s/,
      /response_time[:\s]+(\d+)/,
      /duration[:\s]+(\d+)/,
      /took[:\s]+(\d+)ms/
    ];

    for (const pattern of timePatterns) {
      const match = message.match(pattern);
      if (match) {
        let time = parseFloat(match[1]);
        // Convert seconds to ms
        if (message.includes('s') && !message.includes('ms')) {
          time *= 1000;
        }
        this.stats.responseTimeStats.times.push(time);
        this.stats.performance.push({
          timestamp: entry.timestamp,
          responseTime: time,
          message: message
        });
        break;
      }
    }
  }

  // Categorize errors
  categorizeError(entry) {
    const message = (entry.message || '').toLowerCase();
    let category = 'unknown';

    const categories = {
      'network': ['timeout', 'connection', 'socket', 'network', 'dns'],
      'auth': ['unauthorized', 'forbidden', 'auth', 'login', 'token'],
      'database': ['sql', 'database', 'query', 'connection pool'],
      'api': ['api', 'http', '404', '500', 'endpoint'],
      'validation': ['validation', 'invalid', 'missing', 'required'],
      'memory': ['memory', 'out of memory', 'heap', 'malloc'],
      'file': ['file', 'path', 'directory', 'permission']
    };

    for (const [cat, keywords] of Object.entries(categories)) {
      if (keywords.some(keyword => message.includes(keyword))) {
        category = cat;
        break;
      }
    }

    this.stats.errorTypes[category] = (this.stats.errorTypes[category] || 0) + 1;
    return category;
  }

  // Analyze a single log entry
  analyzeEntry(entry) {
    if (!this.matchesFilters(entry)) return;

    this.stats.totalLines++;

    // Track hourly distribution
    const hour = entry.timestamp.getHours();
    this.stats.hourlyCount[hour] = (this.stats.hourlyCount[hour] || 0) + 1;

    // Process by log level
    switch (entry.level) {
      case 'error':
        const category = this.categorizeError(entry);
        this.stats.errors.push({
          ...entry,
          category
        });
        break;
      case 'warn':
      case 'warning':
        this.stats.warnings.push(entry);
        break;
    }

    // Extract performance data
    if (this.options.metrics) {
      this.extractPerformance(entry);
    }
  }

  // Calculate performance statistics
  calculateStats() {
    const times = this.stats.responseTimeStats.times;
    if (times.length === 0) return;

    times.sort((a, b) => a - b);
    
    this.stats.responseTimeStats.avg = times.reduce((a, b) => a + b, 0) / times.length;
    this.stats.responseTimeStats.p95 = times[Math.floor(times.length * 0.95)];
    this.stats.responseTimeStats.p99 = times[Math.floor(times.length * 0.99)];
  }

  // Generate analysis report
  generateReport() {
    this.calculateStats();

    const report = {
      summary: {
        totalLines: this.stats.totalLines,
        errors: this.stats.errors.length,
        warnings: this.stats.warnings.length,
        analyzed: new Date().toISOString()
      },
      errors: {
        total: this.stats.errors.length,
        byCategory: this.stats.errorTypes,
        recent: this.stats.errors.slice(-5).map(e => ({
          timestamp: e.timestamp.toISOString(),
          message: e.message,
          category: e.category
        }))
      },
      performance: this.options.metrics ? {
        responseTime: {
          average: Math.round(this.stats.responseTimeStats.avg),
          p95: Math.round(this.stats.responseTimeStats.p95),
          p99: Math.round(this.stats.responseTimeStats.p99),
          samples: this.stats.responseTimeStats.times.length
        }
      } : null,
      patterns: {
        hourlyDistribution: this.stats.hourlyCount,
        peakHour: Object.entries(this.stats.hourlyCount)
          .sort(([,a], [,b]) => b - a)[0]?.[0]
      }
    };

    return report;
  }

  // Analyze log file
  async analyzeFile(filePath) {
    try {
      const content = await readFile(filePath, 'utf8');
      const lines = content.split('\n');

      console.log(`Analyzing ${lines.length} lines from ${filePath}...`);

      for (const line of lines) {
        const entry = this.parseLine(line);
        if (entry) {
          this.analyzeEntry(entry);
        }
      }

      return this.generateReport();
    } catch (error) {
      throw new Error(`Failed to analyze ${filePath}: ${error.message}`);
    }
  }

  // Analyze multiple files in directory
  async analyzeDirectory(dirPath) {
    try {
      const files = await readdir(dirPath);
      const logFiles = files.filter(f => 
        f.endsWith('.log') || f.endsWith('.txt')
      );

      console.log(`Found ${logFiles.length} log files in ${dirPath}`);

      for (const file of logFiles) {
        await this.analyzeFile(path.join(dirPath, file));
      }

      return this.generateReport();
    } catch (error) {
      throw new Error(`Failed to analyze directory ${dirPath}: ${error.message}`);
    }
  }
}

// CLI interface
async function main() {
  const args = process.argv.slice(2);
  const options = {};

  // Parse command line arguments
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i].replace(/^--/, '');
    const value = args[i + 1];
    
    if (['metrics', 'watch'].includes(key)) {
      options[key] = true;
      i--; // Boolean flags don't have values
    } else {
      options[key] = value;
    }
  }

  if (!options.file && !options.dir) {
    console.error('Usage: node analyze-logs.js --file app.log [options]');
    console.error('Options:');
    console.error('  --file <path>     Log file to analyze');
    console.error('  --dir <path>      Directory of log files');
    console.error('  --level <level>   Filter by level (error, warn, info, debug)');
    console.error('  --from <date>     Start date (YYYY-MM-DD)');
    console.error('  --to <date>       End date (YYYY-MM-DD)');
    console.error('  --metrics         Include performance metrics');
    console.error('  --output <file>   Save report to file');
    process.exit(1);
  }

  try {
    const analyzer = new LogAnalyzer(options);
    
    let report;
    if (options.file) {
      report = await analyzer.analyzeFile(options.file);
    } else if (options.dir) {
      report = await analyzer.analyzeDirectory(options.dir);
    }

    // Output report
    if (options.output) {
      fs.writeFileSync(options.output, JSON.stringify(report, null, 2));
      console.log(`Report saved to ${options.output}`);
    } else {
      console.log('\n=== LOG ANALYSIS REPORT ===');
      console.log(JSON.stringify(report, null, 2));
    }

  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = LogAnalyzer;