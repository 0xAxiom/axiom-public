// Model routing based on diff complexity

import type { FileDiff, ModelTier } from './types.js';
import { getTotalChanges } from './diff.js';
import { config } from './config.js';

const SECURITY_PATTERNS = [
  /auth/i,
  /password/i,
  /secret/i,
  /token/i,
  /credential/i,
  /private.*key/i,
  /api.*key/i,
  /encrypt/i,
  /decrypt/i,
  /hash/i,
  /salt/i,
  /permission/i,
  /role/i,
  /admin/i,
  /sudo/i,
  /root/i,
  /exec\(/i,
  /eval\(/i,
  /sql/i,
  /injection/i,
];

const COMPLEX_PATTERNS = [
  /async.*await/i,
  /promise/i,
  /callback/i,
  /thread/i,
  /mutex/i,
  /lock/i,
  /concurrent/i,
  /parallel/i,
  /transaction/i,
  /rollback/i,
];

function hasSecurityContent(files: FileDiff[]): boolean {
  for (const file of files) {
    // Check filename
    for (const pattern of SECURITY_PATTERNS) {
      if (pattern.test(file.path)) return true;
    }
    
    // Check content
    for (const hunk of file.hunks) {
      for (const pattern of SECURITY_PATTERNS) {
        if (pattern.test(hunk.content)) return true;
      }
    }
  }
  return false;
}

function hasComplexLogic(files: FileDiff[]): boolean {
  for (const file of files) {
    for (const hunk of file.hunks) {
      for (const pattern of COMPLEX_PATTERNS) {
        if (pattern.test(hunk.content)) return true;
      }
    }
  }
  return false;
}

export function selectModel(files: FileDiff[]): { tier: ModelTier; model: string; reason: string } {
  const { additions, deletions } = getTotalChanges(files);
  const totalChanges = additions + deletions;
  
  // Security-related changes always get thorough review
  if (hasSecurityContent(files)) {
    return {
      tier: 'thorough',
      model: config.ollama.models.thorough,
      reason: 'Security-related changes detected',
    };
  }
  
  // Large or complex PRs get thorough review
  if (totalChanges > 200 || hasComplexLogic(files)) {
    return {
      tier: 'thorough',
      model: config.ollama.models.thorough,
      reason: `Large PR (${totalChanges} changes) or complex logic`,
    };
  }
  
  // Medium PRs get balanced review
  if (totalChanges > 50) {
    return {
      tier: 'balanced',
      model: config.ollama.models.balanced,
      reason: `Medium PR (${totalChanges} changes)`,
    };
  }
  
  // Small PRs get quick review
  return {
    tier: 'fast',
    model: config.ollama.models.fast,
    reason: `Small PR (${totalChanges} changes)`,
  };
}
