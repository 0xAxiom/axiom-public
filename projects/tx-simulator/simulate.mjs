#!/usr/bin/env node

/**
 * tx-simulator — dry-run EVM transactions against Base (or any chain) before submitting.
 * Shows: success/revert, gas used, return data (decoded if ABI provided), state diffs.
 * Zero dependencies. Uses eth_call + eth_estimateGas + debug_traceCall where available.
 */

const RPC_URLS = {
  base: 'https://mainnet.base.org',
  'base-sepolia': 'https://sepolia.base.org',
  ethereum: 'https://eth.llamarpc.com',
  sepolia: 'https://rpc.sepolia.org',
};

async function rpc(url, method, params) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const json = await res.json();
  if (json.error) throw new Error(`RPC error: ${json.error.message} (code ${json.error.code})`);
  return json.result;
}

function decodeRevertReason(hex) {
  if (!hex || hex === '0x') return null;
  // Error(string) selector: 0x08c379a0
  if (hex.startsWith('0x08c379a0') && hex.length >= 138) {
    const offset = parseInt(hex.slice(10, 74), 16);
    const length = parseInt(hex.slice(74, 138), 16);
    const start = 10 + offset * 2;
    const bytes = Buffer.from(hex.slice(start, start + length * 2), 'hex');
    return `Error: "${bytes.toString('utf8')}"`;
  }
  // Panic(uint256) selector: 0x4e487b71
  if (hex.startsWith('0x4e487b71') && hex.length >= 74) {
    const code = parseInt(hex.slice(10, 74), 16);
    const reasons = {
      0x00: 'generic compiler panic',
      0x01: 'assert failed',
      0x11: 'arithmetic overflow/underflow',
      0x12: 'division by zero',
      0x21: 'invalid enum value',
      0x22: 'storage encoding error',
      0x31: 'pop on empty array',
      0x32: 'array index out of bounds',
      0x41: 'out of memory',
      0x51: 'uninitialized function pointer',
    };
    return `Panic(0x${code.toString(16).padStart(2, '0')}): ${reasons[code] || 'unknown'}`;
  }
  // Custom error — return raw selector
  if (hex.length >= 10) {
    return `Custom error: selector ${hex.slice(0, 10)}, data ${hex.slice(10) || '(none)'}`;
  }
  return `Raw: ${hex}`;
}

function decodeFunctionReturn(hex, outputTypes) {
  if (!outputTypes || !outputTypes.length || !hex || hex === '0x') return null;
  // Basic ABI decoding for common types
  const results = [];
  let offset = 2; // skip 0x
  for (const type of outputTypes) {
    const word = hex.slice(offset, offset + 64);
    if (!word) break;
    if (type === 'address') {
      results.push(`0x${word.slice(24)}`);
    } else if (type === 'bool') {
      results.push(parseInt(word, 16) !== 0);
    } else if (type.startsWith('uint') || type.startsWith('int')) {
      const val = BigInt('0x' + word);
      results.push(val.toString());
    } else if (type === 'bytes32') {
      results.push(`0x${word}`);
    } else {
      results.push(`0x${word} (raw)`);
    }
    offset += 64;
  }
  return results;
}

async function simulate(rpcUrl, tx, opts = {}) {
  const results = { success: false, gasUsed: null, returnData: null, revertReason: null, warnings: [] };

  // Step 1: eth_call to check success/revert
  try {
    const callResult = await rpc(rpcUrl, 'eth_call', [tx, 'latest']);
    results.success = true;
    results.returnData = callResult;
    if (opts.outputTypes) {
      results.decodedReturn = decodeFunctionReturn(callResult, opts.outputTypes);
    }
  } catch (e) {
    results.success = false;
    // Try to extract revert data from error
    const match = e.message.match(/0x[0-9a-fA-F]+/);
    if (match) {
      results.revertReason = decodeRevertReason(match[0]);
      results.returnData = match[0];
    } else {
      results.revertReason = e.message;
    }
  }

  // Step 2: eth_estimateGas
  if (results.success) {
    try {
      const gasHex = await rpc(rpcUrl, 'eth_estimateGas', [tx]);
      results.gasUsed = parseInt(gasHex, 16);
    } catch (e) {
      results.warnings.push(`estimateGas failed: ${e.message}`);
    }
  }

  // Step 3: Get current gas price for cost estimation
  try {
    const gasPriceHex = await rpc(rpcUrl, 'eth_gasPrice', []);
    const gasPrice = BigInt(gasPriceHex);
    results.gasPrice = gasPrice.toString();
    results.gasPriceGwei = (Number(gasPrice) / 1e9).toFixed(4);
    if (results.gasUsed) {
      const cost = gasPrice * BigInt(results.gasUsed);
      results.estimatedCostWei = cost.toString();
      results.estimatedCostEth = (Number(cost) / 1e18).toFixed(8);
    }
  } catch (e) {
    results.warnings.push(`gasPrice fetch failed: ${e.message}`);
  }

  // Step 4: Try debug_traceCall for state diffs (not all RPCs support this)
  if (opts.trace && results.success) {
    try {
      const trace = await rpc(rpcUrl, 'debug_traceCall', [tx, 'latest', { tracer: 'prestateTracer', tracerConfig: { diffMode: true } }]);
      results.stateDiff = trace;
    } catch (e) {
      results.warnings.push('debug_traceCall not supported by this RPC');
    }
  }

  return results;
}

function formatResults(results) {
  const lines = [];
  lines.push('');
  lines.push(results.success ? '✓ Transaction would SUCCEED' : '✗ Transaction would REVERT');
  lines.push('─'.repeat(50));

  if (results.revertReason) {
    lines.push(`  Reason: ${results.revertReason}`);
  }

  if (results.gasUsed) {
    lines.push(`  Gas used: ${results.gasUsed.toLocaleString()}`);
  }

  if (results.gasPriceGwei) {
    lines.push(`  Gas price: ${results.gasPriceGwei} gwei`);
  }

  if (results.estimatedCostEth) {
    lines.push(`  Estimated cost: ${results.estimatedCostEth} ETH`);
  }

  if (results.decodedReturn) {
    lines.push(`  Return values: ${JSON.stringify(results.decodedReturn)}`);
  } else if (results.returnData && results.returnData !== '0x' && results.success) {
    lines.push(`  Return data: ${results.returnData.slice(0, 66)}${results.returnData.length > 66 ? '...' : ''}`);
  }

  if (results.stateDiff) {
    lines.push('  State changes:');
    const { pre, post } = results.stateDiff;
    if (post) {
      for (const [addr, state] of Object.entries(post)) {
        lines.push(`    ${addr.slice(0, 10)}...:`);
        if (state.balance) lines.push(`      balance: ${state.balance}`);
        if (state.nonce) lines.push(`      nonce: ${state.nonce}`);
        if (state.storage) {
          for (const [slot, val] of Object.entries(state.storage)) {
            lines.push(`      [${slot.slice(0, 10)}...] = ${val.slice(0, 18)}...`);
          }
        }
      }
    }
  }

  if (results.warnings.length) {
    lines.push('  Warnings:');
    results.warnings.forEach(w => lines.push(`    ⚠ ${w}`));
  }

  lines.push('');
  return lines.join('\n');
}

function usage() {
  console.log(`
tx-simulator — dry-run EVM transactions before submitting

Usage:
  simulate.mjs --to <address> --data <calldata> [options]
  simulate.mjs --raw <json> [options]

Options:
  --to <addr>         Target contract address
  --from <addr>       Sender address (default: zero address)
  --data <hex>        Calldata (hex encoded)
  --value <wei>       Value in wei (default: 0)
  --raw <json>        Full tx object as JSON string
  --chain <name>      Chain: base (default), base-sepolia, ethereum, sepolia
  --rpc <url>         Custom RPC URL (overrides --chain)
  --returns <types>   Comma-separated return types (e.g. uint256,address)
  --trace             Attempt debug_traceCall for state diffs
  --json              Output as JSON

Examples:
  # Simulate a USDC balanceOf call on Base
  simulate.mjs --to 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 \\
    --data 0x70a08231000000000000000000000000d8dA6BF26964aF9D7eEd9e03E53415D37aA96045 \\
    --returns uint256

  # Simulate a token transfer
  simulate.mjs --to 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 \\
    --from 0xYourWallet \\
    --data 0xa9059cbb... \\
    --returns bool

  # Full tx object
  simulate.mjs --raw '{"from":"0x...","to":"0x...","data":"0x...","value":"0x0"}'
`);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h') || args.length === 0) {
    usage();
    process.exit(0);
  }

  const getArg = (flag) => {
    const i = args.indexOf(flag);
    return i !== -1 && i + 1 < args.length ? args[i + 1] : null;
  };

  let tx = {};
  const rawJson = getArg('--raw');
  if (rawJson) {
    tx = JSON.parse(rawJson);
  } else {
    tx.to = getArg('--to');
    tx.from = getArg('--from') || '0x0000000000000000000000000000000000000000';
    tx.data = getArg('--data');
    const value = getArg('--value');
    if (value) tx.value = '0x' + BigInt(value).toString(16);
  }

  if (!tx.to) {
    console.error('Error: --to is required (or use --raw with a full tx object)');
    process.exit(1);
  }

  const chain = getArg('--chain') || 'base';
  const rpcUrl = getArg('--rpc') || RPC_URLS[chain];
  if (!rpcUrl) {
    console.error(`Unknown chain: ${chain}. Use --rpc to specify a custom URL.`);
    process.exit(1);
  }

  const outputTypes = getArg('--returns')?.split(',').map(t => t.trim()) || null;
  const trace = args.includes('--trace');
  const jsonOutput = args.includes('--json');

  const results = await simulate(rpcUrl, tx, { outputTypes, trace });

  if (jsonOutput) {
    console.log(JSON.stringify(results, null, 2));
  } else {
    console.log(formatResults(results));
  }

  process.exit(results.success ? 0 : 1);
}

main().catch(e => {
  console.error(`Fatal: ${e.message}`);
  process.exit(2);
});
