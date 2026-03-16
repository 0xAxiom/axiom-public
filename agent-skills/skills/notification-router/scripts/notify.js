#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

class NotificationRouter {
  constructor(configPath = '../config.json') {
    this.configPath = path.resolve(__dirname, configPath);
    this.config = this.loadConfig();
    this.deliveryLog = [];
  }

  loadConfig() {
    try {
      if (!fs.existsSync(this.configPath)) {
        console.error('Config file not found. Create config.json in the skill directory.');
        process.exit(1);
      }
      return JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
    } catch (error) {
      console.error('Error loading config:', error.message);
      process.exit(1);
    }
  }

  isQuietHours(recipient) {
    const recipientConfig = this.config.recipients[recipient];
    if (!recipientConfig?.quietHours) return false;

    const now = new Date();
    const timezone = recipientConfig.timezone || 'UTC';
    
    // Convert to recipient's timezone
    const localTime = new Date(now.toLocaleString("en-US", {timeZone: timezone}));
    const hour = localTime.getHours();
    const minute = localTime.getMinutes();
    const currentTime = hour * 60 + minute;

    const start = this.parseTime(recipientConfig.quietHours.start);
    const end = this.parseTime(recipientConfig.quietHours.end);

    if (start < end) {
      return currentTime >= start && currentTime < end;
    } else {
      // Quiet hours cross midnight
      return currentTime >= start || currentTime < end;
    }
  }

  parseTime(timeStr) {
    const [hour, minute] = timeStr.split(':').map(Number);
    return hour * 60 + minute;
  }

  getChannelsForRecipient(recipient, urgency) {
    const recipientConfig = this.config.recipients[recipient];
    if (!recipientConfig) {
      console.error(`Recipient ${recipient} not found in config`);
      return [];
    }

    return recipientConfig.channels[urgency] || [];
  }

  async sendToChannel(channel, message, context = {}) {
    const channelConfig = this.config.channels[channel];
    if (!channelConfig?.enabled) {
      throw new Error(`Channel ${channel} is not enabled`);
    }

    try {
      switch (channel) {
        case 'telegram':
          return await this.sendTelegram(channelConfig, message);
        case 'discord':
          return await this.sendDiscord(channelConfig, message, context);
        case 'email':
          return await this.sendEmail(channelConfig, message);
        case 'sms':
          return await this.sendSMS(channelConfig, message);
        default:
          throw new Error(`Unknown channel: ${channel}`);
      }
    } catch (error) {
      throw new Error(`${channel} delivery failed: ${error.message}`);
    }
  }

  async sendTelegram(config, message) {
    if (!config.token || !config.chatId) {
      throw new Error('Telegram token and chatId required');
    }

    const url = `https://api.telegram.org/bot${config.token}/sendMessage`;
    const payload = {
      chat_id: config.chatId,
      text: message,
      parse_mode: 'Markdown'
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.description || 'Telegram API error');
    }

    return { success: true, channel: 'telegram' };
  }

  async sendDiscord(config, message, context) {
    if (!config.webhookUrl) {
      throw new Error('Discord webhook URL required');
    }

    const embed = {
      title: '📢 Agent Notification',
      description: message,
      color: this.getUrgencyColor(context.urgency),
      timestamp: new Date().toISOString(),
      footer: {
        text: 'Notification Router'
      }
    };

    if (context.urgency) {
      embed.fields = [{
        name: 'Urgency',
        value: context.urgency.toUpperCase(),
        inline: true
      }];
    }

    const payload = { embeds: [embed] };

    const response = await fetch(config.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error(`Discord webhook failed: ${response.status}`);
    }

    return { success: true, channel: 'discord' };
  }

  async sendEmail(config, message) {
    // Placeholder - would need actual SMTP implementation
    console.log(`[EMAIL] ${message}`);
    return { success: true, channel: 'email' };
  }

  async sendSMS(config, message) {
    // Placeholder - would need Twilio implementation
    console.log(`[SMS] ${message}`);
    return { success: true, channel: 'sms' };
  }

  getUrgencyColor(urgency) {
    const colors = {
      low: 0x95A5A6,     // Gray
      medium: 0xF39C12,   // Orange
      high: 0xE74C3C,     // Red
      emergency: 0x8E44AD // Purple
    };
    return colors[urgency] || colors.medium;
  }

  async notify({ message, urgency = 'medium', recipient, channels = null, respectQuietHours = true, context = {} }) {
    const recipients = Array.isArray(recipient) ? recipient : [recipient];
    const results = [];

    for (const rec of recipients) {
      if (rec === 'all') {
        // Send to all configured recipients
        const allRecipients = Object.keys(this.config.recipients);
        for (const allRec of allRecipients) {
          const result = await this.sendToRecipient(allRec, message, urgency, channels, respectQuietHours, context);
          results.push(...result);
        }
      } else {
        const result = await this.sendToRecipient(rec, message, urgency, channels, respectQuietHours, context);
        results.push(...result);
      }
    }

    return results;
  }

  async sendToRecipient(recipient, message, urgency, channels, respectQuietHours, context) {
    const results = [];
    
    // Check quiet hours
    if (respectQuietHours && urgency !== 'emergency' && this.isQuietHours(recipient)) {
      console.log(`Skipping notification to ${recipient} - quiet hours (urgency: ${urgency})`);
      return [{
        recipient,
        success: false,
        reason: 'quiet_hours',
        urgency
      }];
    }

    // Get channels to try
    const channelsToTry = channels || this.getChannelsForRecipient(recipient, urgency);
    
    if (channelsToTry.length === 0) {
      console.error(`No channels configured for ${recipient} at ${urgency} urgency`);
      return [{
        recipient,
        success: false,
        reason: 'no_channels',
        urgency
      }];
    }

    // Try each channel until one succeeds
    let delivered = false;
    for (const channel of channelsToTry) {
      try {
        const result = await this.sendToChannel(channel, message, { ...context, urgency });
        console.log(`✅ Delivered to ${recipient} via ${channel}`);
        results.push({
          recipient,
          channel,
          success: true,
          urgency,
          timestamp: new Date().toISOString()
        });
        delivered = true;
        break; // Stop trying other channels
      } catch (error) {
        console.warn(`❌ Failed to deliver to ${recipient} via ${channel}: ${error.message}`);
        results.push({
          recipient,
          channel,
          success: false,
          error: error.message,
          urgency
        });
      }
    }

    if (!delivered) {
      console.error(`🚨 Failed to deliver to ${recipient} via any channel`);
    }

    return results;
  }
}

// CLI usage
if (require.main === module) {
  const args = process.argv.slice(2);
  const options = {};
  
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i].replace('--', '');
    const value = args[i + 1];
    
    if (key === 'channels') {
      options[key] = value.split(',');
    } else if (key === 'respect-quiet-hours') {
      options.respectQuietHours = value === 'true';
    } else {
      options[key] = value;
    }
  }

  if (!options.message || !options.recipient) {
    console.error('Usage: node notify.js --message "text" --recipient name [--urgency level] [--channels list]');
    process.exit(1);
  }

  const router = new NotificationRouter();
  router.notify(options).then(results => {
    console.log('\nDelivery Results:');
    console.log(JSON.stringify(results, null, 2));
  }).catch(error => {
    console.error('Notification failed:', error.message);
    process.exit(1);
  });
}

module.exports = { NotificationRouter };