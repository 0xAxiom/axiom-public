/**
 * Package Resolver
 * 
 * Fetches dependency trees from the npm registry recursively.
 * Handles circular dependencies, caches responses, and caps depth.
 */

const https = require('https');
const http = require('http');

// In-memory cache for registry responses
const registryCache = new Map();

// Default options
const DEFAULT_MAX_DEPTH = 10;
const REGISTRY_BASE = 'https://registry.npmjs.org';

/**
 * Fetch JSON from a URL with timeout and error handling
 */
function fetchJSON(url, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    
    const req = protocol.get(url, { headers: { 'Accept': 'application/json' } }, (res) => {
      if (res.statusCode === 404) {
        reject(new Error(`Package not found: ${url}`));
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`Registry returned ${res.statusCode} for ${url}`));
        res.resume();
        return;
      }

      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`Invalid JSON from ${url}`));
        }
      });
    });

    req.on('error', (err) => reject(new Error(`Network error fetching ${url}: ${err.message}`)));
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      reject(new Error(`Timeout fetching ${url}`));
    });
  });
}

/**
 * Fetch package metadata from the npm registry.
 * Uses cache to avoid duplicate network calls.
 */
async function fetchPackageData(packageName) {
  if (registryCache.has(packageName)) {
    return registryCache.get(packageName);
  }

  const url = `${REGISTRY_BASE}/${encodeURIComponent(packageName)}`;
  const data = await fetchJSON(url);
  registryCache.set(packageName, data);
  return data;
}

/**
 * Fetch weekly download count for a package.
 */
async function fetchDownloads(packageName) {
  try {
    const url = `https://api.npmjs.org/downloads/point/last-week/${encodeURIComponent(packageName)}`;
    const data = await fetchJSON(url, 5000);
    return data.downloads || 0;
  } catch {
    return -1; // Unknown
  }
}

/**
 * Extract metadata from registry response for a specific version.
 */
function extractMetadata(registryData, versionData) {
  const time = registryData.time || {};
  const version = versionData.version;
  
  return {
    description: versionData.description || registryData.description || '',
    license: extractLicense(versionData),
    maintainers: (registryData.maintainers || []).length,
    maintainerNames: (registryData.maintainers || []).map(m => m.name || m.email || 'unknown'),
    lastPublish: time[version] || time.modified || null,
    unpackedSize: (versionData.dist && versionData.dist.unpackedSize) || 0,
    deprecated: versionData.deprecated || false,
    homepage: versionData.homepage || registryData.homepage || '',
    repository: extractRepo(versionData),
  };
}

/**
 * Extract license string from package data.
 */
function extractLicense(pkg) {
  if (!pkg.license) return 'UNKNOWN';
  if (typeof pkg.license === 'string') return pkg.license;
  if (typeof pkg.license === 'object' && pkg.license.type) return pkg.license.type;
  return 'UNKNOWN';
}

/**
 * Extract repository URL.
 */
function extractRepo(pkg) {
  if (!pkg.repository) return '';
  if (typeof pkg.repository === 'string') return pkg.repository;
  return pkg.repository.url || '';
}

/**
 * Resolve the latest matching version from registry data.
 * If a semver range is provided, attempts to find a match.
 * Falls back to the 'latest' dist-tag.
 */
function resolveVersion(registryData, versionRange) {
  const versions = Object.keys(registryData.versions || {});
  const distTags = registryData['dist-tags'] || {};
  
  // If no range specified, use latest
  if (!versionRange || versionRange === 'latest' || versionRange === '*') {
    return distTags.latest || versions[versions.length - 1];
  }

  // Try to find a semver-satisfying version
  try {
    const semver = require('semver');
    const match = semver.maxSatisfying(versions, versionRange);
    if (match) return match;
  } catch {
    // Fall through to latest
  }

  return distTags.latest || versions[versions.length - 1];
}

/**
 * Main resolver: recursively resolve dependencies from npm registry.
 * 
 * @param {string} packageName - Package name (e.g., 'express')
 * @param {Object} options - Resolution options
 * @param {number} options.maxDepth - Maximum resolution depth (default: 10)
 * @param {Function} options.onProgress - Progress callback (nodeName, depth)
 * @returns {Object} Normalized dependency tree
 */
async function resolveFromRegistry(packageName, options = {}) {
  const maxDepth = options.maxDepth || DEFAULT_MAX_DEPTH;
  const onProgress = options.onProgress || (() => {});
  const visited = new Set();
  const downloadCache = new Map();

  async function getDownloads(name) {
    if (downloadCache.has(name)) return downloadCache.get(name);
    const dl = await fetchDownloads(name);
    downloadCache.set(name, dl);
    return dl;
  }

  async function resolve(name, versionRange, depth) {
    const nodeId = `${name}@${versionRange || 'latest'}`;
    
    // Prevent circular dependencies
    if (visited.has(nodeId)) {
      return {
        name,
        version: versionRange || 'latest',
        circular: true,
        dependencies: [],
        metadata: { description: '(circular reference)', license: 'UNKNOWN', maintainers: 0, maintainerNames: [], lastPublish: null, unpackedSize: 0, deprecated: false, homepage: '', repository: '' },
        downloads: 0,
        depth,
      };
    }

    // Cap depth
    if (depth > maxDepth) {
      return {
        name,
        version: versionRange || 'latest',
        truncated: true,
        dependencies: [],
        metadata: { description: '(depth limit reached)', license: 'UNKNOWN', maintainers: 0, maintainerNames: [], lastPublish: null, unpackedSize: 0, deprecated: false, homepage: '', repository: '' },
        downloads: 0,
        depth,
      };
    }

    visited.add(nodeId);
    onProgress(name, depth);

    try {
      const registryData = await fetchPackageData(name);
      const version = resolveVersion(registryData, versionRange);
      const versionData = (registryData.versions || {})[version];

      if (!versionData) {
        return {
          name,
          version: versionRange || 'unknown',
          error: 'Version not found',
          dependencies: [],
          metadata: { description: '', license: 'UNKNOWN', maintainers: 0, maintainerNames: [], lastPublish: null, unpackedSize: 0, deprecated: false, homepage: '', repository: '' },
          downloads: 0,
          depth,
        };
      }

      const metadata = extractMetadata(registryData, versionData);
      const downloads = await getDownloads(name);

      // Recursively resolve all dependencies
      const deps = versionData.dependencies || {};
      const depEntries = Object.entries(deps);
      
      // Resolve deps concurrently, but with a concurrency limit
      const children = [];
      const CONCURRENCY = 8;
      
      for (let i = 0; i < depEntries.length; i += CONCURRENCY) {
        const batch = depEntries.slice(i, i + CONCURRENCY);
        const results = await Promise.all(
          batch.map(([depName, depRange]) => 
            resolve(depName, depRange, depth + 1).catch(err => ({
              name: depName,
              version: depRange,
              error: err.message,
              dependencies: [],
              metadata: { description: '', license: 'UNKNOWN', maintainers: 0, maintainerNames: [], lastPublish: null, unpackedSize: 0, deprecated: false, homepage: '', repository: '' },
              downloads: 0,
              depth: depth + 1,
            }))
          )
        );
        children.push(...results);
      }

      return {
        name,
        version,
        dependencies: children,
        metadata,
        downloads,
        depth,
      };
    } catch (err) {
      return {
        name,
        version: versionRange || 'unknown',
        error: err.message,
        dependencies: [],
        metadata: { description: '', license: 'UNKNOWN', maintainers: 0, maintainerNames: [], lastPublish: null, unpackedSize: 0, deprecated: false, homepage: '', repository: '' },
        downloads: 0,
        depth,
      };
    }
  }

  return resolve(packageName, null, 0);
}

/**
 * Clear the registry cache.
 */
function clearCache() {
  registryCache.clear();
}

/**
 * Get cache statistics.
 */
function getCacheStats() {
  return {
    size: registryCache.size,
    packages: Array.from(registryCache.keys()),
  };
}

module.exports = {
  resolveFromRegistry,
  fetchPackageData,
  fetchDownloads,
  clearCache,
  getCacheStats,
};
