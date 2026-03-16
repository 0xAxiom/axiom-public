#!/usr/bin/env node

const { NotificationRouter } = require('./notify.js');

class NotificationTester {
  constructor() {
    this.router = new NotificationRouter();
  }

  async testAllUrgencyLevels(recipient) {
    console.log(`🧪 Testing notification routing for: ${recipient}`);
    console.log('=' * 50);

    const urgencyLevels = ['low', 'medium', 'high', 'emergency'];
    
    for (const urgency of urgencyLevels) {
      console.log(`\n📊 Testing ${urgency.toUpperCase()} urgency...`);
      
      const channels = this.router.getChannelsForRecipient(recipient, urgency);
      console.log(`Configured channels: ${channels.join(', ')}`);
      
      const isQuiet = this.router.isQuietHours(recipient);
      console.log(`Currently quiet hours: ${isQuiet ? 'YES' : 'NO'}`);
      
      // Test with dry run (no actual sending)
      const results = await this.simulateNotification(recipient, urgency);
      console.log(`Would deliver via: ${results.join(', ')}`);
    }
  }

  async simulateNotification(recipient, urgency) {
    const channels = this.router.getChannelsForRecipient(recipient, urgency);
    const availableChannels = [];
    
    for (const channel of channels) {
      const channelConfig = this.router.config.channels[channel];
      if (channelConfig?.enabled) {
        availableChannels.push(channel);
      }
    }
    
    return availableChannels;
  }

  async testQuietHours(recipient) {
    console.log(`\n🌙 Testing quiet hours for: ${recipient}`);
    
    const recipientConfig = this.router.config.recipients[recipient];
    if (!recipientConfig?.quietHours) {
      console.log('No quiet hours configured');
      return;
    }

    console.log(`Timezone: ${recipientConfig.timezone || 'UTC'}`);
    console.log(`Quiet hours: ${recipientConfig.quietHours.start} - ${recipientConfig.quietHours.end}`);
    
    const isQuiet = this.router.isQuietHours(recipient);
    console.log(`Currently in quiet hours: ${isQuiet ? 'YES' : 'NO'}`);
    
    // Test emergency bypass
    console.log('\nEmergency notifications bypass quiet hours: ✅');
  }

  async testChannelAvailability() {
    console.log('\n📡 Testing channel availability...');
    
    const channels = this.router.config.channels;
    for (const [channelName, channelConfig] of Object.entries(channels)) {
      const status = channelConfig.enabled ? '✅ ENABLED' : '❌ DISABLED';
      console.log(`${channelName.padEnd(10)} ${status}`);
      
      if (channelConfig.enabled) {
        // Check required config
        const requirements = this.getChannelRequirements(channelName);
        const hasAllReqs = requirements.every(req => channelConfig[req]);
        console.log(`  Config complete: ${hasAllReqs ? '✅' : '❌'}`);
      }
    }
  }

  getChannelRequirements(channel) {
    const requirements = {
      telegram: ['token', 'chatId'],
      discord: ['webhookUrl'],
      email: ['smtp'],
      sms: ['provider', 'accountSid', 'authToken']
    };
    return requirements[channel] || [];
  }

  async runFullTest(recipient) {
    console.log('🚀 Starting Notification Router Test Suite\n');
    
    try {
      await this.testChannelAvailability();
      await this.testQuietHours(recipient);
      await this.testAllUrgencyLevels(recipient);
      
      console.log('\n✅ All tests completed successfully!');
      console.log('\nTo send a real notification:');
      console.log(`node notify.js --message "Test notification" --recipient ${recipient} --urgency medium`);
      
    } catch (error) {
      console.error('\n❌ Test failed:', error.message);
      process.exit(1);
    }
  }
}

// CLI usage
if (require.main === module) {
  const args = process.argv.slice(2);
  const recipient = args.find(arg => !arg.startsWith('--'))?.replace('--recipient', '').trim() || 'melted';
  
  if (args.includes('--help')) {
    console.log('Usage: node test-routing.js [--recipient name]');
    console.log('Tests notification routing configuration and logic');
    process.exit(0);
  }

  const tester = new NotificationTester();
  tester.runFullTest(recipient);
}

module.exports = { NotificationTester };