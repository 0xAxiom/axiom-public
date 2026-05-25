# multicall3 🔢

**Batch any EVM read calls into a single JSON-RPC round-trip.**

Uses [Multicall3](https://www.multicall3.com/) — deployed at the same address on 300+ EVM chains. Zero dependencies. Pure Node.js 18+.

## Why

100 separate `eth_call` requests = 100 round-trips, 100 rate-limit slots.
1 multicall = 1 round-trip, 1 rate-limit slot, ~milliseconds.

Any agent doing portfolio snapshots, airdrop eligibility, LP health checks, or multi-wallet monitoring should batch via Multicall3.

## Install

```bash
cp -r agent-skills/skills/multicall3 ~/.openclaw/skills/
# or
cp -r agent-skills/skills/multicall3 ~/.clawdbot/skills/
```

No `npm install` needed.

## Usage

### ERC-20 balances for multiple holders

```bash
node scripts/multicall3.mjs \
  --rpc https://mainnet.base.org \
  --balanceOf 0xYourTokenAddress \
  0xHolder1 0xHolder2 0xHolder3 0xHolder4
```

### Token metadata (name, symbol, decimals, totalSupply)

```bash
node scripts/multicall3.mjs \
  --rpc https://mainnet.base.org \
  --tokenInfo 0xToken1 0xToken2 0xToken3
```

### ETH balances for multiple wallets

```bash
node scripts/multicall3.mjs \
  --rpc https://mainnet.base.org \
  --ethBalance 0xWallet1 0xWallet2 0xWallet3
```

### Pipe JSON call array

```bash
echo '[
  {"target":"0xToken","fn":"totalSupply","decode":"uint256","label":"supply"},
  {"target":"0xToken","fn":"symbol","decode":"string"},
  {"target":"0xToken","fn":"decimals","decode":"uint256"},
  {"target":"0xOtherContract","data":"0xaabbccdd","decode":"raw","label":"custom"}
]' | node scripts/multicall3.mjs --rpc https://mainnet.base.org
```

### With `--calls` flag and built-in allowance check

```bash
node scripts/multicall3.mjs \
  --rpc https://mainnet.base.org \
  --calls '[
    {"target":"0xUSDC","fn":"allowance","args":["0xOwner","0xRouter"],"decode":"uint256","label":"usdcAllowance"},
    {"target":"0xUSDC","fn":"balanceOf","args":["0xOwner"],"decode":"uint256","label":"usdcBalance"}
  ]'
```

### Historical snapshot (pinned block)

```bash
node scripts/multicall3.mjs \
  --rpc https://mainnet.base.org \
  --block 25000000 \
  --balanceOf 0xToken 0xHolder1 0xHolder2
```

## Output

```json
[
  {
    "label": "balanceOf(0x1234abcd...)",
    "target": "0xYourTokenAddress",
    "success": true,
    "raw": "0x0000000000000000000000000000000000000000000000000de0b6b3a7640000",
    "decoded": "1000000000000000000"
  },
  {
    "label": "balanceOf(0x5678ef01...)",
    "target": "0xYourTokenAddress",
    "success": true,
    "raw": "0x0000000000000000000000000000000000000000000000000000000000000000",
    "decoded": "0"
  }
]
```

- `decoded` is the human-readable value (string for symbol/name, decimal string for uint256)
- `success: false` means the call reverted; other calls in the batch still succeed
- Exit code 1 if any call in the batch failed

## Call Object Schema

| Field | Required | Description |
|-------|----------|-------------|
| `target` | yes | Contract address |
| `data` | one of | Raw hex calldata |
| `fn` | one of | Built-in function name |
| `args` | with fn | Arguments for the function |
| `decode` | no | Return type decoder |
| `label` | no | Label in output JSON |
| `allowFailure` | no | Default: true |

**`decode` options:** `uint256`, `int256`, `address`, `bool`, `string`, `bytes`, `raw`

**Built-in `fn` names:** `balanceOf`, `allowance`, `totalSupply`, `decimals`, `symbol`, `name`, `getEthBalance`

## Flags

| Flag | Description |
|------|-------------|
| `--rpc <url>` | RPC endpoint (or set `RPC_URL` env var) |
| `--calls <json>` | JSON array of call objects |
| `--balanceOf <token> <addr>...` | ERC-20 balance checks |
| `--allowance <token> <owner> <spender>` | ERC-20 allowance check |
| `--tokenInfo <token>...` | name + symbol + decimals + totalSupply |
| `--ethBalance <addr>...` | Native ETH balances |
| `--block <tag>` | Block tag (default: `latest`) |
| `--silent` | Suppress stderr progress output |

## Multicall3 Address

`0xcA11bde05977b3631167028862bE2a173976CA11`

Same address on: Ethereum, Base, Arbitrum, Optimism, Polygon, zkSync Era, Scroll, Linea, Avalanche, BNB Chain, Fantom, Gnosis Chain, Celo, Moonbeam, and [300+ more](https://www.multicall3.com/).

## Common Chains

| Chain | RPC |
|-------|-----|
| Base | `https://mainnet.base.org` |
| Ethereum | `https://eth.llamarpc.com` |
| Arbitrum | `https://arb1.arbitrum.io/rpc` |
| Optimism | `https://mainnet.optimism.io` |
| Polygon | `https://polygon-rpc.com` |

## Script in Your Agent

```javascript
import { execSync } from 'child_process';

const results = JSON.parse(
  execSync(
    `node ~/.openclaw/skills/multicall3/scripts/multicall3.mjs ` +
    `--rpc https://mainnet.base.org --silent ` +
    `--balanceOf ${TOKEN_ADDR} ${holders.join(' ')}`
  ).toString()
);

for (const r of results) {
  if (r.success) console.log(r.label, r.decoded);
}
```

---

Built by [@AxiomBot](https://x.com/AxiomBot) · [github.com/0xAxiom](https://github.com/0xAxiom/axiom-public)
