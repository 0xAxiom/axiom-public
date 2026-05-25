# multicall3 — Batch EVM Reads in One RPC Call

**Trigger phrases:** "check multiple balances", "batch RPC calls", "read multiple contracts", "multicall", "batch read", "aggregate calls", "check N token balances at once"

**When to use:** Any time you need to read more than one value from an EVM chain. Instead of one `eth_call` per value, batch everything into a single round-trip via Multicall3.

## Capabilities

- Batch any EVM view function calls (raw calldata or built-in shortcuts)
- Check ERC-20 balances for 50+ addresses simultaneously
- Fetch full token metadata (name/symbol/decimals/totalSupply) in one call
- Check ETH balances for multiple wallets at once
- `allowFailure: true` by default — one bad call won't break the batch
- Zero deps, pure Node.js 18+, works on 300+ EVM chains

## Script

```
agent-skills/skills/multicall3/scripts/multicall3.mjs
```

## Usage

### Raw calls (pipe JSON)

```bash
echo '[
  {"target":"0xTokenA","data":"0x18160ddd","decode":"uint256","label":"totalSupply"},
  {"target":"0xTokenB","fn":"symbol","decode":"string","label":"symbol"}
]' | node multicall3.mjs --rpc https://mainnet.base.org
```

### Check ERC-20 balances for multiple holders

```bash
node multicall3.mjs \
  --rpc https://mainnet.base.org \
  --balanceOf 0xTokenAddress \
  0xHolder1 0xHolder2 0xHolder3
```

### Get token metadata

```bash
node multicall3.mjs \
  --rpc https://mainnet.base.org \
  --tokenInfo 0xToken1 0xToken2
# Returns name, symbol, decimals, totalSupply for each token
```

### Check ETH balances

```bash
node multicall3.mjs \
  --rpc https://mainnet.base.org \
  --ethBalance 0xWallet1 0xWallet2 0xWallet3
```

### Custom call with built-in fn shorthand

```bash
node multicall3.mjs --rpc https://mainnet.base.org --calls '[
  {"target":"0xToken","fn":"balanceOf","args":["0xHolder"],"decode":"uint256","label":"myBal"},
  {"target":"0xToken","fn":"allowance","args":["0xOwner","0xSpender"],"decode":"uint256"}
]'
```

### Historical / pinned block

```bash
node multicall3.mjs --rpc https://mainnet.base.org --block 25000000 \
  --balanceOf 0xToken 0xHolder1
```

## Output Format

```json
[
  {
    "label": "balanceOf(0x1234...)",
    "target": "0xTokenAddress",
    "success": true,
    "raw": "0x000000000000000000000000000000000000000000000000016345785d8a0000",
    "decoded": "100000000000000000"
  }
]
```

- `success: false` means the call reverted (data unavailable) — rest of batch still returns
- `decoded: null` when `decode` not set or call failed
- Exit code 1 if any call failed

## Call Object Schema

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `target` | address | yes | Contract to call |
| `data` | hex | one of data/fn | Raw calldata |
| `fn` | string | one of data/fn | Built-in function name |
| `args` | array | with fn | Arguments for built-in |
| `decode` | string | no | Return type: uint256, address, bool, string, bytes, raw |
| `label` | string | no | Label in output |
| `allowFailure` | boolean | no | Default true |

## Built-in Functions

| fn | Returns | Args |
|----|---------|------|
| `balanceOf` | uint256 | address |
| `allowance` | uint256 | owner address, spender address |
| `totalSupply` | uint256 | none |
| `decimals` | uint256 | none |
| `symbol` | string | none |
| `name` | string | none |
| `getEthBalance` | uint256 | address (ETH balance of any wallet) |

## Environment

| Variable | Default | Description |
|----------|---------|-------------|
| `RPC_URL` | Base mainnet | Override with `--rpc` flag |

## Multicall3 Address

`0xcA11bde05977b3631167028862bE2a173976CA11`

Same address on every supported chain (Ethereum, Base, Arbitrum, Optimism, Polygon, zkSync, Scroll, etc.). Full list: https://www.multicall3.com/

## Why This Matters

100 `eth_call` requests = 100 round-trips, 100 rate-limit slots, ~seconds of latency.
1 `multicall3` request = 1 round-trip, 1 rate-limit slot, ~milliseconds.

Agents that read many on-chain values (portfolio snapshots, LP health, holder lists, airdrop snapshots) should always batch via Multicall3.
