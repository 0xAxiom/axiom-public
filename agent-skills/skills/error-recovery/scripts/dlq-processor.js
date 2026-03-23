#!/usr/bin/env node

/**
 * Dead Letter Queue Processor
 * Process, analyze, and reprocess failed operations
 */

const fs = require('fs');
const path = require('path');
const { getFailedOperations, configure, withRetry } = require('./error-recovery.js');

async function main() {
    const args = process.argv.slice(2);
    
    if (args.includes('--help') || args.length === 0) {
        console.log(`
Dead Letter Queue Processor

Usage:
  dlq-processor.js --list [--filter <pattern>]     # List failed operations
  dlq-processor.js --stats                         # Show DLQ statistics
  dlq-processor.js --reprocess [--filter <pattern>] [--dry-run]  # Reprocess operations
  dlq-processor.js --cleanup [--older-than <hours>]  # Clean old entries
  dlq-processor.js --export <file>                 # Export DLQ to JSON

Options:
  --filter       Filter operations by policy, error code, or message content
  --dry-run      Show what would be reprocessed without executing
  --older-than   Hours threshold for cleanup (default: 24)
  --limit        Maximum number of operations to process
  --config       Custom config file path

Examples:
  dlq-processor.js --list --filter "api"
  dlq-processor.js --stats
  dlq-processor.js --reprocess --filter "ETIMEDOUT" --dry-run
  dlq-processor.js --cleanup --older-than 72
        `);
        process.exit(0);
    }

    try {
        // Load custom config if provided
        const configIndex = args.indexOf('--config');
        if (configIndex !== -1 && configIndex + 1 < args.length) {
            const configPath = args[configIndex + 1];
            const config = require(require('path').resolve(configPath));
            configure(config);
        }

        if (args.includes('--list')) {
            const filterIndex = args.indexOf('--filter');
            const filter = filterIndex !== -1 && filterIndex + 1 < args.length ? 
                args[filterIndex + 1] : null;
            await listFailedOperations(filter);
        
        } else if (args.includes('--stats')) {
            await showStatistics();
        
        } else if (args.includes('--reprocess')) {
            const filterIndex = args.indexOf('--filter');
            const limitIndex = args.indexOf('--limit');
            const filter = filterIndex !== -1 && filterIndex + 1 < args.length ? 
                args[filterIndex + 1] : null;
            const limit = limitIndex !== -1 && limitIndex + 1 < args.length ? 
                parseInt(args[limitIndex + 1]) : null;
            const dryRun = args.includes('--dry-run');
            await reprocessOperations(filter, limit, dryRun);
        
        } else if (args.includes('--cleanup')) {
            const olderThanIndex = args.indexOf('--older-than');
            const hoursThreshold = olderThanIndex !== -1 && olderThanIndex + 1 < args.length ? 
                parseInt(args[olderThanIndex + 1]) : 24;
            const dryRun = args.includes('--dry-run');
            await cleanupOldEntries(hoursThreshold, dryRun);
        
        } else if (args.includes('--export')) {
            const exportIndex = args.indexOf('--export');
            if (exportIndex === -1 || exportIndex + 1 >= args.length) {
                console.error('Error: --export requires a filename');
                process.exit(1);
            }
            const filename = args[exportIndex + 1];
            await exportDLQ(filename);
        
        } else {
            console.error('Error: No valid action specified. Use --help for usage.');
            process.exit(1);
        }

    } catch (error) {
        console.error('Processor Error:', error.message);
        process.exit(1);
    }
}

async function listFailedOperations(filter = null) {
    console.log('Dead Letter Queue Operations:\n');
    
    const operations = await getFailedOperations(filter);
    
    if (operations.length === 0) {
        console.log('No failed operations found.');
        return;
    }

    console.log(`Found ${operations.length} operations${filter ? ` matching filter: ${filter}` : ''}:\n`);
    
    operations.forEach((op, index) => {
        const age = getAgeString(op.timestamp);
        console.log(`${(index + 1).toString().padStart(3)}. [${age}] ${op.policy}`);
        console.log(`     ID: ${op.id}`);
        console.log(`     Error: ${op.error.code} - ${op.error.message}`);
        if (op.operation.length > 0) {
            const truncated = op.operation.length > 100 ? 
                op.operation.substring(0, 100) + '...' : op.operation;
            console.log(`     Operation: ${truncated.replace(/\n/g, '\\n')}`);
        }
        console.log('');
    });
}

async function showStatistics() {
    console.log('Dead Letter Queue Statistics:\n');
    
    const operations = await getFailedOperations();
    
    if (operations.length === 0) {
        console.log('DLQ is empty.');
        return;
    }

    console.log(`Total Operations: ${operations.length}\n`);

    // Group by policy
    const byPolicy = operations.reduce((acc, op) => {
        acc[op.policy] = (acc[op.policy] || 0) + 1;
        return acc;
    }, {});

    console.log('By Policy:');
    Object.entries(byPolicy)
        .sort(([,a], [,b]) => b - a)
        .forEach(([policy, count]) => {
            const percentage = ((count / operations.length) * 100).toFixed(1);
            console.log(`  ${policy}: ${count} (${percentage}%)`);
        });

    // Group by error code
    const byErrorCode = operations.reduce((acc, op) => {
        acc[op.error.code] = (acc[op.error.code] || 0) + 1;
        return acc;
    }, {});

    console.log('\nBy Error Code:');
    Object.entries(byErrorCode)
        .sort(([,a], [,b]) => b - a)
        .slice(0, 10) // Top 10
        .forEach(([code, count]) => {
            const percentage = ((count / operations.length) * 100).toFixed(1);
            console.log(`  ${code}: ${count} (${percentage}%)`);
        });

    // Age distribution
    const now = new Date();
    const ageRanges = {
        '< 1 hour': 0,
        '1-6 hours': 0,
        '6-24 hours': 0,
        '1-7 days': 0,
        '> 7 days': 0
    };

    operations.forEach(op => {
        const ageHours = (now - new Date(op.timestamp)) / (1000 * 60 * 60);
        if (ageHours < 1) ageRanges['< 1 hour']++;
        else if (ageHours < 6) ageRanges['1-6 hours']++;
        else if (ageHours < 24) ageRanges['6-24 hours']++;
        else if (ageHours < 168) ageRanges['1-7 days']++;
        else ageRanges['> 7 days']++;
    });

    console.log('\nBy Age:');
    Object.entries(ageRanges).forEach(([range, count]) => {
        if (count > 0) {
            const percentage = ((count / operations.length) * 100).toFixed(1);
            console.log(`  ${range}: ${count} (${percentage}%)`);
        }
    });

    // Recent failures (last 24 hours)
    const recentCount = operations.filter(op => {
        const ageHours = (now - new Date(op.timestamp)) / (1000 * 60 * 60);
        return ageHours < 24;
    }).length;

    console.log(`\nRecent Failures (24h): ${recentCount}`);
}

async function reprocessOperations(filter = null, limit = null, dryRun = false) {
    console.log(`${dryRun ? 'DRY RUN: ' : ''}Reprocessing failed operations...\n`);
    
    let operations = await getFailedOperations(filter);
    
    if (limit) {
        operations = operations.slice(0, limit);
    }

    if (operations.length === 0) {
        console.log('No operations to reprocess.');
        return;
    }

    console.log(`Found ${operations.length} operations to reprocess${filter ? ` (filter: ${filter})` : ''}:\n`);

    let successCount = 0;
    let failureCount = 0;

    for (const [index, op] of operations.entries()) {
        const progress = `[${index + 1}/${operations.length}]`;
        console.log(`${progress} Reprocessing ${op.id} (${op.policy})...`);

        if (dryRun) {
            console.log(`  Would retry: ${op.error.code} - ${op.error.message}`);
            continue;
        }

        try {
            // Attempt to recreate and retry the operation
            // Note: This is a simplified example - in practice, you'd need to
            // store more context about the original operation to properly retry it
            await withRetry(async () => {
                // Simulate the operation based on available information
                console.log(`  Simulating retry of operation: ${op.id}`);
                
                // If this was an HTTP error, we might try a basic health check
                if (op.error.code.match(/^\d{3}$/)) {
                    throw new Error(`Cannot automatically retry HTTP operation: ${op.error.code}`);
                }
                
                // For other errors, we can't safely retry without more context
                throw new Error(`Cannot automatically retry operation type: ${op.error.code}`);
            }, op.policy);

            console.log(`  ✅ Success`);
            successCount++;

        } catch (error) {
            console.log(`  ❌ Failed: ${error.message}`);
            failureCount++;
        }
    }

    if (!dryRun) {
        console.log(`\nReprocessing completed:`);
        console.log(`  Successful: ${successCount}`);
        console.log(`  Failed: ${failureCount}`);
        
        if (successCount > 0) {
            console.log(`\nNote: Successfully reprocessed operations should be removed from DLQ manually.`);
        }
    } else {
        console.log(`\nDry run completed. ${operations.length} operations would be attempted.`);
    }
}

async function cleanupOldEntries(hoursThreshold, dryRun = false) {
    console.log(`${dryRun ? 'DRY RUN: ' : ''}Cleaning up DLQ entries older than ${hoursThreshold} hours...\n`);

    const operations = await getFailedOperations();
    const now = new Date();
    const cutoff = new Date(now.getTime() - (hoursThreshold * 60 * 60 * 1000));

    const oldOperations = operations.filter(op => new Date(op.timestamp) < cutoff);

    if (oldOperations.length === 0) {
        console.log('No old operations to clean up.');
        return;
    }

    console.log(`Found ${oldOperations.length} old operations to remove:`);
    
    oldOperations.forEach(op => {
        const age = getAgeString(op.timestamp);
        console.log(`  ${op.id} (${age}) - ${op.error.code}`);
    });

    if (dryRun) {
        console.log(`\nDry run completed. ${oldOperations.length} operations would be removed.`);
        return;
    }

    // Remove old operations
    const remainingOperations = operations.filter(op => new Date(op.timestamp) >= cutoff);
    
    // This is a simplified cleanup - in practice, you'd update the actual DLQ file
    console.log(`\n✅ Would remove ${oldOperations.length} old operations, keeping ${remainingOperations.length}.`);
    console.log('Note: Actual cleanup requires modifying the DLQ persistence layer.');
}

async function exportDLQ(filename) {
    console.log(`Exporting Dead Letter Queue to ${filename}...\n`);

    const operations = await getFailedOperations();
    
    if (operations.length === 0) {
        console.log('DLQ is empty, nothing to export.');
        return;
    }

    const exportData = {
        exportedAt: new Date().toISOString(),
        totalOperations: operations.length,
        operations: operations.map(op => ({
            ...op,
            age: getAgeString(op.timestamp)
        }))
    };

    try {
        await fs.promises.writeFile(filename, JSON.stringify(exportData, null, 2));
        console.log(`✅ Exported ${operations.length} operations to ${filename}`);
        
        const stats = await fs.promises.stat(filename);
        console.log(`File size: ${(stats.size / 1024).toFixed(1)} KB`);
        
    } catch (error) {
        console.error('Export failed:', error.message);
        process.exit(1);
    }
}

function getAgeString(timestamp) {
    const now = new Date();
    const then = new Date(timestamp);
    const ageMs = now - then;
    
    const minutes = Math.floor(ageMs / (1000 * 60));
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    
    if (days > 0) return `${days}d ago`;
    if (hours > 0) return `${hours}h ago`;
    if (minutes > 0) return `${minutes}m ago`;
    return 'just now';
}

if (require.main === module) {
    main().catch(error => {
        console.error('Unexpected error:', error);
        process.exit(1);
    });
}

module.exports = { 
    main, 
    listFailedOperations, 
    showStatistics, 
    reprocessOperations, 
    cleanupOldEntries, 
    exportDLQ 
};