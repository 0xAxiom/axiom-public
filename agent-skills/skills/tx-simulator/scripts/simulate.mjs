#!/usr/bin/env node
// tx-simulator: Pre-flight EVM transaction simulation
// Usage: node simulate.mjs --rpc <url> --to <addr> [--from <addr>] [--data <hex>] [--value <wei>] [--json]
// Requires: Node.js 18+ (uses built-in fetch). Zero npm dependencies.

async function rpc(url, method, params) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const json = await res.json();
  if (json.error) {
    const err = new Error(json.error.message);
    err.code = json.error.code;
    err.data = json.error.data;
    throw err;
  }
  return json.result;
}

function decodeRevert(data) {
  if (!data || data === '0x') return { type: 'empty', message: 'No revert reason provided' };

  // Error(string) — selector 0x08c379a0
  if (data.startsWith('0x08c379a0')) {
    try {
      const hex = data.slice(10);
      const length = parseInt(hex.slice(64, 128), 16);
      const strHex = hex.slice(128, 128 + length * 2);
      const message = Buffer.from(strHex, 'hex').toString('utf8');
      return { type: 'Error', message };
    } catch {
      return { type: 'Error', message: 'Could not decode error string' };
    }
  }

  // Panic(uint256) — selector 0x4e487b71
  if (data.startsWith('0x4e487b71')) {
    const code = parseInt(data.slice(10, 74), 16);
    const messages = {
      0x00: 'Generic panic',
      0x01: 'assert() failed',
      0x11: 'Arithmetic overflow or underflow',
      0x12: 'Division or modulo by zero',
      0x21: 'Invalid enum value',
      0x22: 'Storage byte array incorrectly encoded',
      0x31: 'pop() on empty array',
      0x32: 'Array index out of bounds',
      0x41: 'Memory allocation overflow',
      0x51: 'Call to zero-initialized internal function pointer',
    };
    return { type: 'Panic', code: `0x${code.toString(16)}`, message: messages[code] || `Panic(0x${code.toString(16)})` };
  }

  // Custom error — try 4byte.directory
  const selector = data.slice(0, 10);
  return { type: 'CustomError', selector, message: `Custom error ${selector}`, raw: data };
}

async function lookup4byte(selector) {
  try {
    const res = await fetch(`https://www.4byte.directory/api/v1/signatures/?hex_signature=${selector}`, {
      signal: AbortSignal.timeout(3000),
    });
    const json = await res.json();
    if (json.results?.length > 0) return json.results[0].text_signature;
  } catch { /* best effort */ }
  return null;
}

function parseArgs(argv) {
  const flags = {};
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
        flags[key] = argv[i + 1];
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      rest.push(argv[i]);
    }
  }
  return { flags, rest };
}

async function main() {
  const { flags } = parseArgs(process.argv.slice(2));

  if (!flags.rpc || !flags.to) {
    console.error([
      'Usage: node simulate.mjs --rpc <url> --to <addr>',
      '         [--from <addr>] [--data <hex>] [--value <wei>] [--json]',
      '',
      'Options:',
      '  --rpc    RPC endpoint URL (required)',
      '  --to     Contract or recipient address (required)',
      '  --from   Sender address (enables balance check)',
      '  --data   Calldata hex (default: 0x)',
      '  --value  ETH value in wei (default: 0)',
      '  --json   JSON output mode',
      '',
      'Exit codes: 0 = simulation passed, 1 = reverted or error',
      '',
      'Examples:',
      '  # Simulate a transfer',
      '  node simulate.mjs --rpc https://mainnet.base.org \\',
      '    --from 0xSender --to 0xToken \\',
      '    --data 0xa9059cbb000000000000000000000000RECIPIENT000000000000000000000000000000000000000000000000000000000000000000000000000000000de0b6b3a7640000',
      '',
      '  # Simulate with ETH value',
      '  node simulate.mjs --rpc https://mainnet.base.org \\',
      '    --from 0xSender --to 0xContract --value 1000000000000000',
    ].join('\n'));
    process.exit(1);
  }

  const valueHex = flags.value ? `0x${BigInt(flags.value).toString(16)}` : '0x0';
  const txParams = { to: flags.to, data: flags.data || '0x', value: valueHex };
  if (flags.from) txParams.from = flags.from;

  const result = {
    success: false,
    simulation: null,
    gasEstimate: null,
    balanceCheck: null,
    errors: [],
  };

  // 1. eth_call simulation
  try {
    const returnData = await rpc(flags.rpc, 'eth_call', [txParams, 'latest']);
    result.simulation = { status: 'success', returnData };
    result.success = true;
  } catch (err) {
    const revert = decodeRevert(err.data || '0x');
    if (revert.type === 'CustomError') {
      const sig = await lookup4byte(revert.selector);
      if (sig) revert.signature = sig;
    }
    result.simulation = { status: 'reverted', revert };
  }

  // 2. eth_estimateGas
  try {
    const gasHex = await rpc(flags.rpc, 'eth_estimateGas', [txParams]);
    result.gasEstimate = { gas: parseInt(gasHex, 16), hex: gasHex };
  } catch (err) {
    result.errors.push({ step: 'gasEstimate', message: err.message });
  }

  // 3. Balance check (requires --from)
  if (flags.from) {
    try {
      const [balanceHex, gasPriceHex] = await Promise.all([
        rpc(flags.rpc, 'eth_getBalance', [flags.from, 'latest']),
        rpc(flags.rpc, 'eth_gasPrice', []),
      ]);
      const balance = BigInt(balanceHex);
      const gasPrice = BigInt(gasPriceHex);
      const valueWei = BigInt(valueHex);
      const gasCost = result.gasEstimate ? gasPrice * BigInt(result.gasEstimate.gas) : 0n;
      const totalCost = valueWei + gasCost;

      result.balanceCheck = {
        balanceWei: balance.toString(),
        balanceETH: (Number(balance) / 1e18).toFixed(6),
        gasPriceGwei: (Number(gasPrice) / 1e9).toFixed(2),
        estimatedGasWei: gasCost.toString(),
        estimatedTotalWei: totalCost.toString(),
        estimatedTotalETH: (Number(totalCost) / 1e18).toFixed(6),
        sufficient: balance >= totalCost,
      };
    } catch (err) {
      result.errors.push({ step: 'balanceCheck', message: err.message });
    }
  }

  if (flags.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    const icon = result.success ? '✅' : '❌';
    console.log(`\n${icon} Simulation: ${result.success ? 'PASS' : 'REVERT'}`);

    if (result.simulation?.revert) {
      const r = result.simulation.revert;
      const label = r.signature ? `${r.type}(${r.signature})` : r.type;
      console.log(`   Reason: [${label}] ${r.message}`);
      if (r.raw) console.log(`   Raw:    ${r.raw.slice(0, 66)}${r.raw.length > 66 ? '...' : ''}`);
    }

    if (result.simulation?.status === 'success' && result.simulation.returnData !== '0x') {
      console.log(`   Return: ${result.simulation.returnData.slice(0, 66)}${result.simulation.returnData.length > 66 ? '...' : ''}`);
    }

    if (result.gasEstimate) {
      console.log(`   Gas:    ${result.gasEstimate.gas.toLocaleString()}`);
    } else if (result.errors.find(e => e.step === 'gasEstimate')) {
      console.log(`   Gas:    estimate unavailable`);
    }

    if (result.balanceCheck) {
      const b = result.balanceCheck;
      const balIcon = b.sufficient ? '✅' : '⚠️  INSUFFICIENT';
      console.log(`   Sender: ${b.balanceETH} ETH ${balIcon}`);
      console.log(`   Cost:   ~${b.estimatedTotalETH} ETH @ ${b.gasPriceGwei} gwei`);
    }

    if (result.errors.length > 0 && result.errors.some(e => e.step !== 'gasEstimate')) {
      for (const e of result.errors) {
        if (e.step !== 'gasEstimate') console.log(`   Warn:   [${e.step}] ${e.message}`);
      }
    }

    console.log('');
  }

  process.exit(result.success ? 0 : 1);
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
