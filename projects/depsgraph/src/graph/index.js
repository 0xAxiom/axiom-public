/**
 * Graph Engine
 * 
 * Converts dependency tree to D3-compatible format with nodes and edges.
 * Computes layout metrics and statistics.
 */

/**
 * Convert a dependency tree into D3 graph format.
 * 
 * @param {Object} tree - Analyzed dependency tree (with risk scores)
 * @returns {Object} { nodes, edges, stats }
 */
function treeToGraph(tree) {
  const nodes = [];
  const edges = [];
  const nodeMap = new Map(); // id -> node index
  let totalSize = 0;
  let maxDepth = 0;
  let directDeps = 0;
  let transitiveDeps = 0;

  function walk(node, parentId) {
    const id = `${node.name}@${node.version}`;
    
    // Skip if already processed (dedup)
    if (nodeMap.has(id)) {
      // Still add the edge even if node is already present
      if (parentId) {
        edges.push({
          source: parentId,
          target: id,
          type: node.depth === 1 ? 'direct' : 'transitive',
        });
      }
      return;
    }

    // Track depth
    const depth = node.depth || 0;
    if (depth > maxDepth) maxDepth = depth;

    // Track direct vs transitive
    if (depth === 1) directDeps++;
    else if (depth > 1) transitiveDeps++;

    // Track total size
    const size = (node.metadata && node.metadata.unpackedSize) || 0;
    totalSize += size;

    // Create graph node
    const graphNode = {
      id,
      name: node.name,
      version: node.version,
      size,
      riskScore: node.riskScore || 0,
      riskLevel: node.riskLevel || 'low',
      riskColor: node.riskColor || '#22c55e',
      depth,
      group: depth, // Group by depth for coloring
      description: (node.metadata && node.metadata.description) || '',
      license: (node.metadata && node.metadata.license) || 'UNKNOWN',
      maintainers: (node.metadata && node.metadata.maintainers) || 0,
      downloads: node.downloads || 0,
      deprecated: (node.metadata && node.metadata.deprecated) || false,
      circular: node.circular || false,
      truncated: node.truncated || false,
      error: node.error || null,
      homepage: (node.metadata && node.metadata.homepage) || '',
      riskFactors: node.riskFactors || null,
    };

    const nodeIndex = nodes.length;
    nodes.push(graphNode);
    nodeMap.set(id, nodeIndex);

    // Add edge from parent
    if (parentId) {
      edges.push({
        source: parentId,
        target: id,
        type: depth === 1 ? 'direct' : 'transitive',
      });
    }

    // Recurse into children
    for (const child of (node.dependencies || [])) {
      walk(child, id);
    }
  }

  walk(tree, null);

  // Compute stats
  const stats = {
    totalPackages: nodes.length,
    totalSize,
    totalSizeFormatted: formatBytes(totalSize),
    maxDepth,
    directDeps,
    transitiveDeps,
    riskDistribution: computeRiskDistribution(nodes),
    avgRiskScore: nodes.length > 0
      ? Math.round(nodes.reduce((sum, n) => sum + n.riskScore, 0) / nodes.length)
      : 0,
  };

  return { nodes, edges, stats };
}

/**
 * Compute risk level distribution.
 */
function computeRiskDistribution(nodes) {
  const dist = { low: 0, medium: 0, high: 0, critical: 0 };
  for (const node of nodes) {
    dist[node.riskLevel] = (dist[node.riskLevel] || 0) + 1;
  }
  return dist;
}

/**
 * Format bytes to human-readable string.
 */
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const val = bytes / Math.pow(1024, i);
  return `${val.toFixed(1)} ${units[i]}`;
}

/**
 * Find the path from root to a specific node.
 */
function findPath(edges, rootId, targetId) {
  // Build adjacency list
  const adj = new Map();
  for (const edge of edges) {
    if (!adj.has(edge.source)) adj.set(edge.source, []);
    adj.get(edge.source).push(edge.target);
  }

  // BFS to find shortest path
  const queue = [[rootId]];
  const visited = new Set([rootId]);

  while (queue.length > 0) {
    const path = queue.shift();
    const current = path[path.length - 1];

    if (current === targetId) return path;

    for (const neighbor of (adj.get(current) || [])) {
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push([...path, neighbor]);
      }
    }
  }

  return null; // No path found
}

/**
 * Get dependents: packages that depend on the given package.
 */
function getDependents(edges, targetId) {
  return edges
    .filter(e => e.target === targetId)
    .map(e => e.source);
}

/**
 * Compare two package graphs.
 * Returns shared deps, unique deps, and comparative stats.
 */
function compareGraphs(graphA, graphB) {
  const namesA = new Set(graphA.nodes.map(n => n.name));
  const namesB = new Set(graphB.nodes.map(n => n.name));

  const shared = [...namesA].filter(n => namesB.has(n));
  const onlyA = [...namesA].filter(n => !namesB.has(n));
  const onlyB = [...namesB].filter(n => !namesA.has(n));

  return {
    shared: shared.length,
    sharedPackages: shared,
    onlyInA: onlyA.length,
    onlyInAPackages: onlyA,
    onlyInB: onlyB.length,
    onlyInBPackages: onlyB,
    comparison: {
      a: {
        name: graphA.nodes[0]?.name || 'unknown',
        totalPackages: graphA.stats.totalPackages,
        totalSize: graphA.stats.totalSizeFormatted,
        maxDepth: graphA.stats.maxDepth,
        avgRisk: graphA.stats.avgRiskScore,
      },
      b: {
        name: graphB.nodes[0]?.name || 'unknown',
        totalPackages: graphB.stats.totalPackages,
        totalSize: graphB.stats.totalSizeFormatted,
        maxDepth: graphB.stats.maxDepth,
        avgRisk: graphB.stats.avgRiskScore,
      },
    },
  };
}

module.exports = {
  treeToGraph,
  findPath,
  getDependents,
  compareGraphs,
  formatBytes,
};
