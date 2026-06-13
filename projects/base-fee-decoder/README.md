# base-fee-decoder

Break down any Base transaction's gas cost into L1 data fee vs L2 execution fee.

Base transactions pay two fees: L2 execution gas (like any EVM chain) and an L1 data fee for posting calldata to Ethereum. This tool shows exactly how much each component costs.

## Usage

```bash
# Decode a specific transaction
node decode.mjs 0x<tx-hash>

# Estimate costs for common operations (swap, transfer, deploy, etc.)
node decode.mjs --estimate

# Show current Base fee parameters (L1 base fee, blob fee, scalars)
node decode.mjs --current
```

## What it shows

**Transaction decode:**
- L2 execution fee (gas used x gas price)
- L1 data fee (calldata size x L1 base fee x scalar)
- Total fee with L1/L2 percentage split
- USD equivalent (via CoinGecko)

**Estimate mode:**
- Fee breakdown for 10 common operations (ETH transfer, ERC-20 transfer, Uniswap swap, NFT mint, contract deploy, etc.)

## How Base fees work

After the Ecotone/Fjord upgrades, Base L1 data fees use:
- **baseFeeScalar** x L1 base fee for calldata compression costs
- **blobBaseFeeScalar** x blob base fee for EIP-4844 blob data costs

The L1 data fee is usually a small fraction of the total on Base, but can spike when L1 is congested.

## Zero dependencies

Uses `fetch()` against Base public RPC (`mainnet.base.org`). Node.js 18+.
