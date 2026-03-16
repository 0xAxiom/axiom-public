# Notification Router 📢

Smart notification routing for AI agents with urgency-based escalation, timezone awareness, and multi-channel failover.

## Why This Matters

Agents need to notify humans intelligently - not every update is urgent, and sending alerts at 3 AM for routine tasks destroys trust. This skill provides:

- **Smart routing**: Different channels for different urgency levels
- **Timezone respect**: Quiet hours per recipient
- **Failover logic**: Try backup channels if primary fails
- **Emergency bypass**: Critical alerts always get through

## Quick Start

```bash
# Copy config template
cp config.sample.json config.json

# Edit with your credentials
vim config.json

# Test the routing
node scripts/test-routing.js --recipient melted

# Send a notification
node scripts/notify.js --message "Test alert" --recipient melted --urgency medium
```

## Configuration

Edit `config.json` with your channels and recipients:

```json
{
  "recipients": {
    "melted": {
      "timezone": "America/Los_Angeles",
      "quietHours": { "start": "23:00", "end": "08:00" },
      "channels": {
        "low": ["telegram"],
        "high": ["telegram", "email", "sms"]
      }
    }
  },
  "channels": {
    "telegram": {
      "enabled": true,
      "token": "YOUR_BOT_TOKEN",
      "chatId": "YOUR_CHAT_ID"
    }
  }
}
```

## Usage Examples

```bash
# Low priority update (respects quiet hours)
node scripts/notify.js \
  --message "Daily backup completed" \
  --recipient melted \
  --urgency low

# High priority alert
node scripts/notify.js \
  --message "Gas fees spiked above 200 gwei" \
  --recipient melted \
  --urgency high

# Emergency (bypasses quiet hours)
node scripts/notify.js \
  --message "CRITICAL: Wallet unauthorized access detected" \
  --recipient all \
  --urgency emergency

# Specific channels only
node scripts/notify.js \
  --message "Server maintenance in 1 hour" \
  --recipient team \
  --channels discord,telegram
```

## Urgency Levels

| Level | Description | Quiet Hours | Typical Channels |
|-------|-------------|-------------|------------------|
| `low` | Non-urgent updates | ✅ Respects | Telegram, Discord |
| `medium` | Important but can wait | ✅ Respects | Discord, Telegram |
| `high` | Urgent attention needed | ⚠️ May bypass | Telegram, Email |
| `emergency` | Critical system alerts | ❌ Always sends | All channels |

## Channel Setup

### Telegram Bot
1. Create bot via @BotFather
2. Get token and chat ID
3. Add to config

### Discord Webhook
1. Server Settings → Integrations → Webhooks
2. Create webhook, copy URL
3. Add to config

### Email (SMTP)
1. Generate app password (Gmail, Outlook, etc.)
2. Configure SMTP settings
3. Test with low-priority notification

## Integration

Use in your agent code:

```javascript
const { NotificationRouter } = require('./skills/notification-router/scripts/notify.js');

const router = new NotificationRouter();

// Simple alert
await router.notify({
  message: "Task completed",
  urgency: "low",
  recipient: "melted"
});

// Rich context
await router.notify({
  message: "High gas detected",
  urgency: "high", 
  recipient: "melted",
  context: {
    currentGas: "200 gwei",
    threshold: "100 gwei"
  }
});
```

## Best Practices

1. **Use appropriate urgency**: Low for updates, emergency for real crises
2. **Test your setup**: Run `test-routing.js` before deploying
3. **Respect quiet hours**: Only bypass for true emergencies
4. **Configure failover**: Multiple channels for important recipients
5. **Monitor delivery**: Check logs for failed notifications

## Troubleshooting

```bash
# Test configuration
node scripts/test-routing.js

# Check quiet hours logic
node scripts/test-routing.js --recipient melted

# Verify channel connectivity
node scripts/notify.js --message "Test" --recipient melted --urgency low
```

Common issues:
- **No delivery**: Check channel credentials in config
- **Wrong timing**: Verify timezone and quiet hours
- **Missing channels**: Ensure urgency level has configured channels
- **Permissions**: Bot needs send permissions in Discord/Telegram

## Dependencies

- Pure Node.js (no external packages required)
- fetch API (Node.js 18+)

Works with any OpenClaw agent setup - no additional installation needed.