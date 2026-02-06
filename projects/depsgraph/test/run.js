#!/usr/bin/env node

/**
 * depsgraph — Test Suite
 * 
 * Simple test runner — no external test framework needed.
 */

const { resolveFromRegistry, fetchPackageData, fetchDownloads } = require('../src/resolver');
const { analyzeTree, generateRiskReport, calculateRiskScore, scorePublishAge, scoreMaintainerCount, scoreDepth, scoreDownloads, scoreSize, scoreDeprecated, scoreLicense, getRiskLevel } = require('../src/analyzer');
const { treeToGraph, findPath, compareGraphs, formatBytes } = require('../src/graph');
const { createApp } = require('../src/server');
const http = require('http');

// ---- Test harness ----
let passed = 0;
let failed = 0;
let total = 0;
const failures = [];

function test(name, fn) {
  return { name, fn };
}

function assert(condition, message) {
  if (!condition) throw new Error(message || 'Assertion failed');
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message || 'assertEqual'}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertInRange(value, min, max, message) {
  if (value < min || value > max) {
    throw new Error(`${message || 'assertInRange'}: ${value} not in [${min}, ${max}]`);
  }
}

async function runTests(tests) {
  const c = {
    reset: '\x1b[0m',
    bold: '\x1b[1m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    gray: '\x1b[90m',
    yellow: '\x1b[33m',
  };

  console.log(`\n${c.bold}  ◈ depsgraph test suite${c.reset}\n`);

  for (const t of tests) {
    total++;
    try {
      await t.fn();
      passed++;
      console.log(`  ${c.green}✓${c.reset} ${c.gray}${t.name}${c.reset}`);
    } catch (err) {
      failed++;
      failures.push({ name: t.name, error: err.message });
      console.log(`  ${c.red}✕${c.reset} ${t.name}`);
      console.log(`    ${c.red}${err.message}${c.reset}`);
    }
  }

  console.log(`\n${c.gray}  ─────────────────────────────────────${c.reset}`);
  console.log(`  ${c.green}${passed} passed${c.reset}  ${failed > 0 ? `${c.red}${failed} failed${c.reset}` : ''}  ${c.gray}${total} total${c.reset}\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

// ---- Mock data ----
function mockTree() {
  return {
    name: 'test-pkg',
    version: '1.0.0',
    depth: 0,
    downloads: 5000000,
    metadata: {
      description: 'A test package',
      license: 'MIT',
      maintainers: 3,
      maintainerNames: ['alice', 'bob', 'charlie'],
      lastPublish: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(), // 30 days ago
      unpackedSize: 50000,
      deprecated: false,
      homepage: 'https://example.com',
      repository: 'https://github.com/test/test',
    },
    dependencies: [
      {
        name: 'dep-a',
        version: '2.0.0',
        depth: 1,
        downloads: 500,
        metadata: {
          description: 'Dependency A',
          license: 'MIT',
          maintainers: 1,
          maintainerNames: ['solo'],
          lastPublish: new Date(Date.now() - 900 * 24 * 60 * 60 * 1000).toISOString(), // ~2.5 years ago
          unpackedSize: 200000,
          deprecated: false,
          homepage: '',
          repository: '',
        },
        dependencies: [
          {
            name: 'sub-dep',
            version: '0.1.0',
            depth: 2,
            downloads: 100,
            metadata: {
              description: 'Sub dependency',
              license: 'UNKNOWN',
              maintainers: 1,
              maintainerNames: ['lone'],
              lastPublish: new Date(Date.now() - 400 * 24 * 60 * 60 * 1000).toISOString(), // ~1.1 years ago
              unpackedSize: 2000000, // 2MB
              deprecated: true,
              homepage: '',
              repository: '',
            },
            dependencies: [],
          },
        ],
      },
      {
        name: 'dep-b',
        version: '3.5.0',
        depth: 1,
        downloads: 20000000,
        metadata: {
          description: 'Dependency B - well maintained',
          license: 'Apache-2.0',
          maintainers: 8,
          maintainerNames: ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8'],
          lastPublish: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(), // 1 week ago
          unpackedSize: 30000,
          deprecated: false,
          homepage: 'https://depb.dev',
          repository: 'https://github.com/dep/b',
        },
        dependencies: [],
      },
    ],
  };
}

// ---- Tests ----

const tests = [
  // ---- Risk Analyzer: Individual scorers ----
  test('scorePublishAge: recent publish = 0', () => {
    const recent = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    assertEqual(scorePublishAge(recent), 0);
  }),

  test('scorePublishAge: >6mo = 20', () => {
    const sixMo = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toISOString();
    assertEqual(scorePublishAge(sixMo), 20);
  }),

  test('scorePublishAge: >1yr = 50', () => {
    const oneYr = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000).toISOString();
    assertEqual(scorePublishAge(oneYr), 50);
  }),

  test('scorePublishAge: >2yr = 80', () => {
    const twoYr = new Date(Date.now() - 800 * 24 * 60 * 60 * 1000).toISOString();
    assertEqual(scorePublishAge(twoYr), 80);
  }),

  test('scorePublishAge: null = 60', () => {
    assertEqual(scorePublishAge(null), 60);
  }),

  test('scoreMaintainerCount: 1 = 80 (bus factor)', () => {
    assertEqual(scoreMaintainerCount(1), 80);
  }),

  test('scoreMaintainerCount: 2 = 50', () => {
    assertEqual(scoreMaintainerCount(2), 50);
  }),

  test('scoreMaintainerCount: 4 = 20', () => {
    assertEqual(scoreMaintainerCount(4), 20);
  }),

  test('scoreMaintainerCount: 10 = 0', () => {
    assertEqual(scoreMaintainerCount(10), 0);
  }),

  test('scoreDepth: 0 = 0', () => {
    assertEqual(scoreDepth(0), 0);
  }),

  test('scoreDepth: 5 = 60', () => {
    assertEqual(scoreDepth(5), 60);
  }),

  test('scoreDepth: 10 = 100 (capped)', () => {
    assertEqual(scoreDepth(10), 100);
  }),

  test('scoreDownloads: <1000 = 80', () => {
    assertEqual(scoreDownloads(500), 80);
  }),

  test('scoreDownloads: <10000 = 50', () => {
    assertEqual(scoreDownloads(5000), 50);
  }),

  test('scoreDownloads: >100000 = 0', () => {
    assertEqual(scoreDownloads(1000000), 0);
  }),

  test('scoreSize: <100KB = 0', () => {
    assertEqual(scoreSize(50000), 0);
  }),

  test('scoreSize: >1MB = 80', () => {
    assertEqual(scoreSize(2000000), 80);
  }),

  test('scoreDeprecated: true = 100', () => {
    assertEqual(scoreDeprecated(true), 100);
  }),

  test('scoreDeprecated: false = 0', () => {
    assertEqual(scoreDeprecated(false), 0);
  }),

  test('scoreLicense: MIT = 0', () => {
    assertEqual(scoreLicense('MIT'), 0);
  }),

  test('scoreLicense: GPL-3.0 = 50', () => {
    assertEqual(scoreLicense('GPL-3.0'), 50);
  }),

  test('scoreLicense: UNKNOWN = 80', () => {
    assertEqual(scoreLicense('UNKNOWN'), 80);
  }),

  test('getRiskLevel: 0-25 = low', () => {
    assertEqual(getRiskLevel(10), 'low');
    assertEqual(getRiskLevel(25), 'low');
  }),

  test('getRiskLevel: 26-50 = medium', () => {
    assertEqual(getRiskLevel(30), 'medium');
    assertEqual(getRiskLevel(50), 'medium');
  }),

  test('getRiskLevel: 51-75 = high', () => {
    assertEqual(getRiskLevel(60), 'high');
  }),

  test('getRiskLevel: 76-100 = critical', () => {
    assertEqual(getRiskLevel(80), 'critical');
  }),

  // ---- Risk Analyzer: Tree analysis ----
  test('analyzeTree: annotates all nodes', () => {
    const tree = mockTree();
    analyzeTree(tree);
    
    assert(tree.riskScore !== undefined, 'root should have riskScore');
    assert(tree.riskLevel !== undefined, 'root should have riskLevel');
    assert(tree.dependencies[0].riskScore !== undefined, 'dep-a should have riskScore');
    assert(tree.dependencies[0].dependencies[0].riskScore !== undefined, 'sub-dep should have riskScore');
  }),

  test('analyzeTree: deprecated package has high risk', () => {
    const tree = mockTree();
    analyzeTree(tree);
    
    const subDep = tree.dependencies[0].dependencies[0];
    assert(subDep.riskScore >= 50, `deprecated sub-dep should have high risk, got ${subDep.riskScore}`);
  }),

  test('analyzeTree: well-maintained package has low risk', () => {
    const tree = mockTree();
    analyzeTree(tree);
    
    const depB = tree.dependencies[1];
    assert(depB.riskScore <= 30, `well-maintained dep-b should have low risk, got ${depB.riskScore}`);
  }),

  test('generateRiskReport: returns correct structure', () => {
    const tree = mockTree();
    analyzeTree(tree);
    const report = generateRiskReport(tree);
    
    assertEqual(report.totalPackages, 4);
    assert(report.averageRisk >= 0 && report.averageRisk <= 100, 'averageRisk in range');
    assert(report.distribution !== undefined, 'has distribution');
    assert(report.topRisks.length > 0, 'has topRisks');
    assert(report.deprecated.length === 1, 'has 1 deprecated package');
  }),

  // ---- Graph Engine ----
  test('treeToGraph: correct node count', () => {
    const tree = mockTree();
    analyzeTree(tree);
    const graph = treeToGraph(tree);
    
    assertEqual(graph.nodes.length, 4);
  }),

  test('treeToGraph: correct edge count', () => {
    const tree = mockTree();
    analyzeTree(tree);
    const graph = treeToGraph(tree);
    
    assertEqual(graph.edges.length, 3);
  }),

  test('treeToGraph: root node at depth 0', () => {
    const tree = mockTree();
    analyzeTree(tree);
    const graph = treeToGraph(tree);
    
    assertEqual(graph.nodes[0].depth, 0);
    assertEqual(graph.nodes[0].name, 'test-pkg');
  }),

  test('treeToGraph: edges have correct types', () => {
    const tree = mockTree();
    analyzeTree(tree);
    const graph = treeToGraph(tree);
    
    const directEdges = graph.edges.filter(e => e.type === 'direct');
    const transitiveEdges = graph.edges.filter(e => e.type === 'transitive');
    
    assertEqual(directEdges.length, 2);
    assertEqual(transitiveEdges.length, 1);
  }),

  test('treeToGraph: stats are correct', () => {
    const tree = mockTree();
    analyzeTree(tree);
    const graph = treeToGraph(tree);
    
    assertEqual(graph.stats.totalPackages, 4);
    assertEqual(graph.stats.maxDepth, 2);
    assertEqual(graph.stats.directDeps, 2);
    assertEqual(graph.stats.transitiveDeps, 1);
  }),

  test('findPath: finds shortest path', () => {
    const edges = [
      { source: 'A', target: 'B' },
      { source: 'B', target: 'C' },
      { source: 'A', target: 'C' },
    ];
    
    const path = findPath(edges, 'A', 'C');
    assertEqual(path.length, 2); // A -> C directly
    assertEqual(path[0], 'A');
    assertEqual(path[1], 'C');
  }),

  test('findPath: returns null for unreachable node', () => {
    const edges = [
      { source: 'A', target: 'B' },
    ];
    
    const path = findPath(edges, 'A', 'Z');
    assertEqual(path, null);
  }),

  test('compareGraphs: finds shared and unique', () => {
    const graphA = {
      nodes: [
        { name: 'root-a' }, { name: 'shared' }, { name: 'only-a' },
      ],
      stats: { totalPackages: 3, totalSizeFormatted: '100 KB', maxDepth: 2, avgRiskScore: 20 },
    };
    const graphB = {
      nodes: [
        { name: 'root-b' }, { name: 'shared' }, { name: 'only-b' },
      ],
      stats: { totalPackages: 3, totalSizeFormatted: '200 KB', maxDepth: 3, avgRiskScore: 30 },
    };

    const result = compareGraphs(graphA, graphB);
    assertEqual(result.shared, 1);
    assertEqual(result.onlyInA, 2);
    assertEqual(result.onlyInB, 2);
  }),

  test('formatBytes: formats correctly', () => {
    assertEqual(formatBytes(0), '0 B');
    assertEqual(formatBytes(1024), '1.0 KB');
    assertEqual(formatBytes(1048576), '1.0 MB');
  }),

  // ---- Resolver: live test (small package) ----
  test('resolver: resolves "ms" from registry', async () => {
    const tree = await resolveFromRegistry('ms', { maxDepth: 3 });
    
    assertEqual(tree.name, 'ms');
    assert(tree.version !== undefined, 'has version');
    assert(tree.metadata !== undefined, 'has metadata');
    assertEqual(tree.dependencies.length, 0, 'ms has zero deps');
  }),

  test('resolver: handles non-existent package', async () => {
    const tree = await resolveFromRegistry('this-package-definitely-does-not-exist-xyz-123', { maxDepth: 1 });
    assert(tree.error !== undefined, 'should have error');
  }),

  // ---- Server: API test ----
  test('server: GET /api/analyze/ms returns valid response', async () => {
    const app = createApp();
    const server = await new Promise((resolve) => {
      const s = app.listen(0, () => resolve(s));
    });
    const port = server.address().port;

    try {
      const data = await new Promise((resolve, reject) => {
        http.get(`http://localhost:${port}/api/analyze/ms`, (res) => {
          let body = '';
          res.on('data', chunk => body += chunk);
          res.on('end', () => {
            try {
              resolve(JSON.parse(body));
            } catch (e) {
              reject(new Error('Invalid JSON response'));
            }
          });
        }).on('error', reject);
      });

      assert(data.package === 'ms', 'response has package name');
      assert(data.graph !== undefined, 'response has graph');
      assert(data.graph.nodes.length > 0, 'graph has nodes');
      assert(data.riskReport !== undefined, 'response has riskReport');
    } finally {
      server.close();
    }
  }),

  test('server: GET /api/stats returns 404 when no analysis loaded', async () => {
    const app = createApp();
    const server = await new Promise((resolve) => {
      const s = app.listen(0, () => resolve(s));
    });
    const port = server.address().port;

    try {
      const statusCode = await new Promise((resolve, reject) => {
        http.get(`http://localhost:${port}/api/stats`, (res) => {
          res.resume();
          resolve(res.statusCode);
        }).on('error', reject);
      });

      assertEqual(statusCode, 404);
    } finally {
      server.close();
    }
  }),

  test('server: POST /api/compare with invalid body returns 400', async () => {
    const app = createApp();
    const server = await new Promise((resolve) => {
      const s = app.listen(0, () => resolve(s));
    });
    const port = server.address().port;

    try {
      const statusCode = await new Promise((resolve, reject) => {
        const req = http.request({
          hostname: 'localhost',
          port,
          path: '/api/compare',
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        }, (res) => {
          res.resume();
          resolve(res.statusCode);
        });
        req.on('error', reject);
        req.write(JSON.stringify({ packages: ['only-one'] }));
        req.end();
      });

      assertEqual(statusCode, 400);
    } finally {
      server.close();
    }
  }),
];

// ---- Run ----
runTests(tests);
