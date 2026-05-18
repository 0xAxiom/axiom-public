# nonce-manager

Atomic nonce tracking for concurrent EVM agent operations. Zero deps, pure Node.js.

## The Problem

Every EVM transaction requires a sequential nonce. When multiple agent processes (or rapid cron bursts) call `eth_getTransactionCount` at the same time, they all read the same value — and only one transaction lands. The rest are silently dropped or stuck forever, requiring manual intervention.

## The Solution

`nonce-manager` maintains a per-wallet, per-chain nonce registry in `~/.nonce-manager/<chainId>/<wallet>.json`. Each `claim` reads on-chain state, prunes confirmed nonces, and assigns the next safe value atomically from disk.

## Triggers

Use this skill when:
- Multiple agent processes or cron jobs may send transactions for the same wallet
- You're seeing stuck/dropped transactions without error messages
- You need to coordinate nonces across scripts without a mempool library
- You want defensive nonce management before any EVM send

## Install

```bash
cp -r agent-skills/skills/nonce-manager ~/.openclaw/skills/
# or
cp scripts/nonce.mjs /usr/local/bin/nonce-manager && chmod +x /usr/local/bin/nonce-manager
```

## Commands

```bash
# Claim the next safe nonce before sending a transaction
node nonce.mjs claim 0xYourWallet --rpc https://mainnet.base.org --chain 8453
# → {"nonce":42,"pending":[42],"onchain":42}

# After tx confirms (or is dropped), release the nonce
node nonce.mjs confirm 0xYourWallet 42
node nonce.mjs release 0xYourWallet 42   # same — tx dropped

# Resync against on-chain state (prune confirmed nonces)
node nonce.mjs sync 0xYourWallet --rpc https://mainnet.base.org

# Inspect pending nonces and detect gaps (stuck txs)
node nonce.mjs status 0xYourWallet
# → {"pending":[42,44],"gaps":[{"after":42,"before":44}],...}

# Emergency reset (all pending lost — use when wallet is clean on-chain)
node nonce.mjs clear 0xYourWallet
```

## Integration Pattern

```javascript
import { execSync } from 'node:child_process';

const WALLET = '0xYourWallet';
const RPC    = 'https://mainnet.base.org';

function claimNonce() {
  const out = execSync(`node nonce.mjs claim ${WALLET} --rpc ${RPC} --chain 8453`);
  return JSON.parse(out).nonce;
}

function releaseNonce(n) {
  execSync(`node nonce.mjs release ${WALLET} ${n}`);
}

async function sendTransaction(tx) {
  const nonce = claimNonce();
  try {
    const hash = await wallet.sendTransaction({ ...tx, nonce });
    await provider.waitForTransaction(hash);
    releaseNonce(nonce);
    return hash;
  } catch (err) {
    releaseNonce(nonce);   // free the slot so next attempt can reuse
    throw err;
  }
}
```

## State File

```json
{
  "pending": [42, 44],
  "nextLocal": 45,
  "lastSync": "2026-05-18T19:30:00.000Z"
}
```

Stored at `~/.nonce-manager/<chainId>/<wallet>.json`. Safe to inspect and edit manually.

## Gap Detection

`status` reports gaps in pending nonces — e.g., pending `[42, 44]` with gap `{after:42,before:44}` means nonce 43 was claimed but never released. The stuck transaction may need gas bumping or explicit cancellation (send 0 ETH to yourself with nonce 43 and higher gas).

## Chain IDs

| Chain    | ID   |
|----------|------|
| Base     | 8453 |
| Ethereum | 1    |
| Arbitrum | 42161|
| Optimism | 10   |
| Polygon  | 137  |

## Requirements

- Node.js 18+
- Zero npm dependencies
