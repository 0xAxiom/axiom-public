// Configuration management

import type { Config } from './types.js';

export function loadConfig(): Config {
  return {
    github: {
      appId: process.env.GITHUB_APP_ID,
      privateKey: process.env.GITHUB_PRIVATE_KEY,
      webhookSecret: process.env.GITHUB_WEBHOOK_SECRET || 'dev-secret',
      token: process.env.GITHUB_TOKEN || '',
    },
    ollama: {
      host: process.env.OLLAMA_HOST || 'http://localhost:11434',
      models: {
        fast: 'deepseek-r1:latest',
        balanced: 'gemma3:27b',
        thorough: 'qwq:latest',
      },
    },
    review: {
      maxFiles: parseInt(process.env.MAX_FILES || '50'),
      maxTokensPerFile: parseInt(process.env.MAX_TOKENS || '4000'),
      timeoutSeconds: parseInt(process.env.TIMEOUT || '300'),
    },
  };
}

export const config = loadConfig();
