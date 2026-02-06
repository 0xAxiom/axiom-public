// Gas Estimation Engine — Estimates gas costs per callback

const GAS_COSTS = {
  sload: 2100,
  sstore_cold: 20000,
  sstore_warm: 100,
  tload: 100,
  tstore: 100,
  call_external: 2600,
  keccak256: 30,
  event_emit: 375,
  log_per_topic: 375,
  log_per_byte: 8,
  memory_word: 3,
  math_operation: 5,
  comparison: 3,
  mapping_access: 2200,  // sload + keccak
};

const CALLBACK_BASE_GAS = {
  beforeSwap: 2500,
  afterSwap: 2500,
  beforeAddLiquidity: 2000,
  afterAddLiquidity: 2500,
  beforeRemoveLiquidity: 2000,
  afterRemoveLiquidity: 2500,
  beforeInitialize: 1500,
  afterInitialize: 2000,
  beforeDonate: 1500,
  afterDonate: 1500,
};

export async function estimateGas(solidityCode) {
  const results = {
    errors: [],
    warnings: [],
    suggestions: [],
    gasEstimate: { total: 0, perCallback: {} }
  };

  try {
    const callbacks = extractCallbackBodies(solidityCode);
    
    for (const [name, body] of Object.entries(callbacks)) {
      const estimate = estimateCallbackGas(name, body);
      results.gasEstimate.perCallback[name] = estimate;
      results.gasEstimate.total += estimate.total;

      if (estimate.total > 100000) {
        results.warnings.push({
          type: 'high_gas_callback',
          message: `${name} estimated at ${estimate.total.toLocaleString()} gas — may be too expensive`,
          detail: `Breakdown: ${formatBreakdown(estimate.breakdown)}`,
          severity: 'warning'
        });
      }

      if (name === 'beforeSwap' && estimate.total > 50000) {
        results.warnings.push({
          type: 'beforeswap_gas_budget',
          message: `beforeSwap at ${estimate.total.toLocaleString()} gas exceeds recommended ~50k budget`,
          detail: 'Consider moving expensive operations to afterSwap or using transient storage',
          severity: 'warning'
        });
      }
    }

    // Suggestions for gas optimization
    if (solidityCode.includes('mapping') && !solidityCode.includes('tstore')) {
      results.suggestions.push({
        type: 'transient_storage_opportunity',
        message: 'Consider transient storage (tstore/tload) for per-tx state — saves ~19,900 gas per write',
        severity: 'suggestion'
      });
    }

    if (solidityCode.match(/event\s+\w+.*?\(/) && Object.keys(callbacks).some(c => c.startsWith('before'))) {
      results.suggestions.push({
        type: 'event_in_before_callback',
        message: 'Events in before* callbacks add gas. Consider deferring to after* callbacks.',
        severity: 'suggestion'
      });
    }

    return results;
  } catch (error) {
    results.errors.push({
      type: 'gas_estimation_error',
      message: `Gas estimation failed: ${error.message}`,
      severity: 'error'
    });
    return results;
  }
}

function extractCallbackBodies(code) {
  const bodies = {};
  const callbackNames = Object.keys(CALLBACK_BASE_GAS);

  for (const name of callbackNames) {
    const regex = new RegExp(`function\\s+${name}\\s*\\([^)]*\\)[^{]*\\{`, 'g');
    const match = regex.exec(code);
    if (match) {
      const startIdx = match.index + match[0].length;
      const body = extractFunctionBody(code, startIdx);
      if (body) bodies[name] = body;
    }
  }

  return bodies;
}

function extractFunctionBody(code, startIdx) {
  let depth = 1;
  let i = startIdx;
  while (i < code.length && depth > 0) {
    if (code[i] === '{') depth++;
    if (code[i] === '}') depth--;
    i++;
  }
  return code.slice(startIdx, i - 1);
}

function estimateCallbackGas(name, body) {
  const breakdown = {};
  let total = CALLBACK_BASE_GAS[name] || 2000;
  breakdown.base = CALLBACK_BASE_GAS[name] || 2000;

  // Count storage reads
  const sloadCount = countPattern(body, /\w+\s*\[.*?\]|(?:public|private|internal)\s+\w+\s+\w+/g);
  if (sloadCount > 0) {
    const cost = sloadCount * GAS_COSTS.sload;
    breakdown.storageReads = cost;
    total += cost;
  }

  // Count storage writes
  const sstoreCount = countPattern(body, /\w+\s*\[.*?\]\s*=|\w+\s*=(?!=)/g);
  if (sstoreCount > 0) {
    const cost = sstoreCount * GAS_COSTS.sstore_cold;
    breakdown.storageWrites = cost;
    total += cost;
  }

  // Count transient storage
  const tloadCount = countPattern(body, /tload\s*\(/g);
  const tstoreCount = countPattern(body, /tstore\s*\(/g);
  if (tloadCount + tstoreCount > 0) {
    const cost = tloadCount * GAS_COSTS.tload + tstoreCount * GAS_COSTS.tstore;
    breakdown.transientStorage = cost;
    total += cost;
  }

  // Count external calls
  const callCount = countPattern(body, /\.call\{|\.call\(|\.transfer\(|\.send\(|poolManager\.\w+/g);
  if (callCount > 0) {
    const cost = callCount * GAS_COSTS.call_external;
    breakdown.externalCalls = cost;
    total += cost;
  }

  // Count events
  const eventCount = countPattern(body, /emit\s+\w+/g);
  if (eventCount > 0) {
    const cost = eventCount * (GAS_COSTS.event_emit + GAS_COSTS.log_per_topic * 2);
    breakdown.events = cost;
    total += cost;
  }

  // Count hashing
  const hashCount = countPattern(body, /keccak256\s*\(|sha3\s*\(/g);
  if (hashCount > 0) {
    const cost = hashCount * GAS_COSTS.keccak256;
    breakdown.hashing = cost;
    total += cost;
  }

  // Count math
  const mathCount = countPattern(body, /[+\-*/%]/g);
  if (mathCount > 0) {
    const cost = Math.min(mathCount * GAS_COSTS.math_operation, 500);
    breakdown.math = cost;
    total += cost;
  }

  return { total, breakdown };
}

function countPattern(text, pattern) {
  const matches = text.match(pattern);
  return matches ? matches.length : 0;
}

function formatBreakdown(breakdown) {
  return Object.entries(breakdown)
    .filter(([_, cost]) => cost > 0)
    .map(([name, cost]) => `${name}: ${cost.toLocaleString()}`)
    .join(', ');
}
