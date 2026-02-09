#!/usr/bin/env node

/**
 * Format social inbox as a Telegram-friendly summary.
 * Reads ~/clawd/data/social-inbox.json and outputs formatted text.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const INBOX_PATH = join(homedir(), 'clawd/data/social-inbox.json');

try {
  const data = JSON.parse(readFileSync(INBOX_PATH, 'utf8'));
  const top = data.items.filter(i => i.status === 'pending').slice(0, 5);

  if (top.length === 0) {
    console.log('📥 Social Inbox: Clear. No pending items.');
    process.exit(0);
  }

  let msg = `📥 Social Inbox (${data.itemCount} items, top ${top.length})\n\n`;

  for (const item of top) {
    const emoji = item.score >= 7 ? '🔴' : item.score >= 5 ? '🟡' : '🟢';
    msg += `${emoji} [${item.score}] ${item.author}\n`;
    msg += `${item.text.substring(0, 100)}${item.text.length > 100 ? '...' : ''}\n`;
    msg += `${item.url}\n\n`;
  }

  msg += `Last scan: ${new Date(data.lastScan).toLocaleString()}`;
  console.log(msg);
} catch (e) {
  console.error(`Error: ${e.message}`);
  process.exit(1);
}
