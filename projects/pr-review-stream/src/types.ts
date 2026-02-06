// PR Review Stream Types

export interface Config {
  github: {
    appId?: string;
    privateKey?: string;
    webhookSecret: string;
    token: string;
  };
  ollama: {
    host: string;
    models: {
      fast: string;
      balanced: string;
      thorough: string;
    };
  };
  review: {
    maxFiles: number;
    maxTokensPerFile: number;
    timeoutSeconds: number;
  };
}

export interface PullRequestEvent {
  action: string;
  number: number;
  pull_request: {
    number: number;
    title: string;
    body: string | null;
    head: { sha: string; ref: string };
    base: { sha: string; ref: string };
    diff_url: string;
    html_url: string;
    user: { login: string };
  };
  repository: {
    full_name: string;
    owner: { login: string };
    name: string;
  };
  sender: { login: string };
}

export interface FileDiff {
  path: string;
  oldPath?: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  hunks: DiffHunk[];
  additions: number;
  deletions: number;
  language: string;
}

export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  content: string;
  changes: DiffLine[];
}

export interface DiffLine {
  type: 'add' | 'del' | 'context';
  lineNumber: number;
  content: string;
}

export interface ReviewChunk {
  file: string;
  startLine: number;
  endLine: number;
  diff: string;
  context: string;
  language: string;
}

export interface ReviewComment {
  path: string;
  line: number;
  body: string;
  severity: 'critical' | 'warning' | 'suggestion' | 'praise';
}

export interface ReviewResult {
  prNumber: number;
  repo: string;
  status: 'pending' | 'reviewing' | 'completed' | 'failed';
  comments: ReviewComment[];
  summary: string;
  tokensUsed: number;
  duration: number;
  model: string;
}

export type ModelTier = 'fast' | 'balanced' | 'thorough';
