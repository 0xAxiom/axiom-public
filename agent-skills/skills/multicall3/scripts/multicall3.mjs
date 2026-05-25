#!/usr/bin/env node
/**
 * multicall3.mjs — Batch EVM read calls in one JSON-RPC round-trip
 *
 * Uses Multicall3 at 0xcA11bde05977b3631167028862bE2a173976CA11
 * Deployed on 300+ EVM chains at the same address.
 * Zero dependencies. Pure Node.js 18+.
 *
 * Usage:
 *   # Pipe JSON array of call objects:
 *   echo '[{"target":"0x...","data":"0x70a08231...","decode":"uint256","label":"balance"}]' \
 *     | node multicall3.mjs --rpc https://mainnet.base.org
 *
 *   # Pass via flag:
 *   node multicall3.mjs --rpc https://mainnet.base.org --calls '[...]'
 *
 *   # Check ERC-20 balances for multiple addresses:
 *   node multicall3.mjs --rpc https://mainnet.base.org \
 *     --balanceOf 0xTokenAddr 0xHolder1 0xHolder2 0xHolder3
 *
 *   # Fetch token metadata (name, symbol, decimals, totalSupply):
 *   node multicall3.mjs --rpc https://mainnet.base.org \
 *     --tokenInfo 0xToken1 0xToken2
 *
 *   # Get ETH balances for multiple wallets:
 *   node multicall3.mjs --rpc https://mainnet.base.org \
 *     --ethBalance 0xWallet1 0xWallet2
 *
 * Call object schema:
 *   {
 *     target:       "0x..."        required  — contract address
 *     data:         "0x..."        required  — hex calldata (or use fn+args)
 *     fn:           "balanceOf"    optional  — built-in fn name (replaces data)
 *     args:         ["0x..."]      optional  — args for built-in fn
 *     decode:       "uint256"      optional  — uint256|address|bool|string|bytes|raw
 *     label:        "my-call"      optional  — label in output
 *     allowFailure: true           optional  — default true
 *   }
 *
 * Built-in fn names: balanceOf, allowance, totalSupply, decimals, symbol, name, getEthBalance
 * Output: JSON array of { label, target, success, raw, decoded }
 */

const MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11';
const SEL_AGGREGATE3 = '82ad56cb';

// ── Built-in function registry ────────────────────────────────────────────────
const BUILTINS = {
  balanceOf:     { sel: '70a08231', returns: 'uint256' },
  allowance:     { sel: 'dd62ed3e', returns: 'uint256' },
  totalSupply:   { sel: '18160ddd', returns: 'uint256' },
  decimals:      { sel: '313ce567', returns: 'uint256' },
  symbol:        { sel: '95d89b41', returns: 'string'  },
  name:          { sel: '06fdde03', returns: 'string'  },
  getEthBalance: { sel: '4d2301cc', returns: 'uint256' }, // Multicall3 built-in
};

// ── Minimal ABI encoder ──────────────────────────────────────────────────────

/** BigInt/number/string → 32-byte left-padded hex word (no 0x). */
function w32(n) {
  return BigInt(n).toString(16).padStart(64, '0');
}

/** Ethereum address → 32-byte word (no 0x). */
function wAddr(addr) {
  return addr.toLowerCase().replace('0x', '').padStart(64, '0');
}

/** Right-pad hex string to the next 32-byte (64-char) boundary. */
function rpad(hex) {
  return hex.padEnd(Math.ceil(Math.max(hex.length, 1) / 64) * 64, '0');
}

/** Encode a call argument as a 32-byte word: address or uint256. */
function encodeArg(arg) {
  if (typeof arg === 'string' && /^0x[0-9a-fA-F]{40}$/.test(arg)) return wAddr(arg);
  return w32(arg);
}

/** Build calldata for a built-in function. */
function encodeBuiltin(fn, args = []) {
  const b = BUILTINS[fn];
  if (!b) throw new Error(`Unknown built-in fn: "${fn}". Available: ${Object.keys(BUILTINS).join(', ')}`);
  return '0x' + b.sel + args.map(encodeArg).join('');
}

/**
 * Build aggregate3(Call3[]) calldata.
 * Call3 = (address target, bool allowFailure, bytes callData)
 *
 * Call3 is a dynamic struct (bytes field), so the array uses per-element offset pointers.
 * Layout:
 *   selector (4 bytes)
 *   params_offset = 32 (1 word)
 *   array_length = N
 *   N offset words (bytes from start of array data, i.e. after the length word)
 *   N struct bodies:
 *     target (32) | allowFailure (32) | bytesFieldOffset=96 (32) | bytesLen (32) | bytesData (padded)
 */
function buildCalldata(calls) {
  const N = calls.length;

  const bodies = calls.map(c => {
    const cd = (c.data || '').replace(/^0x/, '');
    const cdLen = cd.length / 2;
    return (
      wAddr(c.target) +
      w32(c.allowFailure === false ? 0 : 1) +
      w32(96) +    // offset to bytes field within struct = 3 * 32 = 96
      w32(cdLen) +
      (cdLen > 0 ? rpad(cd) : '')
    );
  });

  // Offsets: each is bytes from start of array data (right after length word)
  // Array data starts with N offset words, then the bodies
  let pos = N * 32;
  const offsets = bodies.map(b => {
    const o = pos;
    pos += b.length / 2;
    return w32(o);
  });

  const payload =
    w32(32) +           // offset to array from start of ABI params = 32 bytes
    w32(N) +            // array length
    offsets.join('') +
    bodies.join('');

  return '0x' + SEL_AGGREGATE3 + payload;
}

// ── ABI decoder ──────────────────────────────────────────────────────────────

/**
 * Decode aggregate3 response: Result[] where Result = (bool success, bytes returnData)
 *
 * Response layout:
 *   word 0: byte offset to array (= 32 → word 1)
 *   word 1: array length N
 *   words 2..N+1: per-element byte offsets (relative to word 1 = array data start)
 *   then element bodies:
 *     word 0: success (bool)
 *     word 1: byte offset to bytes within struct (= 64 → word 2 of struct)
 *     word 2: bytes length
 *     words 3+: bytes data
 */
function decodeResponse(hexStr) {
  const d = hexStr.replace(/^0x/, '');
  const u = i => parseInt(d.slice(i * 64, i * 64 + 64), 16);

  const arrBase = u(0) / 32;   // word index of array length (= 1)
  const N = u(arrBase);

  const results = [];
  for (let i = 0; i < N; i++) {
    // Byte offset of element i from array data start (word arrBase+1)
    const elemRelBytes = u(arrBase + 1 + i);
    const elemBase = arrBase + 1 + elemRelBytes / 32;

    const success = u(elemBase) === 1;

    // bytes field: offset pointer is at word elemBase+1, relative to struct start
    const bytesRelBytes = u(elemBase + 1);
    const bytesWordBase = elemBase + bytesRelBytes / 32;

    const bytesLen = u(bytesWordBase);
    const raw = bytesLen > 0
      ? '0x' + d.slice((bytesWordBase + 1) * 64, (bytesWordBase + 1) * 64 + bytesLen * 2)
      : '0x';

    results.push({ success, raw });
  }
  return results;
}

/**
 * Decode a single ABI return value from raw hex.
 * Handles: uint256, int256, address, bool, string, bytes, raw
 */
function decodeValue(raw, type) {
  const d = raw.replace(/^0x/, '');
  if (!d) return null;

  switch (type) {
    case 'uint256':
    case 'uint':
      return BigInt('0x' + d.slice(0, 64)).toString();

    case 'int256':
    case 'int': {
      const n = BigInt('0x' + d.slice(0, 64));
      const max = BigInt(1) << BigInt(255);
      return (n >= max ? n - (max << BigInt(1)) : n).toString();
    }

    case 'address':
      return '0x' + d.slice(24, 64);

    case 'bool':
      return parseInt(d.slice(0, 64), 16) !== 0;

    case 'string':
    case 'bytes': {
      try {
        const off = parseInt(d.slice(0, 64), 16) * 2;  // bytes to hex chars
        const len = parseInt(d.slice(off, off + 64), 16);
        const content = d.slice(off + 64, off + 64 + len * 2);
        return type === 'string'
          ? Buffer.from(content, 'hex').toString('utf8').replace(/\0/g, '')
          : '0x' + content;
      } catch {
        return raw;
      }
    }

    case 'raw':
    default:
      return raw;
  }
}

// ── RPC ──────────────────────────────────────────────────────────────────────

async function ethCall(rpc, data, block = 'latest') {
  const res = await fetch(rpc, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'eth_call',
      params: [{ to: MULTICALL3, data }, block],
    }),
  });
  const json = await res.json();
  if (json.error) throw new Error(`RPC error ${json.error.code}: ${json.error.message}`);
  if (!json.result) throw new Error('Empty RPC result — is Multicall3 deployed on this chain?');
  return json.result;
}

// ── Argument parsing helpers ─────────────────────────────────────────────────

function flagValue(args, flag) {
  const i = args.indexOf(flag);
  return i !== -1 ? args[i + 1] : null;
}

/** Collect 0x addresses immediately after a flag, stopping at next flag. */
function collectAddrs(args, fromIdx) {
  const out = [];
  for (let i = fromIdx; i < args.length; i++) {
    if (args[i].startsWith('-')) break;
    if (/^0x[0-9a-fA-F]{40}$/i.test(args[i])) out.push(args[i]);
  }
  return out;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
multicall3.mjs — batch EVM reads in one RPC call

  --rpc <url>                  RPC endpoint (or set RPC_URL env)
  --calls <json>               JSON array of call objects
  --balanceOf <token> <a>...   ERC-20 balanceOf for multiple addresses
  --allowance <tok> <own> <sp> ERC-20 allowance check
  --tokenInfo <token>...       name + symbol + decimals + totalSupply
  --ethBalance <addr>...       Native ETH balances
  --block <tag>                Block tag (default: latest)
  --silent                     Suppress stderr, output JSON only

Call object: { target, data|fn, args?, decode?, label?, allowFailure? }
Built-in fn: ${Object.keys(BUILTINS).join(', ')}
decode:      uint256 | address | bool | string | bytes | raw
`);
    process.exit(0);
  }

  const rpc = flagValue(args, '--rpc') || process.env.RPC_URL || 'https://mainnet.base.org';
  const block = flagValue(args, '--block') || 'latest';
  const silent = args.includes('--silent');

  const calls = [];

  // --calls JSON
  const callsStr = flagValue(args, '--calls');
  if (callsStr) {
    const parsed = JSON.parse(callsStr);
    calls.push(...(Array.isArray(parsed) ? parsed : [parsed]));
  }

  // --balanceOf <token> <addr1> <addr2> ...
  const bofIdx = args.indexOf('--balanceOf');
  if (bofIdx !== -1) {
    const token = args[bofIdx + 1];
    if (!token || !/^0x[0-9a-fA-F]{40}$/i.test(token))
      throw new Error('--balanceOf: first arg must be a token address');
    for (const h of collectAddrs(args, bofIdx + 2)) {
      calls.push({
        target: token, fn: 'balanceOf', args: [h],
        decode: 'uint256', label: `balanceOf(${h.slice(0, 8)}...)`,
      });
    }
  }

  // --allowance <token> <owner> <spender>
  const alIdx = args.indexOf('--allowance');
  if (alIdx !== -1) {
    const [token, owner, spender] = [args[alIdx + 1], args[alIdx + 2], args[alIdx + 3]];
    calls.push({
      target: token, fn: 'allowance', args: [owner, spender],
      decode: 'uint256', label: `allowance(${owner.slice(0, 8)}..., ${spender.slice(0, 8)}...)`,
    });
  }

  // --tokenInfo <token1> <token2> ...
  const tiIdx = args.indexOf('--tokenInfo');
  if (tiIdx !== -1) {
    for (const t of collectAddrs(args, tiIdx + 1)) {
      for (const fn of ['name', 'symbol', 'decimals', 'totalSupply']) {
        calls.push({
          target: t, fn, args: [],
          decode: BUILTINS[fn].returns,
          label: `${fn}(${t.slice(0, 8)}...)`,
        });
      }
    }
  }

  // --ethBalance <addr1> <addr2> ...
  const ebIdx = args.indexOf('--ethBalance');
  if (ebIdx !== -1) {
    for (const a of collectAddrs(args, ebIdx + 1)) {
      calls.push({
        target: MULTICALL3, fn: 'getEthBalance', args: [a],
        decode: 'uint256', label: `ethBalance(${a.slice(0, 8)}...)`,
      });
    }
  }

  // Stdin JSON (when no --calls was given)
  if (!callsStr && !process.stdin.isTTY) {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString().trim();
    if (raw) {
      const parsed = JSON.parse(raw);
      calls.push(...(Array.isArray(parsed) ? parsed : [parsed]));
    }
  }

  if (calls.length === 0) {
    console.error('No calls provided. Use --calls, --balanceOf, --tokenInfo, --ethBalance, or pipe JSON.\nRun with --help for usage.');
    process.exit(1);
  }

  // Resolve built-in fn shortcuts
  for (const c of calls) {
    if (!c.data && c.fn) {
      c.data = encodeBuiltin(c.fn, c.args || []);
      if (!c.decode) c.decode = BUILTINS[c.fn]?.returns;
    }
    if (!c.data) throw new Error(`Call "${c.label || JSON.stringify(c)}" missing both "data" and "fn"`);
    c.allowFailure = c.allowFailure !== false;
  }

  if (!silent) process.stderr.write(`Batching ${calls.length} call(s) via Multicall3 on ${rpc} @ ${block}...\n`);

  const calldata = buildCalldata(calls);
  const responseHex = await ethCall(rpc, calldata, block);
  const raw = decodeResponse(responseHex);

  const output = raw.map((r, i) => {
    const c = calls[i];
    return {
      label:   c.label || `call_${i}`,
      target:  c.target,
      success: r.success,
      raw:     r.raw,
      decoded: r.success && c.decode ? decodeValue(r.raw, c.decode) : null,
    };
  });

  console.log(JSON.stringify(output, null, 2));

  if (output.some(r => !r.success)) process.exit(1);
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
