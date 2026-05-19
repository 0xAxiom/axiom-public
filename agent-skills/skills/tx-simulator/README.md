# tx-simulator

Pre-flight EVM transaction simulation. Decode revert reasons before you waste gas.

## What it does

Runs `eth_call` against your transaction before broadcasting. If it reverts, decodes exactly why — including `Error(string)`, `Panic(uint256)`, and custom errors via 4byte.directory lookup. Also checks gas estimates and sender balance.

## Usage

```bash
node scripts/simulate.mjs \
  --rpc https://mainnet.base.org \
  --from 0xYourWallet \
  --to 0xContract \
  --data 0xCALLDATA \
  [--value <wei>] \
  [--json]
```

## Output

```
✅ Simulation: PASS
   Gas:    89,432
   Sender: 0.012400 ETH ✅
   Cost:   ~0.000067 ETH @ 0.75 gwei

❌ Simulation: REVERT
   Reason: [Error] ERC20: transfer amount exceeds balance
```

## Exit codes: `0` = pass, `1` = revert. Pipeable.

## Requirements

- Node.js 18+
- Zero npm dependencies

## Full docs

See [SKILL.md](./SKILL.md) for integration patterns, revert type reference, and chain IDs.
