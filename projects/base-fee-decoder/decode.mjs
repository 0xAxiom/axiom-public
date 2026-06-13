#!/usr/bin/env node
/**
 * base-fee-decoder — Break down any Base transaction's gas cost
 * into L1 data fee vs L2 execution fee.
 *
 * Usage:
 *   node decode.mjs <tx-hash>          — decode a specific transaction
 *   node decode.mjs --estimate         — estimate costs for common operations
 *   node decode.mjs --current          — show current Base fee parameters
 *
 * Zero dependencies. Uses Base public RPC directly.
 */

const BASE_RPC = "https://mainnet.base.org";
const L1_BLOCK_PRECOMPILE = "0x4200000000000000000000000000000000000015";
const GAS_PRICE_ORACLE = "0x420000000000000000000000000000000000000F";

// Common operation gas estimates (L2 execution gas)
const COMMON_OPS = {
  "ETH transfer":          { gas: 21000, calldataBytes: 0 },
  "ERC-20 transfer":       { gas: 65000, calldataBytes: 68 },
  "ERC-20 approve":        { gas: 46000, calldataBytes: 68 },
  "Uniswap V3 swap":       { gas: 185000, calldataBytes: 260 },
  "Uniswap V2 swap":       { gas: 150000, calldataBytes: 132 },
  "NFT mint (ERC-721)":    { gas: 95000, calldataBytes: 68 },
  "NFT transfer (ERC-721)":{ gas: 85000, calldataBytes: 100 },
  "Safe multisig exec":    { gas: 250000, calldataBytes: 420 },
  "Contract deploy (small)": { gas: 500000, calldataBytes: 2000 },
  "Contract deploy (large)": { gas: 3000000, calldataBytes: 12000 },
};

async function rpc(method, params = []) {
  const res = await fetch(BASE_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const json = await res.json();
  if (json.error) throw new Error(`RPC error: ${json.error.message}`);
  return json.result;
}

async function ethCall(to, data) {
  return rpc("eth_call", [{ to, data }, "latest"]);
}

function hex(n) {
  return "0x" + n.toString(16);
}

function formatGwei(wei) {
  return (Number(wei) / 1e9).toFixed(4);
}

function formatEth(wei) {
  return (Number(wei) / 1e18).toFixed(8);
}

function formatUsd(eth, ethPrice) {
  return (Number(eth) / 1e18 * ethPrice).toFixed(4);
}

// Read L1 fee parameters from GasPriceOracle (Ecotone/Fjord)
async function getL1FeeParams() {
  // l1BaseFee() — 0x519b4bd3
  const l1BaseFee = BigInt(await ethCall(GAS_PRICE_ORACLE, "0x519b4bd3"));

  // baseFeeScalar() — 0xc5985918
  let baseFeeScalar;
  try {
    baseFeeScalar = BigInt(await ethCall(GAS_PRICE_ORACLE, "0xc5985918"));
  } catch {
    baseFeeScalar = 0n;
  }

  // blobBaseFeeScalar() — 0x68d5dca6
  let blobBaseFeeScalar;
  try {
    blobBaseFeeScalar = BigInt(await ethCall(GAS_PRICE_ORACLE, "0x68d5dca6"));
  } catch {
    blobBaseFeeScalar = 0n;
  }

  // blobBaseFee() — 0xf8206140
  let blobBaseFee;
  try {
    blobBaseFee = BigInt(await ethCall(GAS_PRICE_ORACLE, "0xf8206140"));
  } catch {
    blobBaseFee = 0n;
  }

  return { l1BaseFee, baseFeeScalar, blobBaseFeeScalar, blobBaseFee };
}

// Get current L2 gas price
async function getL2GasPrice() {
  const price = await rpc("eth_gasPrice");
  return BigInt(price);
}

// Estimate L1 data fee for given calldata size (Fjord model)
// Fjord: l1Fee = baseFeeScalar * l1BaseFee * calldataGas / 1e6
//       + blobBaseFeeScalar * blobBaseFee * calldataGas / 1e6
function estimateL1DataFee(calldataBytes, l1Params) {
  const { l1BaseFee, baseFeeScalar, blobBaseFeeScalar, blobBaseFee } = l1Params;

  // Fjord uses compressed size estimate: max(100, intercept + fastlzCoeff * fastlzSize)
  // For estimation, we approximate: ~68% compression ratio for typical calldata
  const compressedSize = BigInt(Math.max(100, Math.ceil(calldataBytes * 0.68)));

  // calldataGas = compressedSize * 16 (each byte costs 16 gas in L1 terms)
  const calldataGas = compressedSize * 16n;

  const l1DataFee =
    (baseFeeScalar * l1BaseFee * calldataGas) / 1000000n +
    (blobBaseFeeScalar * blobBaseFee * calldataGas) / 1000000n;

  return l1DataFee;
}

// Fetch ETH price (simple, no API key)
async function getEthPrice() {
  try {
    // Use a free price feed
    const res = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd"
    );
    const json = await res.json();
    return json.ethereum?.usd || 0;
  } catch {
    return 0;
  }
}

async function decodeTx(txHash) {
  const [tx, receipt, l1Params, l2GasPrice, ethPrice] = await Promise.all([
    rpc("eth_getTransactionByHash", [txHash]),
    rpc("eth_getTransactionReceipt", [txHash]),
    getL1FeeParams(),
    getL2GasPrice(),
    getEthPrice(),
  ]);

  if (!tx || !receipt) {
    console.error(`Transaction ${txHash} not found on Base`);
    process.exit(1);
  }

  const gasUsed = BigInt(receipt.gasUsed);
  const effectiveGasPrice = BigInt(receipt.effectiveGasPrice);
  const l2ExecutionFee = gasUsed * effectiveGasPrice;

  // Get L1 fee from receipt (if available via oracle)
  let l1Fee;
  try {
    // getL1Fee(bytes) — 0x49948e0e + abi-encoded tx data
    const txData = tx.input || "0x";
    const dataLen = (txData.length - 2) / 2;
    l1Fee = estimateL1DataFee(dataLen, l1Params);
  } catch {
    l1Fee = 0n;
  }

  const totalFee = l2ExecutionFee + l1Fee;
  const calldataBytes = tx.input ? (tx.input.length - 2) / 2 : 0;

  console.log("\n=== Base Transaction Fee Breakdown ===\n");
  console.log(`  TX Hash:     ${txHash}`);
  console.log(`  From:        ${tx.from}`);
  console.log(`  To:          ${tx.to || "(contract creation)"}`);
  console.log(`  Block:       ${parseInt(receipt.blockNumber, 16)}`);
  console.log(`  Status:      ${receipt.status === "0x1" ? "Success" : "Reverted"}`);
  console.log(`  Calldata:    ${calldataBytes} bytes`);
  console.log();
  console.log("--- L2 Execution Fee ---");
  console.log(`  Gas Used:    ${gasUsed.toLocaleString()}`);
  console.log(`  Gas Price:   ${formatGwei(effectiveGasPrice)} gwei`);
  console.log(`  L2 Fee:      ${formatEth(l2ExecutionFee)} ETH`);
  if (ethPrice) console.log(`               $${formatUsd(l2ExecutionFee, ethPrice)}`);
  console.log();
  console.log("--- L1 Data Fee (estimated) ---");
  console.log(`  L1 Base Fee: ${formatGwei(l1Params.l1BaseFee)} gwei`);
  console.log(`  Blob Fee:    ${formatGwei(l1Params.blobBaseFee)} gwei`);
  console.log(`  L1 Fee:      ${formatEth(l1Fee)} ETH`);
  if (ethPrice) console.log(`               $${formatUsd(l1Fee, ethPrice)}`);
  console.log();
  console.log("--- Total ---");
  console.log(`  Total Fee:   ${formatEth(totalFee)} ETH`);
  if (ethPrice) console.log(`               $${formatUsd(totalFee, ethPrice)}`);
  const l1Pct = totalFee > 0n ? Number((l1Fee * 10000n) / totalFee) / 100 : 0;
  console.log(`  L1 share:    ${l1Pct.toFixed(1)}%`);
  console.log(`  L2 share:    ${(100 - l1Pct).toFixed(1)}%`);
  console.log();
}

async function showCurrent() {
  const [l1Params, l2GasPrice, ethPrice] = await Promise.all([
    getL1FeeParams(),
    getL2GasPrice(),
    getEthPrice(),
  ]);

  console.log("\n=== Current Base Fee Parameters ===\n");
  console.log(`  L2 Gas Price:       ${formatGwei(l2GasPrice)} gwei`);
  console.log(`  L1 Base Fee:        ${formatGwei(l1Params.l1BaseFee)} gwei`);
  console.log(`  Blob Base Fee:      ${formatGwei(l1Params.blobBaseFee)} gwei`);
  console.log(`  Base Fee Scalar:    ${l1Params.baseFeeScalar}`);
  console.log(`  Blob Fee Scalar:    ${l1Params.blobBaseFeeScalar}`);
  if (ethPrice) console.log(`  ETH Price:          $${ethPrice.toLocaleString()}`);
  console.log();
}

async function showEstimates() {
  const [l1Params, l2GasPrice, ethPrice] = await Promise.all([
    getL1FeeParams(),
    getL2GasPrice(),
    getEthPrice(),
  ]);

  console.log("\n=== Base Fee Estimates for Common Operations ===\n");

  if (ethPrice) console.log(`  ETH: $${ethPrice.toLocaleString()}  |  L2 gas: ${formatGwei(l2GasPrice)} gwei\n`);

  const header = "Operation".padEnd(28) +
    "L2 Fee".padStart(14) +
    "L1 Data".padStart(14) +
    "Total".padStart(14) +
    (ethPrice ? "USD".padStart(10) : "");
  console.log(`  ${header}`);
  console.log(`  ${"─".repeat(header.length)}`);

  for (const [name, { gas, calldataBytes }] of Object.entries(COMMON_OPS)) {
    const l2Fee = BigInt(gas) * l2GasPrice;
    const l1Fee = estimateL1DataFee(calldataBytes, l1Params);
    const total = l2Fee + l1Fee;

    const line =
      name.padEnd(28) +
      `${formatEth(l2Fee)}`.padStart(14) +
      `${formatEth(l1Fee)}`.padStart(14) +
      `${formatEth(total)}`.padStart(14) +
      (ethPrice ? `$${formatUsd(total, ethPrice)}`.padStart(10) : "");
    console.log(`  ${line}`);
  }
  console.log();
}

// Main
const arg = process.argv[2];
if (!arg) {
  console.log("Usage:");
  console.log("  node decode.mjs <tx-hash>    — decode a specific transaction");
  console.log("  node decode.mjs --estimate   — estimate costs for common operations");
  console.log("  node decode.mjs --current    — show current Base fee parameters");
  process.exit(0);
}

if (arg === "--estimate") {
  await showEstimates();
} else if (arg === "--current") {
  await showCurrent();
} else if (arg.startsWith("0x") && arg.length === 66) {
  await decodeTx(arg);
} else {
  console.error("Invalid argument. Provide a tx hash, --estimate, or --current");
  process.exit(1);
}
