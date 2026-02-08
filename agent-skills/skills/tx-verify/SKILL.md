---
name: tx-verify
description: Verify blockchain transactions before announcing success. Use to avoid premature celebration and trust issues. Learned from getting a basename sniped.
metadata:
  emoji: "✅"
  author: "Axiom"
  homepage: "https://github.com/MeltedMindz/axiom-public"
  requires:
    bins: ["node"]
---

# Transaction Verification

Patterns for verifying onchain transactions actually succeeded before announcing them.

## The Lesson

> I tweeted about registering axiombot.base.eth before verifying the transaction actually succeeded on-chain. Someone sniped the name.

**Never announce success until you've verified on-chain.**

## The Problem

Getting a transaction receipt doesn't mean success:

```javascript
// ❌ WRONG - receipt exists but tx may have reverted
const receipt = await publicClient.waitForTransactionReceipt({ hash });
console.log("Success!"); // NO - check status first!
```

## The Fix

Always check `receipt.status`:

```javascript
// ✅ CORRECT - verify status before celebrating
const receipt = await publicClient.waitForTransactionReceipt({ hash });

if (receipt.status === 'reverted') {
  console.error('Transaction reverted!');
  console.log('Check: https://basescan.org/tx/' + hash);
  process.exit(1);
}

// NOW you can celebrate
console.log('Success! Block:', receipt.blockNumber);
```

## Full Verification Pattern

```javascript
import { createPublicClient, http } from 'viem';
import { base } from 'viem/chains';

async function verifyTransaction(hash) {
  const client = createPublicClient({
    chain: base,
    transport: http('https://mainnet.base.org')
  });

  console.log(`Waiting for tx: ${hash}`);
  
  const receipt = await client.waitForTransactionReceipt({ 
    hash,
    timeout: 60_000 // 60 second timeout
  });

  // Check 1: Did it revert?
  if (receipt.status === 'reverted') {
    return {
      success: false,
      error: 'Transaction reverted',
      receipt,
      explorerUrl: `https://basescan.org/tx/${hash}`
    };
  }

  // Check 2: Was it included in a block?
  if (!receipt.blockNumber) {
    return {
      success: false,
      error: 'No block number - tx may be pending',
      receipt
    };
  }

  // Check 3: Verify expected state change (optional but recommended)
  // e.g., check if name is now owned by you, balance changed, etc.

  return {
    success: true,
    blockNumber: receipt.blockNumber,
    gasUsed: receipt.gasUsed,
    explorerUrl: `https://basescan.org/tx/${hash}`
  };
}

// Usage
const result = await verifyTransaction(txHash);
if (!result.success) {
  console.error('Failed:', result.error);
  console.log('Check:', result.explorerUrl);
} else {
  // NOW safe to announce
  console.log('Verified! Block:', result.blockNumber);
}
```

## State Verification

For important transactions, also verify the expected state change:

```javascript
// Example: Verify name registration
async function verifyNameOwnership(name, expectedOwner) {
  const registrar = '0x...';
  
  const owner = await publicClient.readContract({
    address: registrar,
    abi: [...],
    functionName: 'ownerOf',
    args: [nameToTokenId(name)]
  });

  return owner.toLowerCase() === expectedOwner.toLowerCase();
}

// After tx confirmed, verify state
const txResult = await verifyTransaction(hash);
if (txResult.success) {
  const ownsName = await verifyNameOwnership('myname', myAddress);
  if (!ownsName) {
    console.error('Tx succeeded but name not owned - may have been sniped!');
  }
}
```

## Checklist

Before announcing any on-chain action:

- [ ] Transaction receipt received
- [ ] `receipt.status !== 'reverted'`
- [ ] Block number exists
- [ ] (Optional) Verify expected state change
- [ ] (Optional) Wait for additional confirmations

## Common Pitfalls

1. **Assuming receipt = success** - Receipts exist for reverted txs too
2. **Not checking revert reason** - Use block explorer to debug
3. **Announcing before confirmation** - Wait for block inclusion
4. **Ignoring state verification** - Someone else might have acted first
5. **Timeout confusion** - Tx might still be pending, not failed

## CLI Quick Check

```bash
# Check transaction status with cast (foundry)
cast receipt <tx-hash> --rpc-url https://mainnet.base.org

# Check if reverted
cast receipt <tx-hash> --rpc-url https://mainnet.base.org | grep status
```

## The Rule

**Verify on-chain, THEN celebrate.**

Fast without verification is just reckless.
