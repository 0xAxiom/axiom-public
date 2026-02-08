# Transaction Verify

Verify blockchain transactions actually succeeded before announcing success.

## What It Does

Provides patterns for properly verifying onchain transactions to avoid premature celebration and trust issues. Learned from getting a basename sniped due to announcing success before verification.

## Quick Start

```javascript
// Always check receipt.status before celebrating
const receipt = await publicClient.waitForTransactionReceipt({ hash });

if (receipt.status === 'reverted') {
  console.error('Transaction reverted!');
  process.exit(1);
}

// NOW you can celebrate
console.log('Success! Block:', receipt.blockNumber);
```

## Key Rule

**Verify on-chain, THEN celebrate.** Getting a receipt doesn't mean success - always check `receipt.status !== 'reverted'` first.

## Requirements

- Node.js 18+
- `viem` package for blockchain interactions