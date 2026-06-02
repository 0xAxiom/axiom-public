#!/usr/bin/env node
// signature-lookup — resolve EVM function selectors and event topics to signatures.
// Zero deps. Uses openchain.xyz + 4byte.directory APIs with a built-in fallback DB.
//
// Usage:
//   node lookup.mjs 0xa9059cbb                          # function selector
//   node lookup.mjs 0xddf252ad...                        # event topic (32 bytes)
//   node lookup.mjs 0xa9059cbb 0x095ea7b3 0x23b872dd    # batch lookup
//   node lookup.mjs --scan 0x608060...                   # scan bytecode for selectors
//   echo 0xa9059cbb | node lookup.mjs                   # stdin

const OPENCHAIN = "https://api.openchain.xyz/signature-database/v1/lookup";
const FOURBYTE_FN = "https://www.4byte.directory/api/v1/signatures/?hex_signature=";
const FOURBYTE_EV = "https://www.4byte.directory/api/v1/event-signatures/?hex_signature=";

const COMMON_FUNCTIONS = {
  "0xa9059cbb": "transfer(address,uint256)",
  "0x095ea7b3": "approve(address,uint256)",
  "0x23b872dd": "transferFrom(address,address,uint256)",
  "0x70a08231": "balanceOf(address)",
  "0x18160ddd": "totalSupply()",
  "0x313ce567": "decimals()",
  "0x06fdde03": "name()",
  "0x95d89b41": "symbol()",
  "0xdd62ed3e": "allowance(address,address)",
  "0x40c10f19": "mint(address,uint256)",
  "0x42966c68": "burn(uint256)",
  "0x79cc6790": "burnFrom(address,uint256)",
  "0xa457c2d7": "decreaseAllowance(address,uint256)",
  "0x39509351": "increaseAllowance(address,uint256)",
  "0x8da5cb5b": "owner()",
  "0x715018a6": "renounceOwnership()",
  "0xf2fde38b": "transferOwnership(address)",
  "0x5c975abb": "paused()",
  "0x8456cb59": "pause()",
  "0x3f4ba83a": "unpause()",
  "0x01ffc9a7": "supportsInterface(bytes4)",
  "0x6352211e": "ownerOf(uint256)",
  "0xe985e9c5": "isApprovedForAll(address,address)",
  "0xa22cb465": "setApprovalForAll(address,bool)",
  "0xb88d4fde": "safeTransferFrom(address,address,uint256,bytes)",
  "0x42842e0e": "safeTransferFrom(address,address,uint256)",
  "0x081812fc": "getApproved(uint256)",
  "0xc87b56dd": "tokenURI(uint256)",
  "0x4f6ccce7": "tokenByIndex(uint256)",
  "0x2f745c59": "tokenOfOwnerByIndex(address,uint256)",
  "0x18cbafe5": "swapExactTokensForETH(uint256,uint256,address[],address,uint256)",
  "0x7ff36ab5": "swapExactETHForTokens(uint256,address[],address,uint256)",
  "0x38ed1739": "swapExactTokensForTokens(uint256,uint256,address[],address,uint256)",
  "0x3593564c": "execute(bytes,bytes[],uint256)",
  "0x5ae401dc": "multicall(uint256,bytes[])",
  "0xac9650d8": "multicall(bytes[])",
  "0x1249c58b": "mint()",
  "0x2e1a7d4d": "withdraw(uint256)",
  "0xd0e30db0": "deposit()",
  "0x3ccfd60b": "withdraw()",
  "0xfb3bdb41": "swapETHForExactTokens(uint256,address[],address,uint256)",
  "0x5c11d795": "swapExactTokensForTokensSupportingFeeOnTransferTokens(uint256,uint256,address[],address,uint256)",
  "0x791ac947": "swapExactTokensForETHSupportingFeeOnTransferTokens(uint256,uint256,address[],address,uint256)",
  "0xd505accf": "permit(address,address,uint256,uint256,uint8,bytes32,bytes32)",
  "0x36568abe": "renounceRole(bytes32,address)",
  "0x2f2ff15d": "grantRole(bytes32,address)",
  "0xd547741f": "revokeRole(bytes32,address)",
  "0x91d14854": "hasRole(bytes32,address)",
  "0x248a9ca3": "getRoleAdmin(bytes32)",
  "0xa217fddf": "DEFAULT_ADMIN_ROLE()",
};

const COMMON_EVENTS = {
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef": "Transfer(address,address,uint256)",
  "0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925": "Approval(address,address,uint256)",
  "0x17307eab39ab6107e8899845ad3d59bd9653f200f220920489ca2b5937696c31": "ApprovalForAll(address,address,bool)",
  "0xe1fffcc4923d04b559f4d29a8bfc6cda04eb5b0d3c460751c2402c5c5cc9109c": "Deposit(address,uint256)",
  "0x7fcf532c15f0a6db0bd6d0e038bea71d30d808c7d98cb3bf7268a95bf5081b65": "Withdrawal(address,uint256)",
  "0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822": "Swap(address,uint256,uint256,uint256,uint256,address)",
  "0x1c411e9a96e071241c2f21f7726b17ae89e3cab4c78be50e062b03a9fffbbad1": "Sync(uint112,uint112)",
  "0x4c209b5fc8ad50758f13e2e1088ba56a560dff690a1c6fef26394f4c03821c4f": "Mint(address,uint256,uint256)",
  "0xdccd412f0b1252819cb1fd330b93224ca42612892bb3f4f789976e6d81936496": "Burn(address,uint256,uint256,address)",
  "0x8be0079c531659141344cd1fd0a4f28419497f9722a3daafe3b4186f6b6457e0": "OwnershipTransferred(address,address)",
  "0x2f8788117e7eff1d82e926ec794901d17c78024a50270940304540a733656f0d": "RoleGranted(bytes32,address,address)",
  "0xf6391f5c32d9c69d2a47ea670b442974b53935d1edc7fd64eb21e047a839171b": "RoleRevoked(bytes32,address,address)",
  "0x62e78cea01bee320cd4e420270b5ea74000d11b0c9f74754ebdbfc544b05a258": "Paused(address)",
  "0x5db9ee0a495bf2e6ff9c91a7834c1ba4fdd244a5e8aa4e537bd38aeae4b073aa": "Unpaused(address)",
};

function isEventTopic(hex) {
  return hex.length === 66; // 0x + 64 chars = 32 bytes
}

function isFunctionSelector(hex) {
  return hex.length === 10; // 0x + 8 chars = 4 bytes
}

async function fetchWithTimeout(url, ms = 4000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { "user-agent": "signature-lookup/1.0" },
    });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

async function lookupOpenchain(hex, type) {
  const param = type === "event" ? `event=${hex}` : `function=${hex}`;
  const url = `${OPENCHAIN}?${param}&filter=true`;
  try {
    const res = await fetchWithTimeout(url);
    if (!res.ok) return [];
    const j = await res.json();
    const key = type === "event" ? "event" : "function";
    return j?.result?.[key]?.[hex]?.map(x => x.name) ?? [];
  } catch { return []; }
}

async function lookup4byte(hex, type) {
  const base = type === "event" ? FOURBYTE_EV : FOURBYTE_FN;
  try {
    const res = await fetchWithTimeout(`${base}${hex}`);
    if (!res.ok) return [];
    const j = await res.json();
    return j?.results?.map(x => x.text_signature) ?? [];
  } catch { return []; }
}

async function resolve(hex) {
  hex = hex.toLowerCase().trim();
  if (!hex.startsWith("0x")) hex = "0x" + hex;

  const type = isEventTopic(hex) ? "event" : isFunctionSelector(hex) ? "function" : null;
  if (!type) return { hex, type: "unknown", signatures: [], source: "none" };

  const local = type === "event" ? COMMON_EVENTS[hex] : COMMON_FUNCTIONS[hex];
  if (local) return { hex, type, signatures: [local], source: "builtin" };

  const [oc, fb] = await Promise.all([
    lookupOpenchain(hex, type),
    lookup4byte(hex, type),
  ]);

  const merged = [...new Set([...oc, ...fb])];
  const source = oc.length && fb.length ? "openchain+4byte" : oc.length ? "openchain" : fb.length ? "4byte" : "none";
  return { hex, type, signatures: merged, source };
}

function extractSelectors(bytecode) {
  const hex = bytecode.replace(/^0x/i, "").toLowerCase();
  const selectors = new Set();
  // PUSH4 opcode = 0x63, followed by 4 bytes
  for (let i = 0; i < hex.length - 10; i += 2) {
    if (hex.slice(i, i + 2) === "63") {
      const sel = "0x" + hex.slice(i + 2, i + 10);
      // Filter out obvious non-selectors (all zeros, all ff, etc.)
      if (sel !== "0x00000000" && sel !== "0xffffffff") {
        selectors.add(sel);
      }
    }
  }
  return [...selectors];
}

async function main() {
  const args = process.argv.slice(2);
  let inputs = [];
  let scanMode = false;

  if (args.includes("--scan")) {
    scanMode = true;
    const idx = args.indexOf("--scan");
    const bytecode = args[idx + 1];
    if (!bytecode) {
      console.error("Usage: node lookup.mjs --scan <bytecode>");
      process.exit(1);
    }
    inputs = extractSelectors(bytecode);
    if (!inputs.length) {
      console.log("No selectors found in bytecode.");
      process.exit(0);
    }
    console.log(`Found ${inputs.length} potential selectors in bytecode.\n`);
  } else if (args.length > 0) {
    inputs = args.filter(a => /^(0x)?[0-9a-fA-F]+$/.test(a));
  } else {
    const chunks = [];
    process.stdin.setEncoding("utf8");
    for await (const chunk of process.stdin) chunks.push(chunk);
    const raw = chunks.join("").trim();
    inputs = raw.split(/[\s,]+/).filter(a => /^(0x)?[0-9a-fA-F]+$/.test(a));
  }

  if (!inputs.length) {
    console.log(`signature-lookup — resolve EVM function selectors and event topic hashes

Usage:
  node lookup.mjs 0xa9059cbb                          # single selector
  node lookup.mjs 0xa9059cbb 0x095ea7b3               # batch
  node lookup.mjs 0xddf252ad...full-topic-hash        # event topic (32 bytes)
  node lookup.mjs --scan 0x608060...                   # extract selectors from bytecode
  echo "0xa9059cbb 0x095ea7b3" | node lookup.mjs      # stdin

Sources: openchain.xyz, 4byte.directory, built-in DB (${Object.keys(COMMON_FUNCTIONS).length} functions, ${Object.keys(COMMON_EVENTS).length} events)`);
    process.exit(0);
  }

  const results = await Promise.all(inputs.map(resolve));

  const pad = Math.max(...results.map(r => r.hex.length));
  for (const r of results) {
    const tag = r.type === "event" ? "[event]" : r.type === "function" ? "[fn]   " : "[?]    ";
    if (r.signatures.length === 0) {
      console.log(`${tag} ${r.hex.padEnd(pad)}  (not found)`);
    } else if (r.signatures.length === 1) {
      console.log(`${tag} ${r.hex.padEnd(pad)}  ${r.signatures[0]}  [${r.source}]`);
    } else {
      console.log(`${tag} ${r.hex.padEnd(pad)}  ${r.signatures[0]}  [${r.source}]`);
      for (const s of r.signatures.slice(1)) {
        console.log(`${" ".repeat(tag.length + 1)}${" ".repeat(pad)}  ${s}`);
      }
    }
  }

  if (results.length > 1) {
    const found = results.filter(r => r.signatures.length > 0).length;
    console.log(`\n${found}/${results.length} resolved.`);
  }
}

main().catch(e => { console.error(e.message); process.exit(1); });
