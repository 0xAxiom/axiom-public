// LLM Review Engine with streaming

import type { FileDiff, ReviewComment, ReviewChunk } from './types.js';
import { config } from './config.js';
import { formatDiffForReview } from './diff.js';

const REVIEW_PROMPT = `You are a senior code reviewer. Analyze the following code changes and provide specific, actionable feedback.

Focus on:
1. Bugs and logic errors
2. Security vulnerabilities  
3. Performance issues
4. Code style and readability
5. Missing edge cases
6. Potential runtime errors

For each issue found, respond in EXACTLY this format (one per issue):
===COMMENT===
FILE: <filename>
LINE: <line number where issue is>
SEVERITY: critical|warning|suggestion
ISSUE: <clear description of the problem>
FIX: <specific code suggestion or improvement>
===END===

If the code looks good, just respond with:
LGTM - Code looks good, no issues found.

Be concise. Only flag real issues, not style preferences unless they impact readability significantly.`;

interface OllamaResponse {
  model: string;
  done: boolean;
  response?: string;
  total_duration?: number;
  eval_count?: number;
}

export async function* streamReview(
  files: FileDiff[],
  model: string
): AsyncGenerator<{ type: 'token' | 'comment' | 'done'; data: string | ReviewComment }> {
  const formattedDiff = files.map(formatDiffForReview).join('\n---\n');
  
  const prompt = `${REVIEW_PROMPT}

CODE CHANGES:
${formattedDiff}

Review:`;

  const response = await fetch(`${config.ollama.host}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      prompt,
      stream: true,
      options: {
        temperature: 0.3,
        num_predict: 4096,
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`Ollama error: ${response.status} ${response.statusText}`);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error('No response body');

  const decoder = new TextDecoder();
  let buffer = '';
  let fullResponse = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;
      
      try {
        const json: OllamaResponse = JSON.parse(line);
        
        if (json.response) {
          fullResponse += json.response;
          yield { type: 'token', data: json.response };
          
          // Check for complete comments in accumulated response
          const comments = parseComments(fullResponse);
          for (const comment of comments) {
            yield { type: 'comment', data: comment };
          }
        }
        
        if (json.done) {
          yield { type: 'done', data: fullResponse };
        }
      } catch {
        // Skip malformed JSON
      }
    }
  }
}

export async function review(files: FileDiff[], model: string): Promise<{ comments: ReviewComment[]; fullResponse: string; tokensUsed: number }> {
  const comments: ReviewComment[] = [];
  let fullResponse = '';
  
  for await (const chunk of streamReview(files, model)) {
    if (chunk.type === 'token') {
      fullResponse += chunk.data;
    } else if (chunk.type === 'comment') {
      comments.push(chunk.data as ReviewComment);
    }
  }
  
  // Parse any remaining comments
  const finalComments = parseComments(fullResponse);
  for (const c of finalComments) {
    if (!comments.find(existing => existing.line === c.line && existing.path === c.path)) {
      comments.push(c);
    }
  }
  
  return {
    comments,
    fullResponse,
    tokensUsed: Math.ceil(fullResponse.length / 4), // Rough estimate
  };
}

function parseComments(text: string): ReviewComment[] {
  const comments: ReviewComment[] = [];
  const commentBlocks = text.split('===COMMENT===').slice(1);
  
  for (const block of commentBlocks) {
    const endIdx = block.indexOf('===END===');
    if (endIdx === -1) continue;
    
    const content = block.substring(0, endIdx);
    const comment = parseCommentBlock(content);
    if (comment) {
      comments.push(comment);
    }
  }
  
  return comments;
}

function parseCommentBlock(block: string): ReviewComment | null {
  const lines = block.trim().split('\n');
  const parsed: Partial<ReviewComment> = {};
  
  for (const line of lines) {
    if (line.startsWith('FILE:')) {
      parsed.path = line.substring(5).trim();
    } else if (line.startsWith('LINE:')) {
      parsed.line = parseInt(line.substring(5).trim());
    } else if (line.startsWith('SEVERITY:')) {
      const sev = line.substring(9).trim().toLowerCase();
      if (['critical', 'warning', 'suggestion', 'praise'].includes(sev)) {
        parsed.severity = sev as ReviewComment['severity'];
      }
    } else if (line.startsWith('ISSUE:')) {
      const issue = line.substring(6).trim();
      // Continue reading until FIX:
      const issueLines = [issue];
      continue;
    } else if (line.startsWith('FIX:')) {
      const fix = line.substring(4).trim();
      // Build the body from ISSUE + FIX
      if (parsed.severity && parsed.line && parsed.path) {
        const severityEmoji = {
          critical: '🚨',
          warning: '⚠️',
          suggestion: '💡',
          praise: '✨',
        }[parsed.severity];
        
        // Find ISSUE content
        const issueMatch = block.match(/ISSUE:\s*(.+?)(?=FIX:|$)/s);
        const fixMatch = block.match(/FIX:\s*(.+?)(?====END===|$)/s);
        
        const issueText = issueMatch ? issueMatch[1].trim() : '';
        const fixText = fixMatch ? fixMatch[1].trim() : fix;
        
        parsed.body = `${severityEmoji} **${parsed.severity.toUpperCase()}**\n\n${issueText}\n\n**Suggestion:** ${fixText}`;
      }
    }
  }
  
  if (parsed.path && parsed.line && parsed.body && parsed.severity) {
    return parsed as ReviewComment;
  }
  
  return null;
}

export function isLGTM(response: string): boolean {
  return response.includes('LGTM') || 
         response.toLowerCase().includes('looks good') ||
         response.toLowerCase().includes('no issues found');
}
