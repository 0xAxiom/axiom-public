/**
 * Event store and SSE broadcaster
 */

const MAX_EVENTS = 100;
const events = [];
const clients = new Set();

/**
 * Add an event to the store and broadcast to clients
 */
export function addEvent(event) {
  const fullEvent = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    timestamp: new Date().toISOString(),
    ...event
  };
  
  events.unshift(fullEvent);
  
  // Trim to max events
  while (events.length > MAX_EVENTS) {
    events.pop();
  }
  
  // Broadcast to all connected clients
  broadcast(fullEvent);
  
  return fullEvent;
}

/**
 * Get recent events
 */
export function getEvents(limit = 50) {
  return events.slice(0, limit);
}

/**
 * Get events for a specific repo
 */
export function getRepoEvents(repoFullName, limit = 50) {
  return events
    .filter(e => e.repo === repoFullName)
    .slice(0, limit);
}

/**
 * Register an SSE client
 */
export function registerClient(res) {
  clients.add(res);
  
  // Send initial connection event
  sendToClient(res, {
    type: 'connected',
    timestamp: new Date().toISOString(),
    message: 'Connected to GitHub Pulse stream'
  });
  
  // Remove on close
  res.on('close', () => {
    clients.delete(res);
  });
  
  return () => clients.delete(res);
}

/**
 * Send event to a single client
 */
function sendToClient(res, event) {
  try {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  } catch (e) {
    clients.delete(res);
  }
}

/**
 * Broadcast event to all clients
 */
function broadcast(event) {
  const data = `data: ${JSON.stringify(event)}\n\n`;
  for (const client of clients) {
    try {
      client.write(data);
    } catch (e) {
      clients.delete(client);
    }
  }
}

/**
 * Get connected client count
 */
export function getClientCount() {
  return clients.size;
}

/**
 * Parse GitHub webhook payload into event
 */
export function parseWebhookEvent(eventType, payload) {
  const repo = payload.repository?.full_name;
  
  switch (eventType) {
    case 'push':
      const commits = payload.commits || [];
      return {
        type: 'push',
        repo,
        branch: payload.ref?.replace('refs/heads/', ''),
        commits: commits.length,
        message: commits[0]?.message?.split('\n')[0] || 'Push event',
        author: payload.pusher?.name || 'unknown',
        url: payload.compare
      };
      
    case 'pull_request':
      return {
        type: 'pull_request',
        repo,
        action: payload.action,
        number: payload.pull_request?.number,
        title: payload.pull_request?.title,
        author: payload.pull_request?.user?.login,
        url: payload.pull_request?.html_url
      };
      
    case 'issues':
      return {
        type: 'issue',
        repo,
        action: payload.action,
        number: payload.issue?.number,
        title: payload.issue?.title,
        author: payload.issue?.user?.login,
        url: payload.issue?.html_url
      };
      
    case 'star':
      return {
        type: 'star',
        repo,
        action: payload.action,
        user: payload.sender?.login,
        totalStars: payload.repository?.stargazers_count
      };
      
    case 'fork':
      return {
        type: 'fork',
        repo,
        user: payload.forkee?.owner?.login,
        forkUrl: payload.forkee?.html_url
      };
      
    default:
      return {
        type: eventType,
        repo,
        action: payload.action,
        sender: payload.sender?.login
      };
  }
}
