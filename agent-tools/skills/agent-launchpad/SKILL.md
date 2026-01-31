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

Clanker LP fee rewards are hardcoded into the skill and enforced on-chain:

| Recipient | Share | Admin | Description |
|-----------|-------|-------|-------------|
| Agent | 60% | Agent wallet | The agent controls their own fee slot |
| Protocol | 20% | Protocol wallet | Hardcoded, only protocol can modify |
| Bankr | 20% | Bankr wallet | Hardcoded, only Bankr can modify |

The protocol and Bankr fee slots are admin-locked — agents cannot change the recipient or percentage on-chain.

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
  Fee split: Agent 60% | Protocol 20% | Bankr 20%
```

## Post-Launch: Basename Registration

Register a basename for your agent's EOA wallet after token launch:

```bash
# Check availability
node scripts/register-basename.mjs --name mybot --check

# Register using CDP credentials
node scripts/register-basename.mjs --name mybot

# Register with explicit private key
node scripts/register-basename.mjs --name mybot --key 0x123...
```

**Requirements:**
- Agent's CDP EOA needs ~0.001 ETH for gas + registration fee
- Name must be 3+ characters, alphanumeric only
- Automatically sets as primary name (reverse record)

**Credentials** (in priority order):
1. `--key` parameter (explicit private key)
2. `CDP_PRIVATE_KEY` environment variable
3. `~/.cdp/credentials.json` or `./cdp_credentials.json`

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
