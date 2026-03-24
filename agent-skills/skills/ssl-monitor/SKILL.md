# SSL Monitor

Monitor SSL certificate health, expiration dates, and domain status for agent-operated websites and APIs. Prevent certificate expiration outages with proactive monitoring and alerts.

## Usage

**Monitor certificates:**
```bash
# Check single domain
./scripts/check-ssl.js example.com

# Monitor from config file
./scripts/monitor-domains.js

# Check with custom warning threshold
./scripts/check-ssl.js example.com --days 30
```

**Setup monitoring:**
```bash
# Create domains config
cp config/domains.example.json config/domains.json
# Edit config/domains.json with your domains

# Add to cron (daily at 9 AM)
crontab -e
# Add: 0 9 * * * cd /path/to/ssl-monitor && node scripts/monitor-domains.js
```

## Triggers

Use this skill when:
- "SSL certificate expiring"
- "Check certificate status"  
- "Monitor domain health"
- "SSL certificate monitoring"
- "Certificate expiration alert"
- "Domain certificate check"
- Certificate-related outages or warnings

## Features

- **Certificate Expiration**: Check days until expiry
- **Domain Health**: Verify connectivity and response
- **Batch Monitoring**: Process multiple domains from config
- **Alert Thresholds**: Configurable warning periods (default: 30 days)
- **JSON Output**: Structured results for automation
- **Error Handling**: Graceful failures with detailed error messages
- **Zero Dependencies**: Pure Node.js, no external packages

## Configuration

Create `config/domains.json`:

```json
{
  "domains": [
    {
      "name": "example.com",
      "port": 443,
      "warningDays": 30
    },
    {
      "name": "api.example.com", 
      "port": 443,
      "warningDays": 14
    }
  ],
  "alertWebhook": "https://hooks.slack.com/...",
  "notifications": {
    "critical": 7,
    "warning": 30
  }
}
```

## Output Format

```json
{
  "domain": "example.com",
  "status": "valid",
  "daysUntilExpiry": 45,
  "expiryDate": "2026-05-08T23:59:59Z",
  "issuer": "Let's Encrypt Authority X3",
  "warning": false,
  "critical": false,
  "lastChecked": "2026-03-24T19:35:00Z"
}
```

## Integration

Perfect for:
- Agent-operated websites and APIs
- Automated certificate renewal workflows  
- Infrastructure health dashboards
- Compliance and uptime monitoring
- Production deployment pipelines

## Author

**Axiom** 🔬  
[@AxiomBot](https://x.com/AxiomBot) · [github.com/0xAxiom](https://github.com/0xAxiom/axiom-public)