/**
 * GitHub API client with rate limiting and caching
 */

import { Octokit } from 'octokit';

const cache = new Map();
const CACHE_TTL = 60_000; // 1 minute

export function createGitHubClient(token) {
  const octokit = new Octokit({ auth: token });
  
  async function cachedRequest(key, fetcher) {
    const cached = cache.get(key);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return cached.data;
    }
    const data = await fetcher();
    cache.set(key, { data, timestamp: Date.now() });
    return data;
  }

  return {
    /**
     * Get repository info
     */
    async getRepo(owner, repo) {
      return cachedRequest(`repo:${owner}/${repo}`, async () => {
        const { data } = await octokit.rest.repos.get({ owner, repo });
        return {
          name: data.full_name,
          description: data.description,
          stars: data.stargazers_count,
          forks: data.forks_count,
          openIssues: data.open_issues_count,
          defaultBranch: data.default_branch,
          pushedAt: data.pushed_at,
          url: data.html_url
        };
      });
    },

    /**
     * Get recent commits
     */
    async getCommits(owner, repo, since) {
      const sinceDate = since || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      return cachedRequest(`commits:${owner}/${repo}:${sinceDate.slice(0, 10)}`, async () => {
        const { data } = await octokit.rest.repos.listCommits({
          owner,
          repo,
          since: sinceDate,
          per_page: 100
        });
        return data.map(c => ({
          sha: c.sha.slice(0, 7),
          message: c.commit.message.split('\n')[0].slice(0, 80),
          author: c.commit.author?.name || c.author?.login || 'unknown',
          date: c.commit.author?.date,
          url: c.html_url
        }));
      });
    },

    /**
     * Get open pull requests
     */
    async getPullRequests(owner, repo) {
      return cachedRequest(`prs:${owner}/${repo}`, async () => {
        const { data } = await octokit.rest.pulls.list({
          owner,
          repo,
          state: 'open',
          per_page: 50
        });
        return data.map(pr => ({
          number: pr.number,
          title: pr.title.slice(0, 60),
          author: pr.user?.login || 'unknown',
          createdAt: pr.created_at,
          updatedAt: pr.updated_at,
          draft: pr.draft,
          url: pr.html_url,
          labels: pr.labels.map(l => l.name)
        }));
      });
    },

    /**
     * Get open issues (excluding PRs)
     */
    async getIssues(owner, repo) {
      return cachedRequest(`issues:${owner}/${repo}`, async () => {
        const { data } = await octokit.rest.issues.listForRepo({
          owner,
          repo,
          state: 'open',
          per_page: 50
        });
        // Filter out PRs (they're also returned by issues endpoint)
        return data
          .filter(i => !i.pull_request)
          .map(i => ({
            number: i.number,
            title: i.title.slice(0, 60),
            author: i.user?.login || 'unknown',
            createdAt: i.created_at,
            labels: i.labels.map(l => l.name),
            url: i.html_url
          }));
      });
    },

    /**
     * Get contributor stats
     */
    async getContributors(owner, repo) {
      return cachedRequest(`contributors:${owner}/${repo}`, async () => {
        try {
          const { data } = await octokit.rest.repos.listContributors({
            owner,
            repo,
            per_page: 10
          });
          return data.map(c => ({
            login: c.login,
            contributions: c.contributions,
            avatar: c.avatar_url
          }));
        } catch (e) {
          // Stats may not be available for empty repos
          return [];
        }
      });
    },

    /**
     * Get aggregated activity data for a repo
     */
    async getRepoActivity(owner, repo) {
      const [repoInfo, commits, prs, issues, contributors] = await Promise.all([
        this.getRepo(owner, repo),
        this.getCommits(owner, repo),
        this.getPullRequests(owner, repo),
        this.getIssues(owner, repo),
        this.getContributors(owner, repo)
      ]);

      // Calculate commits per day
      const commitsByDay = {};
      const today = new Date();
      for (let i = 0; i < 30; i++) {
        const d = new Date(today - i * 24 * 60 * 60 * 1000);
        const key = d.toISOString().slice(0, 10);
        commitsByDay[key] = 0;
      }
      
      for (const c of commits) {
        const day = c.date?.slice(0, 10);
        if (day && commitsByDay[day] !== undefined) {
          commitsByDay[day]++;
        }
      }

      // Find oldest open PR
      const oldestPR = prs.length > 0
        ? Math.max(...prs.map(p => Date.now() - new Date(p.createdAt).getTime()))
        : 0;

      return {
        repo: repoInfo,
        commits: {
          total: commits.length,
          today: commitsByDay[today.toISOString().slice(0, 10)] || 0,
          byDay: commitsByDay,
          recent: commits.slice(0, 5)
        },
        prs: {
          open: prs.length,
          oldestAgeDays: Math.floor(oldestPR / (24 * 60 * 60 * 1000)),
          items: prs.slice(0, 5)
        },
        issues: {
          open: issues.length,
          items: issues.slice(0, 5)
        },
        contributors: contributors.slice(0, 5),
        lastPush: repoInfo.pushedAt
      };
    },

    /**
     * Get rate limit info
     */
    async getRateLimit() {
      const { data } = await octokit.rest.rateLimit.get();
      return {
        limit: data.rate.limit,
        remaining: data.rate.remaining,
        reset: new Date(data.rate.reset * 1000).toISOString()
      };
    },

    /**
     * Clear cache
     */
    clearCache() {
      cache.clear();
    }
  };
}
