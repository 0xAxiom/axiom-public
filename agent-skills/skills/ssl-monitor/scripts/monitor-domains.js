#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { checkSSL, checkDomainHealth } = require('./check-ssl.js');

/**
 * Monitor multiple domains from configuration file
 */
async function monitorDomains() {
  const configPath = path.join(__dirname, '..', 'config', 'domains.json');
  
  if (!fs.existsSync(configPath)) {
    console.error('Configuration file not found:', configPath);
    console.error('Create config/domains.json using config/domains.example.json as template');
    process.exit(1);
  }

  let config;
  try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (error) {
    console.error('Error reading config file:', error.message);
    process.exit(1);
  }

  if (!config.domains || !Array.isArray(config.domains)) {
    console.error('Invalid config: domains array required');
    process.exit(1);
  }

  const results = [];
  const errors = [];
  let criticalCount = 0;
  let warningCount = 0;

  console.log(`Monitoring ${config.domains.length} domains...`);

  for (const domain of config.domains) {
    const { name, port = 443, warningDays = 30 } = domain;
    
    try {
      console.log(`Checking ${name}:${port}...`);
      
      const sslResult = await checkSSL(name, port, warningDays);
      const healthResult = await checkDomainHealth(name, port);
      
      const result = {
        ...sslResult,
        health: healthResult
      };
      
      results.push(result);
      
      if (result.critical || result.status === 'expired') {
        criticalCount++;
        console.error(`❌ CRITICAL: ${name} - ${result.status === 'expired' ? 'Certificate expired' : `${result.daysUntilExpiry} days until expiry`}`);
      } else if (result.warning) {
        warningCount++;
        console.warn(`⚠️  WARNING: ${name} - ${result.daysUntilExpiry} days until expiry`);
      } else {
        console.log(`✅ OK: ${name} - ${result.daysUntilExpiry} days until expiry`);
      }
      
    } catch (error) {
      errors.push({
        domain: name,
        port: port,
        error: error.message,
        timestamp: new Date().toISOString()
      });
      console.error(`❌ ERROR: ${name} - ${error.message}`);
    }
  }

  // Summary
  console.log('\n=== SUMMARY ===');
  console.log(`Total domains: ${config.domains.length}`);
  console.log(`✅ Healthy: ${results.length - criticalCount - warningCount}`);
  console.log(`⚠️  Warnings: ${warningCount}`);
  console.log(`❌ Critical: ${criticalCount}`);
  console.log(`💥 Errors: ${errors.length}`);

  // Save results
  const reportPath = path.join(__dirname, '..', 'reports', `ssl-report-${new Date().toISOString().split('T')[0]}.json`);
  const reportData = {
    timestamp: new Date().toISOString(),
    summary: {
      total: config.domains.length,
      healthy: results.length - criticalCount - warningCount,
      warnings: warningCount,
      critical: criticalCount,
      errors: errors.length
    },
    results: results,
    errors: errors
  };

  // Ensure reports directory exists
  const reportsDir = path.dirname(reportPath);
  if (!fs.existsSync(reportsDir)) {
    fs.mkdirSync(reportsDir, { recursive: true });
  }

  fs.writeFileSync(reportPath, JSON.stringify(reportData, null, 2));
  console.log(`\nReport saved: ${reportPath}`);

  // Send webhook notification if configured and there are issues
  if (config.alertWebhook && (criticalCount > 0 || warningCount > 0 || errors.length > 0)) {
    await sendWebhookAlert(config.alertWebhook, reportData.summary, results.filter(r => r.critical || r.warning));
  }

  // Exit with appropriate code
  if (criticalCount > 0 || errors.length > 0) {
    process.exit(2);
  } else if (warningCount > 0) {
    process.exit(1);
  }
}

/**
 * Send webhook alert for issues
 * @param {string} webhookUrl - Webhook URL to send alert to
 * @param {object} summary - Summary statistics
 * @param {array} issues - Array of domains with issues
 */
async function sendWebhookAlert(webhookUrl, summary, issues) {
  try {
    const https = require('https');
    const url = require('url');

    const payload = {
      text: `🚨 SSL Certificate Alert`,
      attachments: [{
        color: summary.critical > 0 ? 'danger' : 'warning',
        fields: [
          {
            title: 'Summary',
            value: `Critical: ${summary.critical}, Warnings: ${summary.warnings}, Errors: ${summary.errors}`,
            short: true
          },
          {
            title: 'Issues',
            value: issues.map(issue => 
              `• ${issue.domain}: ${issue.status === 'expired' ? 'EXPIRED' : `${issue.daysUntilExpiry} days`}`
            ).join('\n'),
            short: false
          }
        ],
        timestamp: Math.floor(Date.now() / 1000)
      }]
    };

    const parsedUrl = url.parse(webhookUrl);
    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || 443,
      path: parsedUrl.path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    };

    const req = https.request(options, (res) => {
      if (res.statusCode === 200) {
        console.log('✅ Webhook alert sent successfully');
      } else {
        console.error(`❌ Webhook failed with status ${res.statusCode}`);
      }
    });

    req.on('error', (error) => {
      console.error('❌ Webhook error:', error.message);
    });

    req.write(JSON.stringify(payload));
    req.end();

  } catch (error) {
    console.error('❌ Webhook alert failed:', error.message);
  }
}

if (require.main === module) {
  monitorDomains();
}

module.exports = { monitorDomains };