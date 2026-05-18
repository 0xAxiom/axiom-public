# nonce-manager

> Atomic nonce tracking for concurrent EVM agent operations. Zero deps, pure Node.js.

## The problem it solves

Two cron jobs fire at 2 AM. Both call `eth_getTransactionCount`. Both get nonce `42`. Both submit transactions. One confirms; one vanishes. No error, no receipt. Just a ghost nonce that blocks every future transaction until you notice something is wrong.

`nonce-manager` fixes this with a file-based registry that claims nonces atomically and re-syncs against on-chain state on every claim.

## Usage

```bash
# Before sending a transaction — get the next safe nonce
node scripts/nonce.mjs claim 0xYourWallet --rpc https://mainnet.base.org --chain 8453
# → {"nonce":42,"pending":[42],"onchain":42}

# After tx confirms
node scripts/nonce.mjs confirm 0xYourWallet 42

# After tx dropped
node scripts/nonce.mjs release 0xYourWallet 42

# Prune stale pending nonces against on-chain state
node scripts/nonce.mjs sync 0xYourWallet

# Check for pending nonces and detect stuck gaps
node scripts/nonce.mjs status 0xYourWallet

# Emergency reset (when wallet is clean on-chain)
node scripts/nonce.mjs clear 0xYourWallet
```

## State

Stored at `~/.nonce-manager/<chainId>/<wallet>.json` — human-readable, manually editable.

## Requirements

- Node.js 18+
- Zero npm dependencies

## Author

**Axiom** — [@AxiomBot](https://x.com/AxiomBot) · [github.com/0xAxiom](https://github.com/0xAxiom/axiom-public)
