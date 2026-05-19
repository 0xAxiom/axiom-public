# tx-simulator

Pre-flight EVM transaction simulation. Test a transaction before sending it — get gas estimates, decode revert reasons, and verify balance sufficiency. Zero dependencies, works on any EVM chain.

## The Problem

Sending a transaction that will revert wastes gas and time. By the time you see the error, the gas is gone and you're left debugging hex. Custom errors are even harder — just a 4-byte selector with no context.

## The Solution

`tx-simulator` runs `eth_call` against your transaction before broadcasting. If it reverts, it decodes why — including `Error(string)`, `Panic(uint256)`, and custom errors via 4byte.directory lookup. It also runs `eth_estimateGas` and checks whether the sender can afford it.

## Triggers

Use this skill when:
- An agent is about to send a transaction (especially on mainnet)
- You're getting unexplained reverts and need to decode the reason
- You want to pre-flight check a batch of transactions before executing
- Building a "simulate before send" gate in any EVM automation pipeline

## Install

```bash
cp -r agent-skills/skills/tx-simulator ~/.openclaw/skills/
```

## Commands

```bash
# Basic simulation (will the call succeed?)
node simulate.mjs --rpc https://mainnet.base.org --to 0xContract --data 0xABCD1234

# Full pre-flight: simulate + gas estimate + balance check
node simulate.mjs \
  --rpc https://mainnet.base.org \
  --from 0xSenderWallet \
  --to 0xContract \
  --data 0xCALLDATA \
  --value 1000000000000000

# JSON output for scripts
node simulate.mjs --rpc https://mainnet.base.org --to 0xContract --data 0x... --json
```

## Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Transaction would succeed |
| `1` | Transaction would revert (or simulation error) |

Use exit codes in bash pipelines:
```bash
node simulate.mjs --rpc $RPC --to $CONTRACT --data $CALLDATA && \
  cast send --rpc-url $RPC $CONTRACT $CALLDATA --private-key $PK
```

## Output

```
✅ Simulation: PASS
   Gas:    89,432
   Sender: 0.012400 ETH ✅
   Cost:   ~0.000067 ETH @ 0.75 gwei

❌ Simulation: REVERT
   Reason: [Error] ERC20: transfer amount exceeds balance
   Gas:    estimate unavailable
   Sender: 0.012400 ETH ✅
   Cost:   ~0.000000 ETH @ 0.75 gwei
```

## Revert Types Decoded

| Type | Example | How decoded |
|------|---------|-------------|
| `Error(string)` | `require(x, "message")` | ABI-decode selector `0x08c379a0` |
| `Panic(uint256)` | Integer overflow, assert fail | ABI-decode selector `0x4e487b71` |
| `CustomError` | `error InsufficientLiquidity()` | 4-byte selector + 4byte.directory lookup |
| Empty | Low-level revert | Reports "No revert reason provided" |

## Integration Pattern

```javascript
import { execSync } from 'node:child_process';

function simulate(rpc, from, to, data, value = '0') {
  try {
    execSync(
      `node ~/.openclaw/skills/tx-simulator/scripts/simulate.mjs` +
      ` --rpc ${rpc} --from ${from} --to ${to} --data ${data} --value ${value} --json`,
      { stdio: 'pipe' }
    );
    return { ok: true };
  } catch (err) {
    const result = JSON.parse(err.stdout?.toString() || '{}');
    return { ok: false, revert: result.simulation?.revert };
  }
}

// Gate every send behind simulation
const { ok, revert } = simulate(RPC, wallet, contract, calldata);
if (!ok) throw new Error(`Would revert: ${revert?.message}`);
await sendTransaction(...);
```

## Common Revert Messages

| Message | Likely cause |
|---------|-------------|
| `ERC20: transfer amount exceeds balance` | Insufficient token balance |
| `ERC20: insufficient allowance` | Need to approve first |
| `Ownable: caller is not the owner` | Wrong `from` address |
| `Panic(0x11)` | Math overflow — check your amounts |
| `Panic(0x01)` | assert() failed — invariant violated |
| Custom error `0x...` | Check contract source or 4byte.directory |

## Chain IDs

| Chain | ID | RPC |
|-------|----|-----|
| Base | 8453 | https://mainnet.base.org |
| Ethereum | 1 | https://eth.llamarpc.com |
| Arbitrum | 42161 | https://arb1.arbitrum.io/rpc |
| Optimism | 10 | https://mainnet.optimism.io |
| Polygon | 137 | https://polygon-rpc.com |

## Requirements

- Node.js 18+ (uses built-in `fetch`)
- Zero npm dependencies
- Any EVM-compatible RPC endpoint
