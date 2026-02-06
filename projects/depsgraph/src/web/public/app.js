/**
 * depsgraph — Web Dashboard
 * 
 * Interactive force-directed graph visualization with D3.js
 * Dark theme, Bloomberg × Apple aesthetic
 */

(function () {
  'use strict';

  // ---- State ----
  let currentData = null;
  let simulation = null;
  let selectedNode = null;
  let highlightedPath = null;

  // ---- DOM refs ----
  const searchInput = document.getElementById('search-input');
  const statsBar = document.getElementById('stats-bar');
  const landing = document.getElementById('landing');
  const loadingEl = document.getElementById('loading');
  const loadingText = document.getElementById('loading-text');
  const loadingDetail = document.getElementById('loading-detail');
  const errorState = document.getElementById('error-state');
  const errorMessage = document.getElementById('error-message');
  const errorRetry = document.getElementById('error-retry');
  const graphContainer = document.getElementById('graph-container');
  const graphSvg = document.getElementById('graph-svg');
  const tooltip = document.getElementById('tooltip');
  const tooltipName = document.getElementById('tooltip-name');
  const tooltipVersion = document.getElementById('tooltip-version');
  const tooltipRisk = document.getElementById('tooltip-risk');
  const tooltipMeta = document.getElementById('tooltip-meta');
  const sidePanel = document.getElementById('side-panel');
  const panelTitle = document.getElementById('panel-title');
  const panelBody = document.getElementById('panel-body');
  const panelClose = document.getElementById('panel-close');
  const nodeFilter = document.getElementById('node-filter');
  const filterInput = document.getElementById('filter-input');
  const btnJson = document.getElementById('btn-json');
  const btnReset = document.getElementById('btn-reset');

  // ---- Risk colors ----
  const riskColors = {
    low: '#22c55e',
    medium: '#eab308',
    high: '#f97316',
    critical: '#ef4444',
  };

  // ---- Utility ----
  function formatBytes(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
  }

  function formatNumber(n) {
    if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
    if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
    return String(n);
  }

  // ---- State transitions ----
  function showLanding() {
    landing.classList.remove('hidden');
    loadingEl.classList.add('hidden');
    errorState.classList.add('hidden');
    graphContainer.classList.add('hidden');
    statsBar.classList.add('hidden');
    nodeFilter.classList.add('hidden');
  }

  function showLoading(msg) {
    landing.classList.add('hidden');
    loadingEl.classList.remove('hidden');
    errorState.classList.add('hidden');
    graphContainer.classList.add('hidden');
    statsBar.classList.add('hidden');
    nodeFilter.classList.add('hidden');
    loadingText.textContent = msg || 'Resolving dependencies…';
    loadingDetail.textContent = '';
  }

  function showError(msg) {
    landing.classList.add('hidden');
    loadingEl.classList.add('hidden');
    errorState.classList.remove('hidden');
    graphContainer.classList.add('hidden');
    statsBar.classList.add('hidden');
    nodeFilter.classList.add('hidden');
    errorMessage.textContent = msg;
  }

  function showGraph() {
    landing.classList.add('hidden');
    loadingEl.classList.add('hidden');
    errorState.classList.add('hidden');
    graphContainer.classList.remove('hidden');
    statsBar.classList.remove('hidden');
    nodeFilter.classList.remove('hidden');
    btnJson.disabled = false;
    btnReset.disabled = false;
  }

  // ---- API ----
  async function analyzePackage(name) {
    showLoading(`Analyzing ${name}…`);
    loadingDetail.textContent = 'Fetching from npm registry…';

    try {
      const res = await fetch(`/api/analyze/${encodeURIComponent(name)}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      currentData = data;
      updateStats(data.graph.stats, data.riskReport);
      renderGraph(data.graph);
      showGraph();
    } catch (err) {
      showError(err.message);
    }
  }

  // ---- Stats bar ----
  function updateStats(stats, risk) {
    document.getElementById('stat-packages').textContent = stats.totalPackages;
    document.getElementById('stat-size').textContent = stats.totalSizeFormatted;
    document.getElementById('stat-depth').textContent = stats.maxDepth;
    document.getElementById('stat-direct').textContent = stats.directDeps;
    document.getElementById('stat-transitive').textContent = stats.transitiveDeps;
    document.getElementById('stat-risk').textContent = stats.avgRiskScore;
    document.getElementById('stat-risk').style.color = riskColors[risk.overallLevel] || '#888';

    const dist = stats.riskDistribution || {};
    document.getElementById('risk-low-count').textContent = dist.low || 0;
    document.getElementById('risk-medium-count').textContent = dist.medium || 0;
    document.getElementById('risk-high-count').textContent = dist.high || 0;
    document.getElementById('risk-critical-count').textContent = dist.critical || 0;
  }

  // ---- Graph rendering ----
  function renderGraph(graph) {
    // Clear existing
    d3.select(graphSvg).selectAll('*').remove();

    const width = graphContainer.clientWidth;
    const height = graphContainer.clientHeight;

    const svg = d3.select(graphSvg)
      .attr('width', width)
      .attr('height', height)
      .attr('viewBox', [0, 0, width, height]);

    // Zoom container
    const g = svg.append('g');
    
    const zoom = d3.zoom()
      .scaleExtent([0.1, 8])
      .on('zoom', (event) => {
        g.attr('transform', event.transform);
      });

    svg.call(zoom);

    // Build node/edge data
    const nodes = graph.nodes.map(d => ({ ...d }));
    const edges = graph.edges.map(d => ({ ...d }));

    // Node radius scale (by size, min 4, max 24)
    const sizeExtent = d3.extent(nodes, d => d.size || 1);
    const radiusScale = d3.scaleSqrt()
      .domain([sizeExtent[0] || 1, Math.max(sizeExtent[1] || 1, 1)])
      .range([4, 22]);

    // Force simulation
    simulation = d3.forceSimulation(nodes)
      .force('link', d3.forceLink(edges)
        .id(d => d.id)
        .distance(d => {
          const sourceDepth = typeof d.source === 'object' ? d.source.depth : 0;
          return 40 + sourceDepth * 15;
        })
        .strength(0.4)
      )
      .force('charge', d3.forceManyBody()
        .strength(d => d.depth === 0 ? -400 : -80 - (d.size || 0) / 50000)
        .distanceMax(400)
      )
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide()
        .radius(d => radiusScale(d.size || 1) + 2)
      )
      .alphaDecay(0.02)
      .velocityDecay(0.3);

    // ---- Edges ----
    const link = g.append('g')
      .attr('class', 'edges')
      .selectAll('line')
      .data(edges)
      .join('line')
      .attr('stroke', d => d.type === 'direct' ? '#444' : '#222')
      .attr('stroke-width', d => d.type === 'direct' ? 1.2 : 0.6)
      .attr('stroke-opacity', d => d.type === 'direct' ? 0.6 : 0.25);

    // ---- Nodes ----
    const node = g.append('g')
      .attr('class', 'nodes')
      .selectAll('g')
      .data(nodes)
      .join('g')
      .attr('cursor', 'pointer')
      .call(drag(simulation));

    // Node circles
    node.append('circle')
      .attr('r', d => d.depth === 0 ? 20 : radiusScale(d.size || 1))
      .attr('fill', d => {
        const color = riskColors[d.riskLevel] || '#666';
        return d.depth === 0 ? color : color;
      })
      .attr('fill-opacity', d => d.depth === 0 ? 0.9 : 0.7)
      .attr('stroke', d => {
        const color = riskColors[d.riskLevel] || '#666';
        return color;
      })
      .attr('stroke-width', d => d.depth === 0 ? 2.5 : 1)
      .attr('stroke-opacity', 0.4);

    // Root node label (always visible)
    node.filter(d => d.depth === 0)
      .append('text')
      .attr('text-anchor', 'middle')
      .attr('dy', 32)
      .attr('fill', '#e0e0e0')
      .attr('font-size', '12px')
      .attr('font-weight', '600')
      .attr('font-family', 'Inter, system-ui, sans-serif')
      .text(d => d.name);

    // Direct dependency labels
    node.filter(d => d.depth === 1)
      .append('text')
      .attr('text-anchor', 'middle')
      .attr('dy', d => radiusScale(d.size || 1) + 14)
      .attr('fill', '#888')
      .attr('font-size', '10px')
      .attr('font-weight', '400')
      .attr('font-family', 'Inter, system-ui, sans-serif')
      .text(d => d.name);

    // ---- Interactions ----

    // Hover: tooltip
    node.on('mouseenter', (event, d) => {
      showTooltip(event, d);
      highlightConnections(d, nodes, edges, node, link);
    })
    .on('mousemove', (event) => {
      moveTooltip(event);
    })
    .on('mouseleave', () => {
      hideTooltip();
      resetHighlight(node, link);
    });

    // Click: side panel
    node.on('click', (event, d) => {
      event.stopPropagation();
      openPanel(d, graph);
    });

    // Click background: close panel
    svg.on('click', () => {
      closePanel();
    });

    // ---- Simulation tick ----
    simulation.on('tick', () => {
      link
        .attr('x1', d => d.source.x)
        .attr('y1', d => d.source.y)
        .attr('x2', d => d.target.x)
        .attr('y2', d => d.target.y);

      node.attr('transform', d => `translate(${d.x},${d.y})`);
    });

    // Initial zoom to fit
    simulation.on('end', () => {
      zoomToFit(svg, g, zoom, width, height, nodes);
    });

    // Save zoom for reset button
    btnReset.onclick = () => {
      svg.transition().duration(500).call(zoom.transform, d3.zoomIdentity);
      setTimeout(() => zoomToFit(svg, g, zoom, width, height, nodes), 550);
    };

    // ---- Filter ----
    filterInput.addEventListener('input', () => {
      const query = filterInput.value.toLowerCase().trim();
      
      if (!query) {
        node.select('circle').attr('fill-opacity', d => d.depth === 0 ? 0.9 : 0.7);
        node.selectAll('text').attr('fill-opacity', 1);
        link.attr('stroke-opacity', d => d.type === 'direct' ? 0.6 : 0.25);
        return;
      }

      node.select('circle').attr('fill-opacity', d => 
        d.name.toLowerCase().includes(query) ? 0.9 : 0.08
      );
      node.selectAll('text').attr('fill-opacity', d => 
        d.name.toLowerCase().includes(query) ? 1 : 0.1
      );
      link.attr('stroke-opacity', 0.05);
    });
  }

  // ---- Drag behavior ----
  function drag(sim) {
    return d3.drag()
      .on('start', (event, d) => {
        if (!event.active) sim.alphaTarget(0.1).restart();
        d.fx = d.x;
        d.fy = d.y;
      })
      .on('drag', (event, d) => {
        d.fx = event.x;
        d.fy = event.y;
      })
      .on('end', (event, d) => {
        if (!event.active) sim.alphaTarget(0);
        d.fx = null;
        d.fy = null;
      });
  }

  // ---- Zoom to fit ----
  function zoomToFit(svg, g, zoom, width, height, nodes) {
    if (nodes.length === 0) return;

    const xExtent = d3.extent(nodes, d => d.x);
    const yExtent = d3.extent(nodes, d => d.y);
    
    const dx = (xExtent[1] || 0) - (xExtent[0] || 0);
    const dy = (yExtent[1] || 0) - (yExtent[0] || 0);
    const cx = ((xExtent[0] || 0) + (xExtent[1] || 0)) / 2;
    const cy = ((yExtent[0] || 0) + (yExtent[1] || 0)) / 2;

    const scale = Math.min(
      0.85 * width / Math.max(dx, 1),
      0.85 * height / Math.max(dy, 1),
      2
    );
    
    const tx = width / 2 - cx * scale;
    const ty = height / 2 - cy * scale;

    svg.transition().duration(800).ease(d3.easeCubicInOut)
      .call(zoom.transform, d3.zoomIdentity.translate(tx, ty).scale(scale));
  }

  // ---- Highlight connections ----
  function highlightConnections(d, nodes, edges, nodeSelection, linkSelection) {
    const connected = new Set([d.id]);
    
    for (const edge of edges) {
      const sourceId = typeof edge.source === 'object' ? edge.source.id : edge.source;
      const targetId = typeof edge.target === 'object' ? edge.target.id : edge.target;
      
      if (sourceId === d.id) connected.add(targetId);
      if (targetId === d.id) connected.add(sourceId);
    }

    nodeSelection.select('circle')
      .attr('fill-opacity', n => connected.has(n.id) ? 0.9 : 0.08)
      .attr('stroke-opacity', n => connected.has(n.id) ? 0.6 : 0.05);
    
    nodeSelection.selectAll('text')
      .attr('fill-opacity', n => connected.has(n.id) ? 1 : 0.05);

    linkSelection
      .attr('stroke-opacity', e => {
        const sourceId = typeof e.source === 'object' ? e.source.id : e.source;
        const targetId = typeof e.target === 'object' ? e.target.id : e.target;
        return (sourceId === d.id || targetId === d.id) ? 0.8 : 0.03;
      })
      .attr('stroke-width', e => {
        const sourceId = typeof e.source === 'object' ? e.source.id : e.source;
        const targetId = typeof e.target === 'object' ? e.target.id : e.target;
        return (sourceId === d.id || targetId === d.id) ? 2 : 0.5;
      });
  }

  function resetHighlight(nodeSelection, linkSelection) {
    nodeSelection.select('circle')
      .attr('fill-opacity', d => d.depth === 0 ? 0.9 : 0.7)
      .attr('stroke-opacity', 0.4);
    
    nodeSelection.selectAll('text')
      .attr('fill-opacity', 1);

    linkSelection
      .attr('stroke-opacity', d => d.type === 'direct' ? 0.6 : 0.25)
      .attr('stroke-width', d => d.type === 'direct' ? 1.2 : 0.6);
  }

  // ---- Tooltip ----
  function showTooltip(event, d) {
    tooltipName.textContent = d.name;
    tooltipVersion.textContent = `v${d.version}`;
    
    const riskColor = riskColors[d.riskLevel] || '#666';
    tooltipRisk.textContent = `Risk: ${d.riskScore} (${d.riskLevel})`;
    tooltipRisk.style.background = `${riskColor}18`;
    tooltipRisk.style.color = riskColor;

    tooltipMeta.innerHTML = `
      <div><span class="meta-label">Size</span><span class="meta-value">${formatBytes(d.size)}</span></div>
      <div><span class="meta-label">License</span><span class="meta-value">${d.license}</span></div>
      <div><span class="meta-label">Maintainers</span><span class="meta-value">${d.maintainers}</span></div>
      <div><span class="meta-label">Downloads</span><span class="meta-value">${formatNumber(d.downloads)}/wk</span></div>
      <div><span class="meta-label">Depth</span><span class="meta-value">${d.depth}</span></div>
      ${d.deprecated ? '<div><span class="meta-value" style="color:#ef4444">⚠ DEPRECATED</span></div>' : ''}
    `;

    tooltip.classList.remove('hidden');
    moveTooltip(event);
  }

  function moveTooltip(event) {
    const x = event.clientX + 16;
    const y = event.clientY - 10;
    tooltip.style.left = `${x}px`;
    tooltip.style.top = `${y}px`;
  }

  function hideTooltip() {
    tooltip.classList.add('hidden');
  }

  // ---- Side Panel ----
  function openPanel(d, graph) {
    selectedNode = d;
    panelTitle.textContent = d.name;

    // Count dependents
    const dependents = graph.edges.filter(e => {
      const targetId = typeof e.target === 'object' ? e.target.id : e.target;
      return targetId === d.id;
    }).length;

    // Count dependencies (outgoing)
    const depCount = graph.edges.filter(e => {
      const sourceId = typeof e.source === 'object' ? e.source.id : e.source;
      return sourceId === d.id;
    }).length;

    let html = `
      <div class="panel-section">
        <div class="panel-section-title">Package Info</div>
        <div class="panel-field">
          <span class="panel-field-label">Version</span>
          <span class="panel-field-value">${d.version}</span>
        </div>
        <div class="panel-field">
          <span class="panel-field-label">Size</span>
          <span class="panel-field-value">${formatBytes(d.size)}</span>
        </div>
        <div class="panel-field">
          <span class="panel-field-label">License</span>
          <span class="panel-field-value">${d.license}</span>
        </div>
        <div class="panel-field">
          <span class="panel-field-label">Maintainers</span>
          <span class="panel-field-value">${d.maintainers}</span>
        </div>
        <div class="panel-field">
          <span class="panel-field-label">Downloads</span>
          <span class="panel-field-value">${formatNumber(d.downloads)}/wk</span>
        </div>
        <div class="panel-field">
          <span class="panel-field-label">Depth</span>
          <span class="panel-field-value">${d.depth}</span>
        </div>
        <div class="panel-field">
          <span class="panel-field-label">Dependencies</span>
          <span class="panel-field-value">${depCount}</span>
        </div>
        <div class="panel-field">
          <span class="panel-field-label">Dependents</span>
          <span class="panel-field-value">${dependents}</span>
        </div>
        ${d.deprecated ? '<div class="panel-field"><span class="panel-field-label">Status</span><span class="panel-field-value" style="color:#ef4444">DEPRECATED</span></div>' : ''}
      </div>

      <div class="panel-section">
        <div class="panel-section-title">Risk Assessment</div>
        <div class="panel-field">
          <span class="panel-field-label">Overall Risk</span>
          <span class="risk-badge risk-badge-${d.riskLevel}">${d.riskScore} — ${d.riskLevel}</span>
        </div>
        <div class="panel-risk-factors">
    `;

    // Risk factor bars
    if (d.riskFactors) {
      const factorLabels = {
        publishAge: 'Publish Age',
        maintainerCount: 'Maintainers',
        depth: 'Tree Depth',
        downloads: 'Downloads',
        size: 'Package Size',
        deprecated: 'Deprecated',
        license: 'License',
      };

      for (const [key, factor] of Object.entries(d.riskFactors)) {
        const color = factor.score <= 25 ? riskColors.low : 
                      factor.score <= 50 ? riskColors.medium :
                      factor.score <= 75 ? riskColors.high : riskColors.critical;
        
        html += `
          <div class="risk-factor-row">
            <span class="risk-factor-name">${factorLabels[key] || key}</span>
            <div class="risk-factor-bar-container">
              <div class="risk-factor-bar">
                <div class="risk-factor-bar-fill" style="width: ${factor.score}%; background: ${color}"></div>
              </div>
              <span class="risk-factor-score">${factor.score}</span>
            </div>
          </div>
        `;
      }
    }

    html += `
        </div>
      </div>
      ${d.description ? `<div class="panel-section"><div class="panel-section-title">Description</div><p style="font-size:12px;color:#888;line-height:1.5">${d.description}</p></div>` : ''}
      <div class="panel-section">
        <a class="panel-link" href="https://www.npmjs.com/package/${d.name}" target="_blank" rel="noopener">View on npm ↗</a>
      </div>
    `;

    panelBody.innerHTML = html;
    sidePanel.classList.remove('hidden');
    sidePanel.classList.add('visible');
  }

  function closePanel() {
    selectedNode = null;
    sidePanel.classList.remove('visible');
    setTimeout(() => {
      if (!sidePanel.classList.contains('visible')) {
        sidePanel.classList.add('hidden');
      }
    }, 200);
  }

  // ---- Event handlers ----
  
  // Search
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const query = searchInput.value.trim();
      if (query) {
        analyzePackage(query);
      }
    }
  });

  // Example buttons
  document.querySelectorAll('.example-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const pkg = btn.dataset.package;
      searchInput.value = pkg;
      analyzePackage(pkg);
    });
  });

  // Error retry
  errorRetry.addEventListener('click', () => {
    const query = searchInput.value.trim();
    if (query) {
      analyzePackage(query);
    } else {
      showLanding();
    }
  });

  // Close panel
  panelClose.addEventListener('click', closePanel);

  // Export JSON
  btnJson.addEventListener('click', () => {
    if (!currentData) return;
    const blob = new Blob([JSON.stringify(currentData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `depsgraph-${currentData.package}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    // Cmd/Ctrl + K — focus search
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      searchInput.focus();
      searchInput.select();
    }
    
    // Escape — close panel or clear filter
    if (e.key === 'Escape') {
      if (sidePanel.classList.contains('visible')) {
        closePanel();
      } else {
        filterInput.value = '';
        filterInput.dispatchEvent(new Event('input'));
      }
    }

    // / — focus filter
    if (e.key === '/' && document.activeElement !== searchInput && document.activeElement !== filterInput) {
      e.preventDefault();
      filterInput.focus();
    }
  });

  // Window resize
  window.addEventListener('resize', () => {
    if (currentData) {
      renderGraph(currentData.graph);
    }
  });

  // ---- Auto-analyze from URL hash ----
  const hashPkg = window.location.hash.slice(1);
  if (hashPkg) {
    searchInput.value = hashPkg;
    analyzePackage(hashPkg);
  }

  // ---- Check for server-provided package ----
  const urlParams = new URLSearchParams(window.location.search);
  const pkgParam = urlParams.get('package') || urlParams.get('pkg');
  if (pkgParam) {
    searchInput.value = pkgParam;
    analyzePackage(pkgParam);
  }

})();
