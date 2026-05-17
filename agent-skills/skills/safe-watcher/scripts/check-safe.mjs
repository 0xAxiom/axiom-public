#!/usr/bin/env node
// check-safe.mjs — one-shot Safe multisig proposal checker
// Usage: node check-safe.mjs <safe-address> [--chain mainnet|base|arbitrum|optimism|polygon] [--json]
// No dependencies. Uses public Safe Transaction Service API.

const SAFE_APIS = {
  mainnet: 'https://safe-transaction-mainnet.safe.global',
  base: 'https://safe-transaction-base.safe.global',
  arbitrum: 'https://safe-transaction-arbitrum.safe.global',
  optimism: 'https://safe-transaction-optimism.safe.global',
  polygon: 'https://safe-transaction-polygon.safe.global',
  sepolia: 'https://safe-transaction-sepolia.safe.global',
  'base-sepolia': 'https://safe-transaction-base-sepolia.safe.global',
};

const args = process.argv.slice(2);
const safeAddress = args.find(a => a.startsWith('0x'));
const chainIdx = args.indexOf('--chain');
const chain = chainIdx !== -1 ? args[chainIdx + 1] : 'mainnet';
const jsonOutput = args.includes('--json');

if (!safeAddress) {
  console.error('Usage: node check-safe.mjs <safe-address> [--chain mainnet|base|arbitrum|optimism|polygon] [--json]');
  console.error('Supported chains: ' + Object.keys(SAFE_APIS).join(', '));
  process.exit(1);
}

const BASE_URL = SAFE_APIS[chain];
if (!BASE_URL) {
  console.error(`Unknown chain: ${chain}. Supported: ${Object.keys(SAFE_APIS).join(', ')}`);
  process.exit(1);
}

async function fetchJSON(url) {
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  return res.json();
}

function shortAddr(addr) {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function formatValue(weiStr) {
  const n = BigInt(weiStr);
  if (n === 0n) return null;
  const eth = Number(n) / 1e18;
  return eth.toFixed(eth < 0.001 ? 6 : 4) + ' ETH';
}

async function main() {
  const [safeInfo, pending] = await Promise.all([
    fetchJSON(`${BASE_URL}/api/v1/safes/${safeAddress}/`),
    fetchJSON(`${BASE_URL}/api/v1/safes/${safeAddress}/multisig-transactions/?executed=false&limit=20`),
  ]);

  const { threshold, owners, nonce } = safeInfo;
  const txs = (pending.results || []).filter(tx => !tx.isExecuted);

  const enriched = txs.map(tx => {
    const sigs = tx.confirmations?.length ?? 0;
    const confirmedOwners = new Set((tx.confirmations || []).map(c => c.owner.toLowerCase()));
    const missing = owners.filter(o => !confirmedOwners.has(o.toLowerCase()));
    const ready = sigs >= threshold;
    const value = formatValue(tx.value || '0');

    let label = 'raw tx';
    if (tx.dataDecoded?.method) label = `${tx.dataDecoded.method}()`;
    else if (value) label = `send ${value}`;

    return {
      safeTxHash: tx.safeTxHash,
      nonce: tx.nonce,
      to: tx.to,
      value: tx.value,
      label,
      dataDecoded: tx.dataDecoded,
      sigs,
      threshold,
      ready,
      submittedAt: tx.submissionDate,
      confirmedBy: (tx.confirmations || []).map(c => c.owner),
      missing,
    };
  });

  if (jsonOutput) {
    console.log(JSON.stringify({ safeAddress, chain, threshold, owners, nonce, pending: enriched }, null, 2));
    return;
  }

  console.log(`\n Safe: ${safeAddress}`);
  console.log(` Chain: ${chain} | Threshold: ${threshold}/${owners.length} | Nonce: ${nonce}`);
  console.log(` Owners: ${owners.map(shortAddr).join(', ')}\n`);

  if (enriched.length === 0) {
    console.log('  No pending proposals.\n');
    return;
  }

  console.log(`  ${enriched.length} pending proposal(s):\n`);

  for (const tx of enriched) {
    const badge = tx.ready ? '[READY]' : `[${tx.sigs}/${tx.threshold} sigs]`;
    console.log(`  ${badge} nonce=${tx.nonce}  ${tx.label}`);
    console.log(`    to:   ${tx.to}`);
    console.log(`    hash: ${tx.safeTxHash.slice(0, 22)}...`);
    if (tx.missing.length > 0) {
      console.log(`    need: ${tx.missing.map(shortAddr).join(', ')}`);
    }
    console.log();
  }

  const ready = enriched.filter(t => t.ready);
  if (ready.length > 0) {
    console.log(`  ALERT: ${ready.length} proposal(s) ready to execute!\n`);
    process.exitCode = 2; // non-zero so cron wrappers can detect
  }
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
