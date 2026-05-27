# erc20-burn-stats — Count ERC-20 Burns to a Dead Address

**Trigger phrases:** "how much has been burned", "burn stats", "count burns", "burn dashboard", "tokens sent to dead address", "deflation rate", "supply burned"

**When to use:** Any time you need to quantify how much of an ERC-20 has been burned (sent to a dead address like `0x...dEaD` or `0x0`). Returns total burned, burn event count, first/last burn block + timestamp, and burned % of original supply. Pure JSON-RPC — works on any EVM chain, no API key required.

## Capabilities

- Counts every `Transfer(_, dead, amount)` event on a given ERC-20
- Auto-detects contract deployment block (binary search on `eth_getCode`) — no need to know it upfront
- Defaults to `0x...dEaD` but supports any dead-address convention (`--dead 0x0`, custom address, etc.)
- Adaptive chunking: halves stride on RPC pushback, exponential-backoff retry on `429`
- Fetches token metadata (name, symbol, decimals, current totalSupply) for human-readable output
- Outputs human-readable table or JSON (`--json`)
- Zero deps. Node 18+. Works on any EVM chain (Base, Mainnet, Optimism, Arbitrum, BNB, Polygon, etc.)

## Script

```
agent-skills/skills/erc20-burn-stats/scripts/burn-stats.mjs
```

## Usage

### Default (Base, dead = 0x...dEaD, auto-deploy-block)

```bash
node burn-stats.mjs --token 0xf3Ce5dDAAb6C133F9875a4a46C55cf0b58111B07
```

### Custom RPC + custom dead address

```bash
node burn-stats.mjs \
  --token 0xTOKEN \
  --rpc https://base-mainnet.g.alchemy.com/v2/KEY \
  --dead 0x0000000000000000000000000000000000000000
```

### JSON output (for piping into dashboards/agents)

```bash
node burn-stats.mjs --token 0xTOKEN --json | jq .burned
```

### Limit scan range (faster when you only care about a window)

```bash
node burn-stats.mjs --token 0xTOKEN --from 18000000 --to 18500000
```

## Output (text mode)

```
token: 0xf3Ce5dDAAb6C133F9875a4a46C55cf0b58111B07
rpc:   https://mainnet.base.org
dead:  0x000000000000000000000000000000000000dEaD
meta:  Axiom (AXIOM) decimals=18
from:  29812345 (token deployed here)
scan:  blocks 29812345 → 46557887 (chunk=10000)

burn events:     62
total burned:    3270412345.123456 AXIOM
current supply:  96729587654.876544 AXIOM
% of original:   3.2704%
first burn:      block 29845123  (2026-02-14T18:23:00.000Z)
last burn:       block 46512311  (2026-05-26T22:17:01.000Z)
```

## Output (`--json` mode)

```json
{
  "token": "0xf3Ce5dDAAb6C133F9875a4a46C55cf0b58111B07",
  "symbol": "AXIOM",
  "name": "Axiom",
  "decimals": 18,
  "dead": "0x000000000000000000000000000000000000dEaD",
  "rpc": "https://mainnet.base.org",
  "scanned": { "from": 29812345, "to": 46557887 },
  "burn_event_count": 62,
  "burned_raw": "3270412345123456000000000000",
  "burned": "3270412345.123456",
  "current_total_supply_raw": "96729587654876544000000000000",
  "current_total_supply": "96729587654.876544",
  "burned_pct_of_original_supply": 3.2704,
  "first_burn": { "block": 29845123, "tx": "0x...", "timestamp": 1707937380, "iso": "2026-02-14T18:23:00.000Z" },
  "last_burn":  { "block": 46512311, "tx": "0x...", "timestamp": 1716762421, "iso": "2026-05-26T22:17:01.000Z" }
}
```

## How it works

1. Reads token metadata via `eth_call` (name / symbol / decimals / totalSupply).
2. If `--from auto`, binary-searches `eth_getCode(token, block)` to find the deployment block. Saves you from scanning millions of empty blocks.
3. Walks `[from, to]` in `--chunk`-sized windows, calling `eth_getLogs` with `topics=[Transfer, *, dead_padded_to_32]`.
4. On RPC pushback (range-too-large, too-many-results), halves stride and retries that window. On HTTP 429 or rate-limit JSON errors, sleeps with exponential backoff (500ms → 8s) up to 5 attempts.
5. Sums `data` (the amount) across all matched logs. Reports totals + first/last event timestamps via `eth_getBlockByNumber`.

## Why a dedicated tool

Etherscan/Basescan's "Holders" pages show the dead-address balance but not the full event history. Block explorer APIs work but are rate-limited and require keys. This script is pure RPC — drop it into any agent, point at any EVM chain, get a clean answer.

Pairs well with: [`onchain-event-watcher`](../onchain-event-watcher) (live alerts on new burns), [`multicall3`](../multicall3) (batch read across multiple tokens), [`erc20-snapshot`](../erc20-snapshot) (holder-side accounting).

## Caveats

- "Burn" is defined here as a `Transfer` to one specific dead address. If a token uses multiple sinks (e.g. `0x...dEaD` and `0x0` and a custom incinerator), run the script once per sink and sum.
- Some tokens implement `_burn` without emitting a `Transfer` event. This script will miss those. (Standard ERC-20 `_burn` emits `Transfer(from, 0x0, amount)`, which IS detectable with `--dead 0x0`.)
- Public RPCs (e.g. `mainnet.base.org`) rate-limit hard. For full-history scans on big tokens, use Alchemy/Infura/QuickNode.
- Total-supply-burned-% is computed as `burned / (current_supply + burned)` — i.e. % of *original* (pre-burn) supply. This is the correct denominator for "X% has been burned" claims.
