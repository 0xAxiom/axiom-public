#!/usr/bin/env node
/**
 * decode-event.js
 * Pure Node.js EVM event log decoder — no ethers, no web3, no dependencies.
 *
 * Usage (library):
 *   const { decodeEvent, decodeRawLog } = require('./decode-event');
 *
 * Usage (CLI):
 *   node decode-event.js '<abiJson>' '<topicsJson>' '<dataHex>'
 *
 * Example CLI:
 *   node decode-event.js \
 *     '{"name":"Transfer","inputs":[{"name":"from","type":"address","indexed":true},{"name":"to","type":"address","indexed":true},{"name":"value","type":"uint256","indexed":false}]}' \
 *     '["0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef","0x000000000000000000000000abcdef1234567890abcdef1234567890abcdef12","0x000000000000000000000000fedcba9876543210fedcba9876543210fedcba98"]' \
 *     '0x000000000000000000000000000000000000000000000006f05b59d3b2000000'
 */

'use strict';

// ─── Type helpers ────────────────────────────────────────────────────────────

function isDynamic(type) {
  if (type === 'bytes' || type === 'string') return true;
  if (type.endsWith('[]')) return true;
  // dynamic-length tuple array handled by []
  return false;
}

function baseType(type) {
  // e.g. "uint256[]" -> "uint256", "bytes32" -> "bytes32"
  return type.replace(/\[\d*\]$/, '');
}

// ─── Single-slot decoder ─────────────────────────────────────────────────────

/**
 * Decode a static 32-byte slot for the given Solidity type.
 * Dynamic types stored as indexed topics come through as keccak256 hashes —
 * we return the raw hash with a warning since they can't be recovered.
 */
function decodeSlot(type, hex64) {
  const slot = hex64.replace(/^0x/, '').padStart(64, '0');

  if (type === 'address') {
    return '0x' + slot.slice(24); // lower 20 bytes
  }

  if (type === 'bool') {
    return BigInt('0x' + slot) !== 0n;
  }

  if (type.startsWith('uint')) {
    return BigInt('0x' + slot);
  }

  if (type.startsWith('int')) {
    const bits = parseInt(type.replace('int', ''), 10) || 256;
    const raw = BigInt('0x' + slot);
    const maxPositive = 2n ** BigInt(bits - 1);
    return raw >= maxPositive ? raw - 2n ** BigInt(bits) : raw;
  }

  if (type === 'bytes32') {
    return '0x' + slot;
  }

  if (type.match(/^bytes\d+$/)) {
    const byteLen = parseInt(type.replace('bytes', ''), 10);
    return '0x' + slot.slice(0, byteLen * 2);
  }

  // Dynamic type stored as a topic — only the keccak256 hash is available
  if (type === 'bytes' || type === 'string') {
    return { hash: '0x' + slot, note: `${type} indexed — keccak256 hash only, value unrecoverable` };
  }

  // Fallback: return raw hex
  return '0x' + slot;
}

// ─── Tuple (data field) decoder ──────────────────────────────────────────────

/**
 * Decode an ABI-encoded tuple from a hex data blob.
 * types  — array of Solidity type strings (non-indexed params in order)
 * hex    — hex string WITHOUT 0x prefix
 */
function decodeAbiTuple(types, hex) {
  if (types.length === 0) return [];

  const results = [];
  const wordLen = 64; // 32 bytes = 64 hex chars
  let headOffset = 0;
  const heads = [];

  // First pass: collect head words
  for (let i = 0; i < types.length; i++) {
    const word = hex.slice(headOffset, headOffset + wordLen).padEnd(wordLen, '0');
    heads.push(word);
    headOffset += wordLen;
  }

  // Second pass: decode each type
  for (let i = 0; i < types.length; i++) {
    const type = types[i];

    if (isDynamic(type)) {
      // Head word is a byte offset into the data blob
      const byteOffset = Number(BigInt('0x' + heads[i]));
      const hexOffset = byteOffset * 2;

      if (type === 'string' || type === 'bytes') {
        const lenWord = hex.slice(hexOffset, hexOffset + wordLen);
        const byteLen = Number(BigInt('0x' + lenWord));
        const dataHex = hex.slice(hexOffset + wordLen, hexOffset + wordLen + byteLen * 2);
        if (type === 'string') {
          results.push(Buffer.from(dataHex, 'hex').toString('utf8'));
        } else {
          results.push('0x' + dataHex);
        }
      } else if (type.endsWith('[]')) {
        // Dynamic array
        const elemType = baseType(type);
        const lenWord = hex.slice(hexOffset, hexOffset + wordLen);
        const count = Number(BigInt('0x' + lenWord));
        const arrayData = hex.slice(hexOffset + wordLen);
        const elems = decodeAbiTuple(Array(count).fill(elemType), arrayData);
        results.push(elems);
      } else {
        results.push('0x' + heads[i]);
      }
    } else {
      results.push(decodeSlot(type, heads[i]));
    }
  }

  return results;
}

// ─── Main entry point ────────────────────────────────────────────────────────

/**
 * Decode a raw event log against an ABI event definition.
 *
 * @param {Object} abiEvent  ABI event object:
 *   { name: string, inputs: [{ name, type, indexed }] }
 * @param {Object} rawLog    Raw log from eth_getLogs:
 *   { topics: string[], data: string }
 * @returns {Object}         Decoded params keyed by name + index
 */
function decodeEvent(abiEvent, rawLog) {
  const { inputs } = abiEvent;
  const { topics, data } = rawLog;

  const result = {
    event: abiEvent.name,
    signature: topics[0],
    params: {},
  };

  const indexed = inputs.filter(i => i.indexed);
  const nonIndexed = inputs.filter(i => !i.indexed);

  // Decode indexed params from topics[1..]
  indexed.forEach((param, i) => {
    const topic = topics[i + 1];
    if (!topic) {
      result.params[param.name] = null;
      return;
    }
    result.params[param.name] = decodeSlot(param.type, topic);
  });

  // Decode non-indexed params from data
  if (nonIndexed.length > 0) {
    const dataHex = (data || '').replace(/^0x/, '');
    const types = nonIndexed.map(p => p.type);
    const values = decodeAbiTuple(types, dataHex);
    nonIndexed.forEach((param, i) => {
      result.params[param.name] = values[i];
    });
  }

  return result;
}

/**
 * Convenience: decode a raw log given a full ABI array.
 * Matches event by topic0 signature (provided as first topic).
 * Falls back to trying all events if no match found.
 */
function decodeRawLog(abi, rawLog) {
  if (!Array.isArray(abi)) abi = [abi];
  const events = abi.filter(e => e.type === 'event' || e.inputs !== undefined);

  // Try to find a matching event by computing signature hashes
  // We can't do keccak256 without a dep, so match by indexed count + topic count
  const topicCount = rawLog.topics.length - 1; // excluding topic0

  for (const ev of events) {
    const indexedCount = (ev.inputs || []).filter(i => i.indexed).length;
    if (indexedCount === topicCount) {
      return decodeEvent(ev, rawLog);
    }
  }

  // Fallback: use first event
  if (events.length > 0) {
    return decodeEvent(events[0], rawLog);
  }

  throw new Error('No matching event found in ABI');
}

// ─── CLI entrypoint ─────────────────────────────────────────────────────────

if (require.main === module) {
  const [,, abiArg, topicsArg, dataArg] = process.argv;

  if (!abiArg || !topicsArg) {
    console.error(`Usage: node decode-event.js '<abiJson>' '<topicsJson>' '<dataHex>'

abiJson:   ABI event object or array
topicsJson: JSON array of topic hex strings
dataHex:   Hex data field (0x-prefixed or bare)

Example:
  node decode-event.js \\
    '{"name":"Transfer","inputs":[{"name":"from","type":"address","indexed":true},{"name":"to","type":"address","indexed":true},{"name":"value","type":"uint256","indexed":false}]}' \\
    '["0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef","0x000000000000000000000000abcdef1234567890abcdef1234567890abcdef12","0x000000000000000000000000fedcba9876543210fedcba9876543210fedcba98"]' \\
    '0x000000000000000000000000000000000000000000000006f05b59d3b2000000'
`);
    process.exit(1);
  }

  try {
    const abiEvent = JSON.parse(abiArg);
    const topics = JSON.parse(topicsArg);
    const data = dataArg || '0x';

    const decoded = decodeEvent(
      Array.isArray(abiEvent) ? abiEvent.find(e => e.type === 'event') : abiEvent,
      { topics, data }
    );

    // Pretty-print with BigInt serialization
    console.log(JSON.stringify(decoded, (_, v) =>
      typeof v === 'bigint' ? v.toString() : v, 2));
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

module.exports = { decodeEvent, decodeRawLog, decodeSlot, decodeAbiTuple };
