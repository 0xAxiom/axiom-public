#!/usr/bin/env node

/**
 * contract-deployer — find who deployed any contract and when
 *
 * Binary-searches the blockchain to locate the exact block where a
 * contract was created, then pulls the deployer address, tx hash,
 * and timestamp. Zero dependencies — raw JSON-RPC only.
 *
 * Usage:
 *   node find-deployer.mjs <address> [--rpc <url>] [--json]
 *
 * Examples:
 *   node find-deployer.mjs 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48
 *   node find-deployer.mjs 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 --rpc https://mainnet.base.org
 */

const BASE_RPC = "https://mainnet.base.org";
const ETH_RPC = "https://eth.llamarpc.com";

// ── helpers ──

async function rpc(url, method, params = []) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const json = await res.json();
  if (json.error) throw new Error(`RPC error: ${json.error.message}`);
  return json.result;
}

async function getCode(url, addr, block) {
  const tag = block === "latest" ? "latest" : "0x" + block.toString(16);
  return rpc(url, "eth_getCode", [addr, tag]);
}

async function getBlockNumber(url) {
  const hex = await rpc(url, "eth_blockNumber");
  return parseInt(hex, 16);
}

async function getBlock(url, blockNum) {
  const tag = "0x" + blockNum.toString(16);
  return rpc(url, "eth_getBlockByNumber", [tag, true]);
}

// ── binary search for deploy block ──

async function findDeployBlock(url, addr) {
  // first verify the contract exists now
  const currentCode = await getCode(url, addr, "latest");
  if (!currentCode || currentCode === "0x") {
    throw new Error(`No contract at ${addr} (or it self-destructed)`);
  }

  const latest = await getBlockNumber(url);
  let lo = 0;
  let hi = latest;

  // check if contract existed at block 0 (genesis deploy)
  const genesisCode = await getCode(url, addr, 0);
  if (genesisCode && genesisCode !== "0x") {
    return 0; // genesis contract
  }

  // binary search: find the smallest block where code exists
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    const code = await getCode(url, addr, mid);
    if (code && code !== "0x") {
      hi = mid;
    } else {
      lo = mid + 1;
    }
  }

  return lo;
}

// ── find the creation tx in a block ──

function findCreationTx(block, addr) {
  const target = addr.toLowerCase();

  // check regular transactions — contract creations have to=null
  for (const tx of block.transactions || []) {
    // direct CREATE: to is null, receipt contractAddress matches
    if (tx.to === null) {
      // we can't check receipt in the block data, but we can note it
      // for CREATE2 or factory deploys, to won't be null
    }
  }

  // return all candidate txs (to=null for CREATE, or any tx that could be CREATE2)
  const candidates = (block.transactions || []).filter(
    (tx) => tx.to === null || tx.to !== null
  );
  return candidates;
}

// ── main ──

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    console.log(`Usage: node find-deployer.mjs <address> [--rpc <url>] [--json]`);
    console.log(`\nFinds who deployed a contract and when, via binary search.`);
    console.log(`\nDefaults to Base mainnet. Use --rpc for other chains.`);
    process.exit(0);
  }

  const address = args[0];
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
    console.error("Invalid address:", address);
    process.exit(1);
  }

  const rpcIdx = args.indexOf("--rpc");
  const rpcUrl = rpcIdx !== -1 ? args[rpcIdx + 1] : BASE_RPC;
  const jsonOutput = args.includes("--json");

  if (!jsonOutput) {
    console.log(`Searching for deploy block of ${address}...`);
    console.log(`RPC: ${rpcUrl}`);
  }

  const deployBlock = await findDeployBlock(rpcUrl, address);
  const block = await getBlock(rpcUrl, deployBlock);
  const timestamp = parseInt(block.timestamp, 16);
  const date = new Date(timestamp * 1000);

  // find the creation tx — look for to=null (CREATE) first
  let deployTx = null;
  let deployer = null;

  // first pass: direct CREATE (to=null)
  for (const tx of block.transactions || []) {
    if (tx.to === null) {
      // verify by checking receipt
      const receipt = await rpc(rpcUrl, "eth_getTransactionReceipt", [tx.hash]);
      if (receipt && receipt.contractAddress &&
          receipt.contractAddress.toLowerCase() === address.toLowerCase()) {
        deployTx = tx.hash;
        deployer = tx.from;
        break;
      }
    }
  }

  // second pass: factory deploy (CREATE2 / internal tx)
  // check all tx receipts for contract creation logs
  if (!deployTx) {
    for (const tx of block.transactions || []) {
      const receipt = await rpc(rpcUrl, "eth_getTransactionReceipt", [tx.hash]);
      if (receipt && receipt.contractAddress &&
          receipt.contractAddress.toLowerCase() === address.toLowerCase()) {
        deployTx = tx.hash;
        deployer = tx.from;
        break;
      }
    }
  }

  // if still not found, it's likely an internal CREATE2 — we know the block at least
  if (!deployTx) {
    // use debug_traceBlock or just report the block
    // for now, report what we know
  }

  const result = {
    address,
    deployBlock,
    timestamp,
    date: date.toISOString(),
    deployer: deployer || "unknown (internal CREATE2 — use trace API to resolve)",
    deployTx: deployTx || "unknown (internal CREATE2)",
    bytecodeSize: null,
  };

  // get bytecode size
  const code = await getCode(rpcUrl, address, "latest");
  if (code && code !== "0x") {
    result.bytecodeSize = Math.floor((code.length - 2) / 2); // hex chars to bytes
    result.bytecodeSizeKB = (result.bytecodeSize / 1024).toFixed(2);
    result.nearSizeLimit = result.bytecodeSize > 20000; // 24576 is the limit
  }

  if (jsonOutput) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`\n─── Contract Deploy Info ───`);
    console.log(`Address:      ${result.address}`);
    console.log(`Deploy Block: ${result.deployBlock}`);
    console.log(`Timestamp:    ${result.date}`);
    console.log(`Deployer:     ${result.deployer}`);
    console.log(`Deploy Tx:    ${result.deployTx}`);
    if (result.bytecodeSize) {
      console.log(`Bytecode:     ${result.bytecodeSize} bytes (${result.bytecodeSizeKB} KB)`);
      if (result.nearSizeLimit) {
        console.log(`  ⚠ Near the 24,576-byte contract size limit`);
      }
    }
  }
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
