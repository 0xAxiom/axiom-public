/**
 * Express Server
 * 
 * REST API for depsgraph. Serves analysis endpoints
 * and the static web dashboard.
 */

const express = require('express');
const path = require('path');
const { resolveFromRegistry, clearCache } = require('./resolver');
const { analyzeTree, generateRiskReport } = require('./analyzer');
const { treeToGraph, findPath, compareGraphs } = require('./graph');

const DEFAULT_PORT = 3847;

/**
 * Create and configure the Express app.
 */
function createApp() {
  const app = express();

  // Middleware
  app.use(express.json());
  
  // CORS
  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    if (req.method === 'OPTIONS') {
      return res.sendStatus(200);
    }
    next();
  });

  // Serve static files
  app.use(express.static(path.join(__dirname, 'web', 'public')));

  // In-memory store for the latest analysis
  let currentAnalysis = null;

  /**
   * Shared analyze handler
   */
  async function handleAnalyze(packageName, req, res) {
    if (!packageName || packageName.trim() === '') {
      return res.status(400).json({ error: 'Package name is required' });
    }

    try {
      const tree = await resolveFromRegistry(packageName.trim(), {
        maxDepth: parseInt(req.query.depth) || 10,
        onProgress: () => {},
      });

      analyzeTree(tree);
      const graph = treeToGraph(tree);
      const riskReport = generateRiskReport(tree);

      currentAnalysis = {
        package: packageName,
        timestamp: new Date().toISOString(),
        tree,
        graph,
        riskReport,
      };

      res.json({
        package: packageName,
        timestamp: currentAnalysis.timestamp,
        graph,
        riskReport: {
          totalPackages: riskReport.totalPackages,
          averageRisk: riskReport.averageRisk,
          overallLevel: riskReport.overallLevel,
          distribution: riskReport.distribution,
          topRisks: riskReport.topRisks,
          deprecated: riskReport.deprecated,
        },
      });
    } catch (err) {
      console.error(`Error analyzing ${packageName}:`, err.message);
      res.status(500).json({ error: `Failed to analyze ${packageName}: ${err.message}` });
    }
  }

  /**
   * Shared risk handler
   */
  async function handleRisk(packageName, req, res) {
    try {
      const tree = await resolveFromRegistry(packageName.trim(), {
        maxDepth: parseInt(req.query.depth) || 10,
      });
      analyzeTree(tree);
      const riskReport = generateRiskReport(tree);
      res.json({
        package: packageName,
        timestamp: new Date().toISOString(),
        ...riskReport,
      });
    } catch (err) {
      res.status(500).json({ error: `Failed to analyze ${packageName}: ${err.message}` });
    }
  }

  // Routes: unscoped packages
  app.get('/api/analyze/:package', (req, res) => {
    handleAnalyze(req.params.package, req, res);
  });

  // Routes: scoped packages (@scope/name)
  app.get('/api/analyze/@:scope/:name', (req, res) => {
    handleAnalyze(`@${req.params.scope}/${req.params.name}`, req, res);
  });

  app.get('/api/risk/:package', (req, res) => {
    handleRisk(req.params.package, req, res);
  });

  app.get('/api/risk/@:scope/:name', (req, res) => {
    handleRisk(`@${req.params.scope}/${req.params.name}`, req, res);
  });

  /**
   * GET /api/stats
   */
  app.get('/api/stats', (req, res) => {
    if (!currentAnalysis) {
      return res.status(404).json({ error: 'No analysis loaded. Analyze a package first.' });
    }
    res.json({
      package: currentAnalysis.package,
      timestamp: currentAnalysis.timestamp,
      stats: currentAnalysis.graph.stats,
    });
  });

  /**
   * GET /api/path/:source/:target
   */
  app.get('/api/path/:source/:target', (req, res) => {
    if (!currentAnalysis) {
      return res.status(404).json({ error: 'No analysis loaded.' });
    }
    const rootId = currentAnalysis.graph.nodes[0]?.id;
    const targetId = req.params.target;
    const pathResult = findPath(currentAnalysis.graph.edges, rootId, targetId);
    res.json({ path: pathResult || [], found: pathResult !== null });
  });

  /**
   * POST /api/compare
   */
  app.post('/api/compare', async (req, res) => {
    const { packages } = req.body;
    if (!packages || !Array.isArray(packages) || packages.length !== 2) {
      return res.status(400).json({ error: 'Provide { packages: ["pkg-a", "pkg-b"] }' });
    }
    try {
      const [pkgA, pkgB] = packages;
      const [treeA, treeB] = await Promise.all([
        resolveFromRegistry(pkgA.trim(), { maxDepth: 8 }),
        resolveFromRegistry(pkgB.trim(), { maxDepth: 8 }),
      ]);
      analyzeTree(treeA);
      analyzeTree(treeB);
      const graphA = treeToGraph(treeA);
      const graphB = treeToGraph(treeB);
      const comparison = compareGraphs(graphA, graphB);
      res.json({
        comparison,
        packages: {
          [pkgA]: { graph: graphA, riskReport: generateRiskReport(treeA) },
          [pkgB]: { graph: graphB, riskReport: generateRiskReport(treeB) },
        },
      });
    } catch (err) {
      res.status(500).json({ error: `Comparison failed: ${err.message}` });
    }
  });

  /**
   * POST /api/clear-cache
   */
  app.post('/api/clear-cache', (req, res) => {
    clearCache();
    res.json({ message: 'Cache cleared' });
  });

  // Fallback: serve index.html for SPA
  app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'web', 'public', 'index.html'));
  });

  return app;
}

/**
 * Start the server on the given port.
 */
function startServer(port = DEFAULT_PORT) {
  const app = createApp();
  return new Promise((resolve, reject) => {
    const server = app.listen(port, () => {
      console.log(`\n  depsgraph server running at http://localhost:${port}\n`);
      resolve(server);
    });
    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.error(`Port ${port} is already in use. Try --port <number>`);
      }
      reject(err);
    });
  });
}

module.exports = { createApp, startServer };
