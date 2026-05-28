#!/usr/bin/env node
// tool-registry-scanner — read ERC-8257 Agent Tool Registry on Base or Ethereum.
// Zero deps. Node 18+. Pure JSON-RPC.
//
// Usage:
//   node scan-registry.mjs                          # list all tools on Base
//   node scan-registry.mjs --id 9                   # inspect tool #9
//   node scan-registry.mjs --id 9 --check 0xADDR    # check if address has access
//   node scan-registry.mjs --rpc URL                 # custom RPC
//   node scan-registry.mjs --chain mainnet           # use Ethereum mainnet
//   node scan-registry.mjs --json                    # JSON output
//   node scan-registry.mjs --fetch-manifests         # also fetch manifest metadata

const REGISTRY = "0x265BB2DBFC0A8165C9A1941Eb1372F349baD2cf1";

const RPCS = {
  base: "https://mainnet.base.org",
  mainnet: "https://eth.llamarpc.com",
};

// Function selectors (keccak256 of signature, first 4 bytes)
const SEL = {
  name: "0x06fdde03",
  version: "0x54fd4d50",
  toolCount: "0xfaf23b23",
  getToolConfig: "0xa0178453",
  hasAccess: "0xa7e3775b",
  tryHasAccess: "0x2361abf3",
};

const ZERO_ADDR = "0x" + "0".repeat(40);

// --- ABI helpers (zero-dep) ---

function pad32(hex) {
  return hex.replace(/^0x/, "").padStart(64, "0");
}

function encodeUint256(n) {
  return pad32(BigInt(n).toString(16));
}

function encodeAddress(addr) {
  return pad32(addr.replace(/^0x/, ""));
}

function encodeBytes(hex) {
  const data = hex.replace(/^0x/, "");
  const len = data.length / 2;
  const padded = data.padEnd(Math.ceil(data.length / 64) * 64, "0");
  return encodeUint256(len) + padded;
}

function decodeUint256(hex, offset = 0) {
  return BigInt("0x" + hex.slice(offset, offset + 64));
}

function decodeAddress(hex, offset = 0) {
  return "0x" + hex.slice(offset + 24, offset + 64);
}

function decodeBytes32(hex, offset = 0) {
  return "0x" + hex.slice(offset, offset + 64);
}

function decodeString(hex, baseOffset, ptrOffset) {
  const ptr = Number(decodeUint256(hex, ptrOffset)) * 2;
  const absOffset = baseOffset + ptr;
  const len = Number(decodeUint256(hex, absOffset));
  const start = absOffset + 64;
  return Buffer.from(hex.slice(start, start + len * 2), "hex").toString("utf8");
}

// --- RPC ---

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function rpcCall(rpc, to, data, retries = 3) {
  const body = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "eth_call",
    params: [{ to, data }, "latest"],
  });
  for (let attempt = 0; attempt < retries; attempt++) {
    const res = await fetch(rpc, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    const json = await res.json();
    if (json.error?.message?.includes("rate limit") && attempt < retries - 1) {
      await sleep(1000 * (attempt + 1));
      continue;
    }
    if (json.error) throw new Error(`RPC error: ${json.error.message}`);
    return json.result;
  }
}

async function readString(rpc, sel) {
  const raw = await rpcCall(rpc, REGISTRY, sel);
  const hex = raw.slice(2);
  const len = Number(decodeUint256(hex, 64));
  return Buffer.from(hex.slice(128, 128 + len * 2), "hex").toString("utf8");
}

async function getToolCount(rpc) {
  const raw = await rpcCall(rpc, REGISTRY, SEL.toolCount);
  return Number(BigInt(raw));
}

async function getToolConfig(rpc, toolId) {
  const data = SEL.getToolConfig + encodeUint256(toolId);
  const raw = await rpcCall(rpc, REGISTRY, data);
  const hex = raw.slice(2);

  // Return type: tuple(address creator, string metadataURI, bytes32 manifestHash, address accessPredicate)
  // ABI-encoded as: offset-to-tuple(32) then tuple fields
  // Slot 0: pointer to tuple start (0x20 = 32)
  const tupleStart = Number(decodeUint256(hex, 0)) * 2; // in hex chars

  // Inside the tuple:
  // slot 0: creator (address, left-padded)
  // slot 1: offset to metadataURI (relative to tuple start)
  // slot 2: manifestHash (bytes32)
  // slot 3: accessPredicate (address, left-padded)
  const creator = decodeAddress(hex, tupleStart);
  const manifestHash = decodeBytes32(hex, tupleStart + 128);
  const accessPredicate = decodeAddress(hex, tupleStart + 192);

  // Decode the dynamic string (metadataURI)
  const metadataURI = decodeString(hex, tupleStart, tupleStart + 64);

  return { creator, metadataURI, manifestHash, accessPredicate };
}

async function checkAccess(rpc, toolId, account) {
  // tryHasAccess returns (bool supported, bool granted)
  const data =
    SEL.tryHasAccess +
    encodeUint256(toolId) +
    encodeAddress(account) +
    encodeUint256(3 * 32) + // offset to bytes
    encodeBytes("0x"); // empty bytes

  const raw = await rpcCall(rpc, REGISTRY, data);
  const hex = raw.slice(2);
  const supported = decodeUint256(hex, 0) !== 0n;
  const granted = decodeUint256(hex, 64) !== 0n;
  return { supported, granted };
}

async function fetchManifest(uri) {
  try {
    const res = await fetch(uri, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return { error: `HTTP ${res.status}` };
    const json = await res.json();
    return {
      name: json.name || json.tool?.name,
      description: json.description || json.tool?.description,
      endpoint: json.endpoint || json.tool?.endpoint || json.url,
      pricing: json.pricing || json.tool?.pricing,
    };
  } catch (e) {
    return { error: e.message };
  }
}

// --- CLI ---

function parseArgs(argv) {
  const out = {
    rpc: null,
    chain: "base",
    id: null,
    check: null,
    json: false,
    fetchManifests: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === "--rpc") out.rpc = next();
    else if (a === "--chain") out.chain = next();
    else if (a === "--id") out.id = parseInt(next(), 10);
    else if (a === "--check") out.check = next();
    else if (a === "--json") out.json = true;
    else if (a === "--fetch-manifests") out.fetchManifests = true;
    else if (a === "-h" || a === "--help") {
      console.log(`ERC-8257 Agent Tool Registry Scanner

Usage:
  node scan-registry.mjs                          List all tools on Base
  node scan-registry.mjs --id 9                   Inspect tool #9
  node scan-registry.mjs --id 9 --check 0xADDR    Check access for address
  node scan-registry.mjs --fetch-manifests         Fetch manifest metadata
  node scan-registry.mjs --chain mainnet           Use Ethereum mainnet
  node scan-registry.mjs --rpc URL                 Custom RPC endpoint
  node scan-registry.mjs --json                    JSON output

Registry: ${REGISTRY}
Chains: base (default), mainnet`);
      process.exit(0);
    }
  }
  if (!out.rpc) out.rpc = RPCS[out.chain] || RPCS.base;
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const rpc = args.rpc;

  // Single tool inspection
  if (args.id !== null) {
    try {
      const config = await getToolConfig(rpc, args.id);

      if (args.check) {
        const access = await checkAccess(rpc, args.id, args.check);
        if (args.json) {
          console.log(JSON.stringify({ toolId: args.id, ...config, access }, null, 2));
        } else {
          console.log(`Tool #${args.id}`);
          console.log(`  Creator:    ${config.creator}`);
          console.log(`  Metadata:   ${config.metadataURI}`);
          console.log(`  Hash:       ${config.manifestHash}`);
          console.log(`  Predicate:  ${config.accessPredicate}`);
          console.log(`  Access for ${args.check}:`);
          console.log(`    Predicate active: ${access.supported}`);
          console.log(`    Granted:          ${access.granted}`);
        }
        return;
      }

      let manifest = null;
      if (args.fetchManifests && config.metadataURI) {
        manifest = await fetchManifest(config.metadataURI);
      }

      if (args.json) {
        console.log(JSON.stringify({ toolId: args.id, ...config, manifest }, null, 2));
      } else {
        console.log(`Tool #${args.id}`);
        console.log(`  Creator:    ${config.creator}`);
        console.log(`  Metadata:   ${config.metadataURI}`);
        console.log(`  Hash:       ${config.manifestHash}`);
        console.log(`  Predicate:  ${config.accessPredicate === ZERO_ADDR ? "none (open)" : config.accessPredicate}`);
        if (manifest) {
          if (manifest.error) {
            console.log(`  Manifest:   [fetch error: ${manifest.error}]`);
          } else {
            if (manifest.name) console.log(`  Name:       ${manifest.name}`);
            if (manifest.description) console.log(`  Desc:       ${manifest.description}`);
            if (manifest.endpoint) console.log(`  Endpoint:   ${manifest.endpoint}`);
          }
        }
      }
      return;
    } catch (e) {
      if (e.message.includes("execution reverted")) {
        console.error(`Tool #${args.id} not found or deregistered.`);
        process.exit(1);
      }
      throw e;
    }
  }

  // List all tools
  const [registryName, registryVersion, count] = await Promise.all([
    readString(rpc, SEL.name),
    readString(rpc, SEL.version),
    getToolCount(rpc),
  ]);

  if (!args.json) {
    console.log(`${registryName} v${registryVersion} on ${args.chain}`);
    console.log(`${count} tools registered\n`);
  }

  const tools = [];
  const errors = [];

  // Fetch tool configs sequentially to avoid rate limits on public RPCs
  for (let batch = 1; batch <= count; batch += 2) {
    if (batch > 1) await sleep(250);
    const ids = [];
    for (let i = batch; i < batch + 2 && i <= count; i++) ids.push(i);

    const results = await Promise.allSettled(
      ids.map(async (id) => {
        const config = await getToolConfig(rpc, id);
        let manifest = null;
        if (args.fetchManifests && config.metadataURI) {
          manifest = await fetchManifest(config.metadataURI);
        }
        return { toolId: id, ...config, manifest };
      })
    );

    for (let idx = 0; idx < results.length; idx++) {
      const r = results[idx];
      if (r.status === "fulfilled") {
        tools.push(r.value);
      } else {
        const msg = r.reason?.message || "unknown error";
        const id = ids[idx];
        if (msg.includes("reverted")) {
          tools.push({ toolId: id, deregistered: true });
        } else {
          errors.push({ toolId: id, error: msg });
        }
      }
    }
  }

  if (args.json) {
    console.log(JSON.stringify({ registry: registryName, version: registryVersion, chain: args.chain, count, tools }, null, 2));
    return;
  }

  // Table output
  const active = tools.filter((t) => !t.deregistered);
  const deregistered = tools.filter((t) => t.deregistered);

  for (const t of active) {
    const predLabel =
      t.accessPredicate === ZERO_ADDR ? "open" : t.accessPredicate.slice(0, 10) + "...";
    let line = `#${String(t.toolId).padStart(2)}  creator=${t.creator.slice(0, 10)}...  predicate=${predLabel}`;
    if (t.manifest?.name) line += `  "${t.manifest.name}"`;
    if (t.metadataURI) line += `\n      ${t.metadataURI}`;
    console.log(line);
  }

  if (deregistered.length > 0) {
    console.log(`\n(${deregistered.length} tool(s) deregistered: ${deregistered.map((t) => "#" + t.toolId).join(", ")})`);
  }
  if (errors.length > 0) {
    console.log(`(${errors.length} tool(s) failed to fetch: ${errors.map((e) => "#" + e.toolId).join(", ")})`);
  }
}

main().catch((e) => {
  console.error("Error:", e.message);
  process.exit(1);
});
