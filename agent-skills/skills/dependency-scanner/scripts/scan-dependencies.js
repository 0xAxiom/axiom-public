#!/usr/bin/env node

/**
 * Dependency Scanner - Multi-language package manager scanner
 * Scans for outdated dependencies, security vulnerabilities, and maintenance issues
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

class DependencyScanner {
    constructor(options = {}) {
        this.targetDir = options.dir || process.cwd();
        this.includeSecurity = options.security || false;
        this.generateFix = options.fix || false;
        this.outputFile = options.output || null;
        this.packageType = options.type || null;
        this.severity = options.severity || 'medium';
        
        this.results = {
            summary: {},
            outdated: [],
            vulnerabilities: [],
            deprecated: [],
            updateCommands: []
        };
    }

    async scan() {
        console.log(`🔍 Scanning dependencies in: ${this.targetDir}`);
        
        const packageManagers = this.detectPackageManagers();
        
        if (packageManagers.length === 0) {
            console.log('❌ No package managers detected');
            return;
        }

        console.log(`📦 Detected: ${packageManagers.join(', ')}`);
        
        for (const pm of packageManagers) {
            if (this.packageType && pm !== this.packageType) continue;
            await this.scanPackageManager(pm);
        }

        this.generateSummary();
        
        if (this.outputFile) {
            this.exportResults();
        } else {
            this.displayResults();
        }
    }

    detectPackageManagers() {
        const managers = [];
        const files = fs.readdirSync(this.targetDir);
        
        if (files.includes('package.json')) managers.push('npm');
        if (files.includes('requirements.txt') || files.includes('setup.py') || files.includes('pyproject.toml')) {
            managers.push('pip');
        }
        if (files.includes('Cargo.toml')) managers.push('cargo');
        if (files.includes('go.mod')) managers.push('go');
        if (files.includes('Gemfile')) managers.push('bundler');
        if (files.includes('composer.json')) managers.push('composer');
        if (files.includes('pom.xml') || files.includes('build.gradle')) managers.push('maven');
        
        return managers;
    }

    async scanPackageManager(manager) {
        try {
            switch (manager) {
                case 'npm':
                    await this.scanNpm();
                    break;
                case 'pip':
                    await this.scanPip();
                    break;
                case 'cargo':
                    await this.scanCargo();
                    break;
                case 'go':
                    await this.scanGo();
                    break;
                case 'bundler':
                    await this.scanBundler();
                    break;
                default:
                    console.log(`⚠️  ${manager} scanning not implemented yet`);
            }
        } catch (error) {
            console.log(`❌ Error scanning ${manager}: ${error.message}`);
        }
    }

    async scanNpm() {
        try {
            // Check for outdated packages
            const outdatedOutput = execSync('npm outdated --json', { 
                cwd: this.targetDir,
                encoding: 'utf8'
            });
            
            if (outdatedOutput.trim()) {
                const outdated = JSON.parse(outdatedOutput);
                for (const [name, info] of Object.entries(outdated)) {
                    this.results.outdated.push({
                        manager: 'npm',
                        name,
                        current: info.current,
                        wanted: info.wanted,
                        latest: info.latest,
                        type: info.type || 'dependencies'
                    });
                }
            }
        } catch (error) {
            // npm outdated exits with code 1 when outdated packages found
            if (error.stdout) {
                try {
                    const outdated = JSON.parse(error.stdout);
                    for (const [name, info] of Object.entries(outdated)) {
                        this.results.outdated.push({
                            manager: 'npm',
                            name,
                            current: info.current,
                            wanted: info.wanted,
                            latest: info.latest,
                            type: info.type || 'dependencies'
                        });
                    }
                } catch (parseError) {
                    // Ignore parse errors
                }
            }
        }

        // Security audit
        if (this.includeSecurity) {
            try {
                const auditOutput = execSync('npm audit --json', {
                    cwd: this.targetDir,
                    encoding: 'utf8'
                });
                
                const audit = JSON.parse(auditOutput);
                if (audit.vulnerabilities) {
                    for (const [name, vuln] of Object.entries(audit.vulnerabilities)) {
                        if (this.meetsSeverityThreshold(vuln.severity)) {
                            this.results.vulnerabilities.push({
                                manager: 'npm',
                                name,
                                severity: vuln.severity,
                                title: vuln.via?.[0]?.title || 'Unknown vulnerability',
                                fixAvailable: vuln.fixAvailable
                            });
                        }
                    }
                }
            } catch (error) {
                // npm audit can exit with non-zero code
                if (error.stdout) {
                    try {
                        const audit = JSON.parse(error.stdout);
                        if (audit.vulnerabilities) {
                            for (const [name, vuln] of Object.entries(audit.vulnerabilities)) {
                                if (this.meetsSeverityThreshold(vuln.severity)) {
                                    this.results.vulnerabilities.push({
                                        manager: 'npm',
                                        name,
                                        severity: vuln.severity,
                                        title: vuln.via?.[0]?.title || 'Unknown vulnerability',
                                        fixAvailable: vuln.fixAvailable
                                    });
                                }
                            }
                        }
                    } catch (parseError) {
                        // Ignore parse errors
                    }
                }
            }
        }

        // Generate update commands
        if (this.generateFix) {
            this.results.updateCommands.push('# NPM Updates');
            this.results.outdated
                .filter(dep => dep.manager === 'npm')
                .forEach(dep => {
                    this.results.updateCommands.push(`npm install ${dep.name}@${dep.latest}`);
                });
        }
    }

    async scanPip() {
        try {
            // Check for outdated packages
            const outdatedOutput = execSync('pip list --outdated --format=json', {
                cwd: this.targetDir,
                encoding: 'utf8'
            });
            
            const outdated = JSON.parse(outdatedOutput);
            outdated.forEach(pkg => {
                this.results.outdated.push({
                    manager: 'pip',
                    name: pkg.name,
                    current: pkg.version,
                    latest: pkg.latest_version,
                    type: 'dependencies'
                });
            });

            // Generate update commands
            if (this.generateFix) {
                this.results.updateCommands.push('# PIP Updates');
                outdated.forEach(pkg => {
                    this.results.updateCommands.push(`pip install --upgrade ${pkg.name}`);
                });
            }
        } catch (error) {
            console.log(`⚠️  Could not scan pip packages: ${error.message}`);
        }
    }

    async scanCargo() {
        try {
            // Check for outdated packages
            const outdatedOutput = execSync('cargo outdated --format json', {
                cwd: this.targetDir,
                encoding: 'utf8'
            });
            
            const outdated = JSON.parse(outdatedOutput);
            if (outdated.dependencies) {
                outdated.dependencies.forEach(dep => {
                    this.results.outdated.push({
                        manager: 'cargo',
                        name: dep.name,
                        current: dep.project,
                        latest: dep.latest,
                        type: 'dependencies'
                    });
                });
            }

            // Generate update commands
            if (this.generateFix) {
                this.results.updateCommands.push('# Cargo Updates');
                this.results.updateCommands.push('cargo update');
            }
        } catch (error) {
            console.log(`⚠️  Could not scan Cargo packages (cargo-outdated required): ${error.message}`);
        }
    }

    async scanGo() {
        try {
            // Check for available updates
            const listOutput = execSync('go list -u -m all', {
                cwd: this.targetDir,
                encoding: 'utf8'
            });
            
            const lines = listOutput.split('\n').filter(line => line.includes('[') && line.includes(']'));
            lines.forEach(line => {
                const match = line.match(/^(.+?)\s+(.+?)\s+\[(.+?)\]$/);
                if (match) {
                    const [, name, current, latest] = match;
                    this.results.outdated.push({
                        manager: 'go',
                        name,
                        current,
                        latest,
                        type: 'dependencies'
                    });
                }
            });

            // Generate update commands
            if (this.generateFix) {
                this.results.updateCommands.push('# Go Updates');
                this.results.updateCommands.push('go get -u all');
                this.results.updateCommands.push('go mod tidy');
            }
        } catch (error) {
            console.log(`⚠️  Could not scan Go modules: ${error.message}`);
        }
    }

    async scanBundler() {
        try {
            // Check for outdated gems
            const outdatedOutput = execSync('bundle outdated --parseable', {
                cwd: this.targetDir,
                encoding: 'utf8'
            });
            
            const lines = outdatedOutput.split('\n').filter(line => line.trim());
            lines.forEach(line => {
                const parts = line.split(' ');
                if (parts.length >= 4) {
                    this.results.outdated.push({
                        manager: 'bundler',
                        name: parts[0],
                        current: parts[2].replace('(', '').replace(')', ''),
                        latest: parts[3].replace('(', '').replace(')', ''),
                        type: 'dependencies'
                    });
                }
            });

            // Generate update commands
            if (this.generateFix) {
                this.results.updateCommands.push('# Bundler Updates');
                this.results.updateCommands.push('bundle update');
            }
        } catch (error) {
            console.log(`⚠️  Could not scan Bundler gems: ${error.message}`);
        }
    }

    meetsSeverityThreshold(severity) {
        const levels = { 'low': 1, 'moderate': 2, 'high': 3, 'critical': 4 };
        const threshold = levels[this.severity] || 2;
        return (levels[severity] || 0) >= threshold;
    }

    generateSummary() {
        this.results.summary = {
            totalOutdated: this.results.outdated.length,
            totalVulnerabilities: this.results.vulnerabilities.length,
            totalDeprecated: this.results.deprecated.length,
            highSeverityVulns: this.results.vulnerabilities.filter(v => v.severity === 'high' || v.severity === 'critical').length
        };
    }

    displayResults() {
        console.log('\n📊 DEPENDENCY SCAN RESULTS');
        console.log('================================');
        
        console.log(`📦 Outdated packages: ${this.results.summary.totalOutdated}`);
        console.log(`🛡️  Security vulnerabilities: ${this.results.summary.totalVulnerabilities}`);
        console.log(`⚠️  High/Critical vulnerabilities: ${this.results.summary.highSeverityVulns}`);
        
        if (this.results.outdated.length > 0) {
            console.log('\n📦 OUTDATED PACKAGES:');
            this.results.outdated.forEach(dep => {
                console.log(`  ${dep.name} (${dep.manager}): ${dep.current} → ${dep.latest}`);
            });
        }

        if (this.results.vulnerabilities.length > 0) {
            console.log('\n🛡️  SECURITY VULNERABILITIES:');
            this.results.vulnerabilities.forEach(vuln => {
                console.log(`  ${vuln.name} [${vuln.severity.toUpperCase()}]: ${vuln.title}`);
            });
        }

        if (this.generateFix && this.results.updateCommands.length > 0) {
            console.log('\n🔧 UPDATE COMMANDS:');
            this.results.updateCommands.forEach(cmd => {
                console.log(`  ${cmd}`);
            });
        }
    }

    exportResults() {
        fs.writeFileSync(this.outputFile, JSON.stringify(this.results, null, 2));
        console.log(`📄 Results exported to: ${this.outputFile}`);
    }
}

// CLI interface
if (require.main === module) {
    const args = process.argv.slice(2);
    const options = {
        dir: args.find(arg => !arg.startsWith('--')) || process.cwd(),
        security: args.includes('--security'),
        fix: args.includes('--fix'),
        output: args.find(arg => arg.startsWith('--output'))?.split('=')[1],
        type: args.find(arg => arg.startsWith('--type'))?.split('=')[1],
        severity: args.find(arg => arg.startsWith('--severity'))?.split('=')[1] || 'medium'
    };

    const scanner = new DependencyScanner(options);
    scanner.scan().catch(console.error);
}

module.exports = DependencyScanner;