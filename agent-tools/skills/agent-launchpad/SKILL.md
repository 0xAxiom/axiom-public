# Agent Launchpad

## Description

One-command tool to take any AI agent onchain. Creates a wallet, optionally registers a Basename, and launches a token via Clanker — all on Base.

**What it does:**
1. **Creates a Smart Wallet** — ERC-4337 smart account via Coinbase Developer Platform, with gasless transactions via paymaster
2. **Registers a Basename** (optional) — `<name>.base.eth` identity on Base
3. **Launches a Token** — Deploys via Clanker v4 with automatic LP and fee rewards

## Prerequisites

- **Node.js** ≥ 18
- **CDP API Key** — Get one at [portal.cdp.coinbase.com](https://portal.cdp.coinbase.com)
- **ETH on Base** — The EOA account needs ~0.01 ETH for Clanker deployment gas; Basename registration may need ~0.002 ETH

## Environment Variables

```bash
CDP_API_KEY_ID=organizations/.../apiKeys/...
CDP_API_KEY_SECRET="-----BEGIN EC PRIVATE KEY-----\n...\n-----END EC PRIVATE KEY-----"
CDP_WALLET_SECRET=your-wallet-encryption-secret
```

## Usage

```bash
# Test CDP connection first
node scripts/test-connection.mjs

# Full launch: wallet + token
node scripts/launch.mjs --name "MyAgent" --symbol "AGENT" --description "AI research agent"

# With basename registration
node scripts/launch.mjs --name "MyAgent" --symbol "AGENT" --description "AI agent" --basename

# With custom image
node scripts/launch.mjs --name "MyAgent" --symbol "AGENT" --image "https://example.com/logo.png"

# Claim accumulated fees (auto-claim for agents)
node scripts/claim-fees.mjs --token 0x... --wallet 0x...

# Check fees without claiming
node scripts/claim-fees.mjs --token 0x... --wallet 0x... --dry-run
```

## CLI Flags

| Flag | Short | Description |
|------|-------|-------------|
| `--name` | `-n` | Token name (required) |
| `--symbol` | `-s` | Token symbol (required) |
| `--description` | `-d` | Token description |
| `--image` | `-i` | Token image URL |
| `--basename` | `-b` | Register `<name>.base.eth` |
| `--market-cap` | `-m` | Initial market cap in ETH (default: 10) |
| `--help` | `-h` | Show help |

## Fee Structure

Clanker LP fee rewards are split between two recipients:

| Recipient | Share | Description |
|-----------|-------|-------------|
| Agent (smart account) | 60% | The agent's own wallet receives majority of fees |
| MeltedMindz | 40% | Interface/platform fee to `0x523Eff3dB03938eaa31a5a6FBd41E3B9d23edde5` |

Both parties can independently update their reward recipient address after deployment.

## Output

```
🤖 Agent Launchpad
═══════════════════

📦 Creating smart wallet...     ✅ 0xabc...1234
🏷️  Registering myagent.base.eth... ✅ (gas sponsored)
🚀 Launching $AGENT...          ✅ 0xdef...5678

── Summary ──
  EOA:       0x...
  Wallet:    0x...
  Name:      myagent.base.eth
  Token:     0x...
  Tx:        https://basescan.org/tx/0x...
  Trade:     https://www.clanker.world/clanker/0x...
  Fee split: Agent 60% | MeltedMindz 40%
```

## Fee Claiming

After launch, agents can auto-claim their accumulated LP fee rewards:

```bash
# Check + claim fees (gasless via CDP smart account)
node scripts/claim-fees.mjs --token <TOKEN_ADDRESS> --wallet <SMART_ACCOUNT_ADDRESS>
```

Fees accumulate in both WETH and the launched token. The claim script handles both. Agents can run this on a schedule (e.g., daily cron) to automatically collect revenue.

## Dependencies

- `@coinbase/cdp-sdk` — Wallet creation, smart accounts, gasless transactions
- `clanker-sdk` — Token deployment on Clanker v4
- `viem` — Ethereum interactions, encoding, wallet client
