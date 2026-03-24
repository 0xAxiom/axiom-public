# SSL Monitor 🔒

Monitor SSL certificate health and expiration dates for agent-operated websites and APIs. Prevent certificate-related outages with proactive monitoring and alerts.

## Features

- **Certificate Expiration Monitoring** - Track days until expiry for multiple domains
- **Domain Health Checks** - Verify connectivity and response times  
- **Configurable Alerts** - Set custom warning thresholds per domain
- **Batch Processing** - Monitor multiple domains from JSON configuration
- **Webhook Integration** - Send alerts to Slack or other services
- **Report Generation** - JSON reports with historical tracking
- **Zero Dependencies** - Pure Node.js implementation

## Quick Start

1. **Copy example config:**
   ```bash
   cp config/domains.example.json config/domains.json
   ```

2. **Edit your domains:**
   ```bash
   nano config/domains.json
   ```

3. **Run monitoring:**
   ```bash
   # Check single domain
   node scripts/check-ssl.js example.com
   
   # Monitor all configured domains
   node scripts/monitor-domains.js
   ```

4. **Schedule monitoring:**
   ```bash
   # Add to crontab for daily checks at 9 AM
   0 9 * * * cd /path/to/ssl-monitor && node scripts/monitor-domains.js
   ```

## Configuration

The `config/domains.json` file supports:

- **domains**: Array of domains to monitor
- **alertWebhook**: Slack webhook URL for notifications
- **notifications**: Alert threshold settings
- **reporting**: Report generation and retention settings

Each domain can specify:
- **name**: Domain name (required)
- **port**: Port to check (default: 443)  
- **warningDays**: Days before expiry to alert (default: 30)

## Output

Results are provided in structured JSON format:

```json
{
  "domain": "example.com",
  "status": "valid",
  "daysUntilExpiry": 45,
  "expiryDate": "2026-05-08T23:59:59Z",
  "issuer": "Let's Encrypt Authority X3",
  "warning": false,
  "critical": false,
  "health": {
    "accessible": true,
    "statusCode": 200,
    "responseTime": 234
  }
}
```

## Exit Codes

- **0**: All certificates healthy
- **1**: Warnings found (approaching expiry)
- **2**: Critical issues (expired or expiring soon)
- **3**: Connection/parsing errors

## Use Cases

Perfect for:
- Agent-operated websites and APIs
- Infrastructure health monitoring
- Compliance and audit requirements  
- Automated certificate renewal workflows
- Production deployment pipelines
- Multi-domain certificate management

## Author

**Axiom** 🔬  
[@AxiomBot](https://x.com/AxiomBot) · [github.com/0xAxiom](https://github.com/0xAxiom/axiom-public)