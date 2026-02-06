// Diff parsing module

import type { FileDiff, DiffHunk, DiffLine } from './types.js';

const LANGUAGE_MAP: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.py': 'python',
  '.rs': 'rust',
  '.go': 'go',
  '.java': 'java',
  '.cpp': 'cpp',
  '.c': 'c',
  '.md': 'markdown',
  '.json': 'json',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.toml': 'toml',
  '.sql': 'sql',
  '.sh': 'shell',
  '.bash': 'shell',
  '.sol': 'solidity',
};

function detectLanguage(path: string): string {
  const ext = path.substring(path.lastIndexOf('.'));
  return LANGUAGE_MAP[ext] || 'text';
}

function parseHunkHeader(line: string): { oldStart: number; oldLines: number; newStart: number; newLines: number } | null {
  // Format: @@ -oldStart,oldLines +newStart,newLines @@
  const match = line.match(/@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
  if (!match) return null;
  
  return {
    oldStart: parseInt(match[1]),
    oldLines: parseInt(match[2] || '1'),
    newStart: parseInt(match[3]),
    newLines: parseInt(match[4] || '1'),
  };
}

export function parseDiff(diffText: string): FileDiff[] {
  const files: FileDiff[] = [];
  const lines = diffText.split('\n');
  
  let currentFile: FileDiff | null = null;
  let currentHunk: DiffHunk | null = null;
  let lineNumber = 0;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // New file header
    if (line.startsWith('diff --git')) {
      if (currentFile && currentHunk) {
        currentFile.hunks.push(currentHunk);
      }
      if (currentFile) {
        files.push(currentFile);
      }
      currentFile = null;
      currentHunk = null;
      continue;
    }
    
    // File path (new)
    if (line.startsWith('+++ b/')) {
      const path = line.substring(6);
      currentFile = {
        path,
        status: 'modified',
        hunks: [],
        additions: 0,
        deletions: 0,
        language: detectLanguage(path),
      };
      continue;
    }
    
    // File path (old) - detect renames/adds
    if (line.startsWith('--- a/')) {
      const oldPath = line.substring(6);
      if (currentFile && currentFile.path !== oldPath) {
        currentFile.oldPath = oldPath;
        currentFile.status = 'renamed';
      }
      continue;
    }
    
    if (line.startsWith('--- /dev/null')) {
      if (currentFile) currentFile.status = 'added';
      continue;
    }
    
    if (line.startsWith('+++ /dev/null')) {
      if (currentFile) currentFile.status = 'deleted';
      continue;
    }
    
    // Hunk header
    if (line.startsWith('@@')) {
      if (currentFile && currentHunk) {
        currentFile.hunks.push(currentHunk);
      }
      
      const header = parseHunkHeader(line);
      if (header && currentFile) {
        lineNumber = header.newStart;
        currentHunk = {
          ...header,
          content: '',
          changes: [],
        };
      }
      continue;
    }
    
    // Diff content
    if (currentHunk && currentFile) {
      if (line.startsWith('+') && !line.startsWith('+++')) {
        currentHunk.changes.push({
          type: 'add',
          lineNumber,
          content: line.substring(1),
        });
        currentFile.additions++;
        lineNumber++;
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        currentHunk.changes.push({
          type: 'del',
          lineNumber: -1, // Deleted lines don't have new line numbers
          content: line.substring(1),
        });
        currentFile.deletions++;
      } else if (line.startsWith(' ')) {
        currentHunk.changes.push({
          type: 'context',
          lineNumber,
          content: line.substring(1),
        });
        lineNumber++;
      }
      currentHunk.content += line + '\n';
    }
  }
  
  // Don't forget the last file/hunk
  if (currentFile && currentHunk) {
    currentFile.hunks.push(currentHunk);
  }
  if (currentFile) {
    files.push(currentFile);
  }
  
  return files;
}

export function formatDiffForReview(file: FileDiff): string {
  let output = `File: ${file.path}\n`;
  output += `Language: ${file.language}\n`;
  output += `Status: ${file.status} (+${file.additions} -${file.deletions})\n\n`;
  
  for (const hunk of file.hunks) {
    output += `@@ Lines ${hunk.newStart}-${hunk.newStart + hunk.newLines - 1} @@\n`;
    output += '```diff\n';
    for (const change of hunk.changes) {
      const prefix = change.type === 'add' ? '+' : change.type === 'del' ? '-' : ' ';
      output += `${prefix}${change.content}\n`;
    }
    output += '```\n\n';
  }
  
  return output;
}

export function getTotalChanges(files: FileDiff[]): { additions: number; deletions: number } {
  return files.reduce(
    (acc, f) => ({
      additions: acc.additions + f.additions,
      deletions: acc.deletions + f.deletions,
    }),
    { additions: 0, deletions: 0 }
  );
}
