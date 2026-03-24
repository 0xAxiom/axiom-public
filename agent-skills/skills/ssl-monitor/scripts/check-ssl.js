#!/usr/bin/env node

const tls = require('tls');
const https = require('https');

/**
 * Check SSL certificate for a domain
 * @param {string} domain - Domain to check
 * @param {number} port - Port to check (default: 443)
 * @param {number} warningDays - Days before expiry to warn (default: 30)
 */
async function checkSSL(domain, port = 443, warningDays = 30) {
  return new Promise((resolve, reject) => {
    const options = {
      host: domain,
      port: port,
      servername: domain,
      rejectUnauthorized: false, // We want to check expired certs too
      timeout: 10000
    };

    const socket = tls.connect(options, () => {
      try {
        const cert = socket.getPeerCertificate();
        const now = new Date();
        const expiry = new Date(cert.valid_to);
        const daysUntilExpiry = Math.ceil((expiry - now) / (1000 * 60 * 60 * 24));
        
        const result = {
          domain: domain,
          port: port,
          status: daysUntilExpiry > 0 ? 'valid' : 'expired',
          daysUntilExpiry: daysUntilExpiry,
          expiryDate: cert.valid_to,
          issuer: cert.issuer?.CN || 'Unknown',
          subject: cert.subject?.CN || domain,
          warning: daysUntilExpiry <= warningDays && daysUntilExpiry > 7,
          critical: daysUntilExpiry <= 7,
          lastChecked: now.toISOString(),
          fingerprint: cert.fingerprint
        };

        socket.end();
        resolve(result);
      } catch (error) {
        socket.end();
        reject(new Error(`Certificate parsing error: ${error.message}`));
      }
    });

    socket.on('error', (error) => {
      reject(new Error(`Connection error: ${error.message}`));
    });

    socket.on('timeout', () => {
      socket.end();
      reject(new Error('Connection timeout'));
    });
  });
}

/**
 * Check domain accessibility
 * @param {string} domain - Domain to check
 * @param {number} port - Port to check (default: 443)
 */
async function checkDomainHealth(domain, port = 443) {
  return new Promise((resolve) => {
    const options = {
      hostname: domain,
      port: port,
      path: '/',
      method: 'HEAD',
      timeout: 5000,
      rejectUnauthorized: false
    };

    const req = https.request(options, (res) => {
      resolve({
        accessible: true,
        statusCode: res.statusCode,
        responseTime: Date.now() - startTime
      });
    });

    const startTime = Date.now();

    req.on('error', (error) => {
      resolve({
        accessible: false,
        error: error.message,
        responseTime: Date.now() - startTime
      });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({
        accessible: false,
        error: 'Request timeout',
        responseTime: Date.now() - startTime
      });
    });

    req.end();
  });
}

// CLI Interface
async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.error('Usage: node check-ssl.js <domain> [--port <port>] [--days <warning_days>]');
    console.error('Example: node check-ssl.js example.com --port 443 --days 30');
    process.exit(1);
  }

  const domain = args[0];
  let port = 443;
  let warningDays = 30;

  // Parse arguments
  for (let i = 1; i < args.length; i += 2) {
    if (args[i] === '--port' && args[i + 1]) {
      port = parseInt(args[i + 1]);
    } else if (args[i] === '--days' && args[i + 1]) {
      warningDays = parseInt(args[i + 1]);
    }
  }

  try {
    console.log(`Checking SSL certificate for ${domain}:${port}...`);
    
    // Check SSL certificate
    const sslResult = await checkSSL(domain, port, warningDays);
    
    // Check domain health
    const healthResult = await checkDomainHealth(domain, port);
    
    const result = {
      ...sslResult,
      health: healthResult
    };

    console.log(JSON.stringify(result, null, 2));

    // Exit with error code if certificate is critical or expired
    if (result.critical || result.status === 'expired') {
      console.error(`CRITICAL: Certificate ${result.status === 'expired' ? 'expired' : `expires in ${result.daysUntilExpiry} days`}`);
      process.exit(2);
    } else if (result.warning) {
      console.error(`WARNING: Certificate expires in ${result.daysUntilExpiry} days`);
      process.exit(1);
    }

  } catch (error) {
    console.error('Error checking SSL certificate:', error.message);
    process.exit(3);
  }
}

if (require.main === module) {
  main();
}

module.exports = { checkSSL, checkDomainHealth };