// GitHub API Client

import { Octokit } from 'octokit';
import type { ReviewComment, ReviewResult } from './types.js';
import { config } from './config.js';

let octokit: Octokit | null = null;

function getOctokit(): Octokit {
  if (!octokit) {
    if (!config.github.token) {
      throw new Error('GITHUB_TOKEN not configured');
    }
    octokit = new Octokit({ auth: config.github.token });
  }
  return octokit;
}

export async function fetchPullRequestDiff(owner: string, repo: string, prNumber: number): Promise<string> {
  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}`,
    {
      headers: {
        Authorization: `Bearer ${config.github.token}`,
        Accept: 'application/vnd.github.v3.diff',
      },
    }
  );
  
  if (!response.ok) {
    throw new Error(`Failed to fetch PR diff: ${response.status}`);
  }
  
  return response.text();
}

export async function fetchPullRequest(owner: string, repo: string, prNumber: number) {
  const client = getOctokit();
  const { data } = await client.rest.pulls.get({
    owner,
    repo,
    pull_number: prNumber,
  });
  return data;
}

export async function createReview(
  owner: string,
  repo: string,
  prNumber: number,
  commitSha: string,
  comments: ReviewComment[],
  body: string,
  event: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT' = 'COMMENT'
): Promise<number> {
  const client = getOctokit();
  
  // Convert our comments to GitHub's format
  const githubComments = comments
    .filter(c => c.line > 0 && c.path) // GitHub requires positive line numbers
    .map(c => ({
      path: c.path,
      line: c.line,
      body: c.body,
    }));
  
  const { data } = await client.rest.pulls.createReview({
    owner,
    repo,
    pull_number: prNumber,
    commit_id: commitSha,
    body,
    event,
    comments: githubComments,
  });
  
  return data.id;
}

export async function addComment(
  owner: string,
  repo: string,
  prNumber: number,
  body: string
): Promise<void> {
  const client = getOctokit();
  
  await client.rest.issues.createComment({
    owner,
    repo,
    issue_number: prNumber,
    body,
  });
}

export async function getPullRequestFiles(
  owner: string,
  repo: string,
  prNumber: number
): Promise<Array<{ filename: string; status: string; additions: number; deletions: number }>> {
  const client = getOctokit();
  
  const { data } = await client.rest.pulls.listFiles({
    owner,
    repo,
    pull_number: prNumber,
    per_page: 100,
  });
  
  return data.map(f => ({
    filename: f.filename,
    status: f.status,
    additions: f.additions,
    deletions: f.deletions,
  }));
}

// Rate limiting helper
const RATE_LIMIT = {
  remaining: 5000,
  reset: Date.now(),
};

export async function checkRateLimit(): Promise<{ remaining: number; reset: Date }> {
  const client = getOctokit();
  const { data } = await client.rest.rateLimit.get();
  
  RATE_LIMIT.remaining = data.rate.remaining;
  RATE_LIMIT.reset = data.rate.reset * 1000;
  
  return {
    remaining: RATE_LIMIT.remaining,
    reset: new Date(RATE_LIMIT.reset),
  };
}

export function canMakeRequest(): boolean {
  if (RATE_LIMIT.remaining <= 10) {
    if (Date.now() < RATE_LIMIT.reset) {
      return false;
    }
  }
  return true;
}

export async function waitForRateLimit(): Promise<void> {
  if (canMakeRequest()) return;
  
  const waitTime = RATE_LIMIT.reset - Date.now() + 1000;
  console.log(`Rate limit hit, waiting ${Math.ceil(waitTime / 1000)}s...`);
  await new Promise(resolve => setTimeout(resolve, waitTime));
}
