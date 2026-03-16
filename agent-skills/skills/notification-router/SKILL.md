# notification-router

Smart notification routing for AI agents across multiple channels with urgency-based escalation and timezone awareness.

## Triggers
Use this skill when you need to send notifications, alerts, or messages and want intelligent routing based on urgency, user preferences, time zones, or channel availability.

## Usage

```bash
# Send notification with auto-routing
node scripts/notify.js --message "Alert: High gas fees detected" --urgency high --recipient melted

# Send to specific channel with fallback
node scripts/notify.js --message "Daily report ready" --channels discord,telegram --recipient team

# Silent hours aware notification
node scripts/notify.js --message "Non-urgent update" --urgency low --respect-quiet-hours

# Emergency notification (bypasses quiet hours)
node scripts/notify.js --message "CRITICAL: Wallet drained" --urgency emergency --recipient all

# Test notification routing
node scripts/test-routing.js --recipient melted
```

## Installation

```bash
# Copy to skills directory
cp -r notification-router ~/.clawdbot/skills/

# Install dependencies
cd ~/.clawdbot/skills/notification-router
npm install
```

## Configuration

Create `config.json` in the skill directory:

```json
{
  "recipients": {
    "melted": {
      "timezone": "America/Los_Angeles",
      "quietHours": { "start": "23:00", "end": "08:00" },
      "channels": {
        "low": ["telegram"],
        "medium": ["discord", "telegram"],
        "high": ["telegram", "email"],
        "emergency": ["telegram", "discord", "email", "sms"]
      }
    },
    "team": {
      "channels": {
        "low": ["discord"],
        "medium": ["discord"],
        "high": ["discord", "telegram"],
        "emergency": ["discord", "telegram", "email"]
      }
    }
  },
  "channels": {
    "telegram": {
      "enabled": true,
      "token": "TELEGRAM_BOT_TOKEN",
      "chatId": "CHAT_ID"
    },
    "discord": {
      "enabled": true,
      "webhookUrl": "DISCORD_WEBHOOK_URL"
    },
    "email": {
      "enabled": false,
      "smtp": {
        "host": "smtp.gmail.com",
        "port": 587,
        "auth": {
          "user": "your-email@gmail.com",
          "pass": "app-password"
        }
      }
    },
    "sms": {
      "enabled": false,
      "provider": "twilio",
      "accountSid": "TWILIO_ACCOUNT_SID",
      "authToken": "TWILIO_AUTH_TOKEN",
      "fromNumber": "+1234567890"
    }
  }
}
```

## Features

- **Urgency-based routing**: Different channels for low/medium/high/emergency notifications
- **Timezone awareness**: Respects quiet hours per recipient
- **Channel failover**: Tries backup channels if primary fails
- **Rate limiting**: Prevents spam with configurable cooldowns
- **Message formatting**: Auto-formats for each channel type
- **Delivery confirmation**: Tracks successful deliveries
- **Emergency bypass**: Critical alerts ignore quiet hours
- **Batch notifications**: Send to multiple recipients efficiently

## Urgency Levels

- `low`: Non-urgent updates, respects quiet hours
- `medium`: Important but can wait, respects quiet hours
- `high`: Urgent, may bypass quiet hours depending on config
- `emergency`: Critical alerts, always bypass quiet hours

## Examples

```javascript
// In your agent code
const { notify } = require('./skills/notification-router/scripts/notify.js');

// Simple notification
await notify({
  message: "Task completed successfully",
  urgency: "low",
  recipient: "melted"
});

// Rich notification with context
await notify({
  message: "Gas fees spiked to 200 gwei",
  urgency: "high",
  recipient: "melted",
  context: {
    currentGas: "200 gwei",
    threshold: "100 gwei",
    action: "Pausing automated transactions"
  }
});

// Broadcast to team
await notify({
  message: "Weekly report generated",
  urgency: "medium",
  recipient: ["melted", "team"],
  attachment: "./reports/weekly-summary.pdf"
});
```

This skill helps agents be better team members by routing notifications intelligently instead of spamming users with every update.