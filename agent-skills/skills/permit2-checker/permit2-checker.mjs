#!/usr/bin/env node
// permit2-checker — inspect Uniswap Permit2 approvals for any wallet on Base/Ethereum.
// Zero deps. Uses eth_call against the canonical Permit2 contract.
//
// Usage:
//   node permit2-checker.mjs 0xYourWallet                     # check common tokens on Base
//   node permit2-checker.mjs 0xWallet --chain mainnet          # check on Ethereum mainnet
//   node permit2-checker.mjs 0xWallet --tokens 0xTok1,0xTok2  # check specific tokens
//   node permit2-checker.mjs 0xWallet --spender 0xRouter       # filter by spender
//   node permit2-checker.mjs 0xWallet --all                    # check all tokens (via Transfer events)

const PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3";

const CHAINS = {
  base: {
    rpc: "https://mainnet.base.org",
    name: "Base",
    explorer: "https://basescan.org",
    tokens: {
      "0x4200000000000000000000000000000000000006": { symbol: "WETH", decimals: 18 },
      "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913": { symbol: "USDC", decimals: 6 },
      "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb": { symbol: "DAI", decimals: 18 },
      "0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA": { symbol: "USDbC", decimals: 6 },
      "0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22": { symbol: "cbETH", decimals: 18 },
      "0xc1CBa3fCea344f92D9239c08C0568f6F2F0ee452": { symbol: "wstETH", decimals: 18 },
      "0x940181a94A35A4569E4529A3CDfB74e38FD98631": { symbol: "AERO", decimals: 18 },
      "0x0b3e328455c4059EEb9e3f84b5543F74E24e7E1b": { symbol: "cbBTC", decimals: 8 },
      "0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed": { symbol: "DEGEN", decimals: 18 },
      "0xf3Ce5d55c1602F3370A3E3C7a03431e40A311F48": { symbol: "AXIOM", decimals: 18 },
    },
  },
  mainnet: {
    rpc: "https://eth.llamarpc.com",
    name: "Ethereum",
    explorer: "https://etherscan.io",
    tokens: {
      "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2": { symbol: "WETH", decimals: 18 },
      "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48": { symbol: "USDC", decimals: 6 },
      "0xdAC17F958D2ee523a2206206994597C13D831ec7": { symbol: "USDT", decimals: 6 },
      "0x6B175474E89094C44Da98b954EedeAC495271d0F": { symbol: "DAI", decimals: 18 },
      "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599": { symbol: "WBTC", decimals: 8 },
      "0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0": { symbol: "wstETH", decimals: 18 },
      "0xBe9895146f7AF43049ca1c1AE358B0541Ea49704": { symbol: "cbETH", decimals: 18 },
      "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984": { symbol: "UNI", decimals: 18 },
    },
  },
};

const KNOWN_SPENDERS = {
  "0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD": "Uniswap Universal Router",
  "0xEf1c6E67703c7BD7107eed8303Fbe6EC2554BF6B": "Uniswap Universal Router (v1)",
  "0x2626664c2603336E57B271c5C0b26F421741e481": "Uniswap Universal Router (Base)",
  "0x198EF79F1F515F02dFE9e3115eD9fC07A3a63800": "Uniswap Universal Router (Base v2)",
  "0x6131B5fae19EA4f9D964eAc0408E4408b66337b5": "Kyberswap",
  "0xDEF171Fe48CF0115B1d80b88dc8eAB59176FEe57": "Paraswap",
  "0x1111111254EEB25477B68fb85Ed929f73A960582": "1inch v5",
  "0x111111125421cA6dc452d289314280a0f8842A65": "1inch v6",
};

// allowance(address,address,address) → (uint160 amount, uint48 expiration, uint48 nonce)
const ALLOWANCE_SEL = "0x927da105";

function pad32(hex) {
  return hex.replace(/^0x/, "").toLowerCase().padStart(64, "0");
}

function encodeAllowanceCall(owner, token, spender) {
  return ALLOWANCE_SEL + pad32(owner) + pad32(token) + pad32(spender);
}

async function rpcCall(rpc, method, params) {
  const res = await fetch(rpc, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const json = await res.json();
  if (json.error) throw new Error(`RPC error: ${json.error.message}`);
  return json.result;
}

function decodeAllowanceResult(hex) {
  if (!hex || hex === "0x" || hex.length < 130) return null;
  const clean = hex.replace(/^0x/, "");
  const amount = BigInt("0x" + clean.slice(0, 64));
  const expiration = BigInt("0x" + clean.slice(64, 128));
  const nonce = BigInt("0x" + clean.slice(128, 192));
  return { amount, expiration, nonce };
}

function formatAmount(amount, decimals) {
  if (amount === 0n) return "0";
  const MAX_UINT160 = (1n << 160n) - 1n;
  if (amount >= MAX_UINT160) return "unlimited";
  const whole = amount / 10n ** BigInt(decimals);
  const frac = amount % 10n ** BigInt(decimals);
  if (frac === 0n) return whole.toLocaleString();
  const fracStr = frac.toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${whole.toLocaleString()}.${fracStr}`;
}

function formatExpiry(exp) {
  if (exp === 0n) return "none";
  const MAX_UINT48 = (1n << 48n) - 1n;
  if (exp >= MAX_UINT48) return "never";
  const date = new Date(Number(exp) * 1000);
  const now = Date.now();
  if (Number(exp) * 1000 < now) return `expired ${date.toISOString().slice(0, 10)}`;
  return date.toISOString().slice(0, 10);
}

function labelSpender(addr) {
  const lower = addr.toLowerCase();
  for (const [k, v] of Object.entries(KNOWN_SPENDERS)) {
    if (k.toLowerCase() === lower) return v;
  }
  return null;
}

// Scan Approval events on Permit2 to find all spenders for a given owner+token
// Approval(address indexed owner, address indexed token, address indexed spender, uint160 amount, uint48 expiration)
const APPROVAL_TOPIC = "0x5e19ec74e08f23c0e04ecd9b01eb8a931afb4aab8387c4b2be62997b9ea3f980";

async function getBlockNumber(rpc) {
  const hex = await rpcCall(rpc, "eth_blockNumber", []);
  return parseInt(hex, 16);
}

async function findSpendersFromLogs(rpc, owner, token) {
  const latest = await getBlockNumber(rpc);
  const CHUNK = 9999;
  // Scan last ~6 months of blocks (~15M on Base at 2s blocks, ~1.3M on mainnet at 12s)
  const lookback = 500_000;
  const start = Math.max(0, latest - lookback);
  const spenders = new Set();

  for (let from = start; from <= latest; from += CHUNK + 1) {
    const to = Math.min(from + CHUNK, latest);
    try {
      const logs = await rpcCall(rpc, "eth_getLogs", [{
        address: PERMIT2,
        fromBlock: "0x" + from.toString(16),
        toBlock: "0x" + to.toString(16),
        topics: [APPROVAL_TOPIC, "0x" + pad32(owner), "0x" + pad32(token)],
      }]);
      if (logs) {
        for (const log of logs) {
          if (log.topics && log.topics[3]) {
            spenders.add("0x" + log.topics[3].slice(26));
          }
        }
      }
    } catch {
      // skip failed chunks
    }
  }
  return [...spenders];
}

// Find all tokens that have Permit2 Approval events for this owner
async function findTokensFromLogs(rpc, owner) {
  const latest = await getBlockNumber(rpc);
  const CHUNK = 9999;
  const lookback = 500_000;
  const start = Math.max(0, latest - lookback);
  const tokens = new Set();

  for (let from = start; from <= latest; from += CHUNK + 1) {
    const to = Math.min(from + CHUNK, latest);
    try {
      const logs = await rpcCall(rpc, "eth_getLogs", [{
        address: PERMIT2,
        fromBlock: "0x" + from.toString(16),
        toBlock: "0x" + to.toString(16),
        topics: [APPROVAL_TOPIC, "0x" + pad32(owner)],
      }]);
      if (logs) {
        for (const log of logs) {
          if (log.topics && log.topics[2]) {
            tokens.add("0x" + log.topics[2].slice(26));
          }
        }
      }
    } catch {
      // skip failed chunks
    }
  }
  return [...tokens];
}

async function getTokenInfo(rpc, token) {
  try {
    const [symHex, decHex] = await Promise.all([
      rpcCall(rpc, "eth_call", [{ to: token, data: "0x95d89b41" }, "latest"]),
      rpcCall(rpc, "eth_call", [{ to: token, data: "0x313ce567" }, "latest"]),
    ]);
    let symbol = "???";
    if (symHex && symHex.length > 66) {
      const len = parseInt(symHex.slice(66, 130), 16);
      const bytes = symHex.slice(130, 130 + len * 2);
      symbol = Buffer.from(bytes, "hex").toString("utf8").replace(/\0/g, "");
    }
    const decimals = decHex ? parseInt(decHex, 16) : 18;
    return { symbol, decimals };
  } catch {
    return { symbol: "???", decimals: 18 };
  }
}

async function checkAllowance(rpc, owner, token, spender) {
  const data = encodeAllowanceCall(owner, token, spender);
  const result = await rpcCall(rpc, "eth_call", [{ to: PERMIT2, data }, "latest"]);
  return decodeAllowanceResult(result);
}

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { chain: "base", tokens: [], spender: null, all: false, json: false };
  let wallet = null;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--chain" && args[i + 1]) { opts.chain = args[++i]; continue; }
    if (arg === "--tokens" && args[i + 1]) { opts.tokens = args[++i].split(","); continue; }
    if (arg === "--spender" && args[i + 1]) { opts.spender = args[++i]; continue; }
    if (arg === "--all") { opts.all = true; continue; }
    if (arg === "--json") { opts.json = true; continue; }
    if (arg === "--help" || arg === "-h") { usage(); process.exit(0); }
    if (arg.startsWith("0x") && arg.length === 42) { wallet = arg; continue; }
  }

  if (!wallet) { usage(); process.exit(1); }
  return { wallet, ...opts };
}

function usage() {
  console.log(`permit2-checker — inspect Uniswap Permit2 approvals

Usage:
  node permit2-checker.mjs <wallet>                      Check common tokens (Base)
  node permit2-checker.mjs <wallet> --chain mainnet      Check on Ethereum
  node permit2-checker.mjs <wallet> --tokens 0xA,0xB     Check specific tokens
  node permit2-checker.mjs <wallet> --spender 0xRouter   Filter by spender
  node permit2-checker.mjs <wallet> --all                Scan logs for all tokens
  node permit2-checker.mjs <wallet> --json               JSON output

Permit2 (${PERMIT2}) is Uniswap's canonical approval contract.
Instead of per-contract approve(), users grant Permit2 a single max-approval,
then Permit2 manages sub-approvals to individual spenders with expiry.

This tool reads those sub-approvals so you can audit what's active.`);
}

async function main() {
  const { wallet, chain, tokens: customTokens, spender, all, json } = parseArgs();
  const chainCfg = CHAINS[chain];
  if (!chainCfg) {
    console.error(`Unknown chain: ${chain}. Supported: ${Object.keys(CHAINS).join(", ")}`);
    process.exit(1);
  }

  if (!json) {
    console.log(`\nPermit2 Allowance Check — ${chainCfg.name}`);
    console.log(`Wallet:  ${wallet}`);
    console.log(`Permit2: ${PERMIT2}`);
    console.log("");
  }

  let tokenList;
  if (customTokens.length > 0) {
    tokenList = {};
    for (const t of customTokens) {
      const info = chainCfg.tokens[t] || await getTokenInfo(chainCfg.rpc, t);
      tokenList[t] = info;
    }
  } else if (all) {
    if (!json) console.log("Scanning logs for all Permit2 interactions...");
    const found = await findTokensFromLogs(chainCfg.rpc, wallet);
    if (!json) console.log(`Found ${found.length} token(s) with Permit2 history.\n`);
    tokenList = {};
    for (const t of found) {
      tokenList[t] = chainCfg.tokens[t] || await getTokenInfo(chainCfg.rpc, t);
    }
  } else {
    tokenList = chainCfg.tokens;
  }

  const results = [];
  const spenderList = spender ? [spender] : Object.keys(KNOWN_SPENDERS);

  if (!all && !spender && !json) {
    console.log(`Checking ${Object.keys(tokenList).length} tokens × ${spenderList.length} known spenders...`);
  }

  // For default/custom-token mode: check known spenders directly (fast, no log scanning)
  // For --all mode: use log scanning to find historical spenders
  const useLogScan = all && !spender;

  const checks = [];
  for (const [tokenAddr, tokenInfo] of Object.entries(tokenList)) {
    const spendersForToken = useLogScan
      ? await findSpendersFromLogs(chainCfg.rpc, wallet, tokenAddr)
      : spenderList;

    for (const sp of spendersForToken) {
      checks.push({ tokenAddr, tokenInfo, sp });
    }
  }

  // Batch eth_call requests in parallel (groups of 10)
  const BATCH = 10;
  for (let i = 0; i < checks.length; i += BATCH) {
    const batch = checks.slice(i, i + BATCH);
    const settled = await Promise.allSettled(
      batch.map(({ tokenAddr, sp }) => checkAllowance(chainCfg.rpc, wallet, tokenAddr, sp))
    );
    for (let j = 0; j < settled.length; j++) {
      if (settled[j].status !== "fulfilled") continue;
      const allowance = settled[j].value;
      if (!allowance || allowance.amount === 0n) continue;
      const { tokenAddr, tokenInfo, sp } = batch[j];
      results.push({
        token: tokenAddr,
        symbol: tokenInfo.symbol,
        decimals: tokenInfo.decimals,
        spender: sp,
        spenderLabel: labelSpender(sp),
        amount: allowance.amount,
        amountFormatted: formatAmount(allowance.amount, tokenInfo.decimals),
        expiration: allowance.expiration,
        expirationFormatted: formatExpiry(allowance.expiration),
        nonce: allowance.nonce,
      });
    }
  }

  if (json) {
    const out = results.map((r) => ({
      token: r.token,
      symbol: r.symbol,
      spender: r.spender,
      spenderLabel: r.spenderLabel,
      amount: r.amount.toString(),
      amountFormatted: r.amountFormatted,
      expiration: Number(r.expiration),
      expirationFormatted: r.expirationFormatted,
      nonce: Number(r.nonce),
    }));
    console.log(JSON.stringify(out, null, 2));
    return;
  }

  if (results.length === 0) {
    console.log("No active Permit2 approvals found.");
    return;
  }

  console.log(`Found ${results.length} active approval(s):\n`);
  console.log("─".repeat(90));

  for (const r of results) {
    const spLabel = r.spenderLabel ? ` (${r.spenderLabel})` : "";
    const expired = r.expirationFormatted.startsWith("expired");
    const status = expired ? " [EXPIRED]" : "";

    console.log(`  Token:    ${r.symbol} (${r.token})`);
    console.log(`  Spender:  ${r.spender}${spLabel}`);
    console.log(`  Amount:   ${r.amountFormatted}${status}`);
    console.log(`  Expires:  ${r.expirationFormatted}`);
    console.log(`  Nonce:    ${r.nonce.toString()}`);
    console.log("─".repeat(90));
  }

  const unlimited = results.filter((r) => r.amountFormatted === "unlimited");
  const notExpired = results.filter((r) => !r.expirationFormatted.startsWith("expired"));
  if (unlimited.length > 0) {
    console.log(`\n⚠  ${unlimited.length} unlimited approval(s) — consider reducing or revoking.`);
  }
  if (notExpired.length > 0) {
    console.log(`   ${notExpired.length} active (not expired) approval(s).`);
  }

  console.log(`\nRevoke via: Permit2.approve(token, spender, 0, 0)`);
  console.log(`Explorer:  ${chainCfg.explorer}/address/${PERMIT2}`);
}

main().catch((e) => {
  console.error("Error:", e.message);
  process.exit(1);
});
