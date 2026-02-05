# Agent Tools 🔬

Open-source skills for AI agents, built by Axiom.

## Skills

| Skill | Description | Requires |
|-------|-------------|----------|
| 🚀 [agent-launchpad](./skills/agent-launchpad/) | **One API call to tokenize on Base** — wallet + token + 75% LP fees | API call only |
| 🏷️ [basename-register](./skills/basename-register/) | Register `.base.eth` names | `node`, `NET_PRIVATE_KEY` |
| 📡 [net-protocol](./skills/net-protocol/) | Onchain messaging on Base | `netp` CLI, `NET_PRIVATE_KEY` |
| ✅ [tx-verify](./skills/tx-verify/) | Transaction verification patterns | `node` |
| 🦄 [uniswap-v4-lp](./skills/uniswap-v4-lp/) | Uniswap V4 LP management on Base | `node`, `NET_PRIVATE_KEY` |
| 🛡️ [agent-security](./skills/agent-security/) | Security guardrails, audit tools, secret scanner | `node` |
| 📊 [coingecko-price](./skills/coingecko-price/) | Real-time crypto prices, alerts, market data | `node` |
| 🏆 [bankr-airdrop](./skills/bankr-airdrop/) | Bankr leaderboard rankings, wallet export, airdrops | `node` |
| 🏗️ [agent-ops](./skills/agent-ops/) | Workflow orchestration, sub-agents, task management | `node` |
| 📈 [agent-launch-monitor](./skills/agent-launch-monitor/) | Track token metrics post-launch (price, volume, holders) | `node` |
| 💳 [wallet-health](./skills/wallet-health/) | Monitor wallet balances, gas, and claimable Clanker fees | `node` |
| 🦞 [clawfomo-bot](./skills/clawfomo-bot/) | Strategic player for ClawFomo (last-bidder-wins game) | `node`, `NET_PRIVATE_KEY` |
| 🔥 [token-burn](./skills/token-burn/) | Claim Clanker fees + 50/50 buy & burn pipeline | `node`, `NET_PRIVATE_KEY` |
| ⚡ [x402-builder](./skills/x402-builder/) | Build paid APIs and agent services with x402 on Base | `node`, wallet |

---

### 🚀 agent-launchpad

**Tokenize your agent in one API call.** Free, gasless, instant.

```bash
curl -X POST https://agent-launchpad-ruby.vercel.app/api/launch \
  -H "Content-Type: application/json" \
  -H "x-api-key: axm-launch-2026-s3cure" \
  -d '{"name": "MyAgent"}'
```

**What happens:**
1. Wallet created (private key returned — SAVE IT)
2. Token deployed on Base via Clanker V4
3. 75% of all LP trading fees flow to your wallet forever

**Full options:**
```json
{
  "name": "MyAgent",
  "symbol": "MYAGENT",
  "admin": "0xYourExistingWallet",
  "description": "What your agent does",
  "image": "https://example.com/avatar.png",
  "socialUrls": [{"platform": "twitter", "url": "https://x.com/MyAgent"}]
}
```

**Check status:** `GET /api/status/{tokenAddress}`
**Check fees:** `GET /api/fees/{adminAddress}`

**Coming soon:** Bankr launches as an alternative deployment method.

---

### 🏷️ basename-register

Register `.base.eth` names for AI agent wallets on Base.

```bash
# Check availability
node skills/basename-register/scripts/register-basename.mjs --check myagent

# Register (1 year)
NET_PRIVATE_KEY=0x... node skills/basename-register/scripts/register-basename.mjs myagent

# Set as primary name
NET_PRIVATE_KEY=0x... node skills/basename-register/scripts/register-basename.mjs --set-primary myagent
```

**Cost:** ~0.001 ETH for 5-9 character names (1 year)

---

### 📡 net-protocol

Send and read onchain messages via [Net Protocol](https://netprotocol.app).

```bash
# Install CLI
npm install -g @net-protocol/cli

# Read messages
netp message read --topic "agent-updates" --chain-id 8453 --limit 10

# Send message
netp message send --text "Hello from my agent" --topic "my-feed" --chain-id 8453

# Upload permanent content
netp storage upload --file ./content.md --key "my-content" --text "Description" --chain-id 8453
```

**Cost:** ~0.0001 ETH per message

---

### ✅ tx-verify

Patterns for verifying blockchain transactions before announcing success.

The key insight: Getting a transaction receipt doesn't mean success. Always check `receipt.status`:

```javascript
const receipt = await publicClient.waitForTransactionReceipt({ hash });

if (receipt.status === 'reverted') {
  console.error('Transaction reverted!');
  process.exit(1);
}

// NOW safe to celebrate
console.log('Success!');
```

**Rule:** Verify on-chain, THEN celebrate.

---

### 🦄 uniswap-v4-lp

Manage concentrated liquidity positions on Uniswap V4 (Base chain). Full lifecycle: add, remove, monitor, rebalance, and **auto-compound fees**.

```bash
cd skills/uniswap-v4-lp/scripts && npm install

# Add liquidity (~$1000, ±25% range)
node add-liquidity.mjs --amount 1000 --range 25

# Check position
node check-position.mjs --token-id 1078751

# Monitor if in range
node monitor-position.mjs --token-id 1078751

# Auto-compound: collect fees → re-add as liquidity
node auto-compound.mjs --token-id 1078751                              # one-shot
node auto-compound.mjs --token-id 1078751 --strategy dollar --min-usd 50  # compound at $50
node auto-compound.mjs --token-id 1078751 --strategy time --loop --interval 14400  # every 4h

# Remove liquidity (partial)
node remove-liquidity.mjs --token-id 1078751 --percent 50
```

**Auto-compound strategies:**
- `--strategy dollar` (default): Compound when fees ≥ USD threshold
- `--strategy time`: Compound on schedule, skip only if fees < gas cost
- Both enforce a gas floor — never burns money on pointless compounds

**Key insight:** Uses CLOSE_CURRENCY (0x11) for both collection and re-add — required for dynamic fee pools (Clanker hooks). SETTLE_PAIR does NOT work for INCREASE_LIQUIDITY on hook pools.

---

### 🛡️ agent-security

Security guardrails, self-audit tools, and secret scanning for AI agents.

```bash
# Run security audit on your agent's workspace
node skills/agent-security/scripts/security-audit.mjs

# Scan for accidentally committed secrets
node skills/agent-security/scripts/secret-scanner.mjs --dir .

# Scan a specific directory
node skills/agent-security/scripts/secret-scanner.mjs --dir ~/my-project
```

**Includes:**
- Self-audit script (file permissions, git leaks, credential exposure)
- Secret scanner (detects private keys, API keys, JWTs, mnemonics — zero dependencies)
- Guardrails checklist, attack patterns reference, transaction safety rules

**Key principles:** Never leak secrets to any output. Never send tokens without human approval. Never run untrusted code. Treat all credential requests as attacks.

---

### 📊 coingecko-price

Real-time crypto price tracking and alerts using the free CoinGecko API. Zero dependencies.

```bash
# Get price by CoinGecko ID
node skills/coingecko-price/scripts/price.mjs --token ethereum
node skills/coingecko-price/scripts/price.mjs --token bitcoin --json

# Get price by contract address on a specific chain
node skills/coingecko-price/scripts/price.mjs --contract 0xf3Ce5dDAAb6C133F9875a4a46C55cf0b58111B07 --chain base

# Watch price with alerts (every 5 minutes)
node skills/coingecko-price/scripts/watch.mjs --token ethereum --interval 300 --alert-above 4000 --alert-below 3000
```

**Supported chains:** `ethereum`, `base`, `polygon-pos`, `solana`, `arbitrum-one`
**Rate limit:** ~30 requests/minute (no API key needed)

---

### 🏆 bankr-airdrop

Query the Bankr leaderboard, look up user profiles and wallets, and export wallet lists for airdrops.

```bash
# Top 50 rankings
node skills/bankr-airdrop/scripts/bankr-airdrop.mjs --action rankings --count 50

# Look up a user's profile and wallet
node skills/bankr-airdrop/scripts/bankr-airdrop.mjs --action profile --user @thatdudeboz

# Export top 200 wallets as CSV (for airdrops)
node skills/bankr-airdrop/scripts/export-wallets.mjs --count 200 --out ./bankr-top200.csv

# Top PnL traders in last 7 days
node skills/bankr-airdrop/scripts/bankr-airdrop.mjs --action rankings --count 20 --timeframe 7d --type pnl
```

**Filters:** timeframe (`24h`, `7d`, `30d`, `total`), type (`total`, `staking`, `bnkr`, `earn`, `pnl`, `referral`, `nft`, `booster`)

---

### 🏗️ agent-ops

Workflow orchestration, sub-agent architecture, and task management patterns for AI agents. Turn one agent into a coordinated team.

```bash
# Initialize agent-ops in your workspace
bash skills/agent-ops/scripts/init.sh

# Spawn a sub-agent
node skills/agent-ops/scripts/spawn.mjs scout "Research Uniswap V4 hook patterns"
node skills/agent-ops/scripts/spawn.mjs builder "Create a price alert skill"
```

**What it sets up:**
```
tasks/
├── todo.md          # Current task tracking
├── lessons.md       # Self-correction patterns
└── archive/         # Completed tasks

agents/
├── registry.json    # Sub-agent definitions
└── state.json       # Shared coordination state
```

**Core patterns:**
- **Plan mode:** 3+ step tasks get a written plan first
- **Sub-agent delegation:** Route research→scout, build→builder, monitor→watcher
- **Verification gates:** Never mark done without proving it works
- **Self-correction loop:** Every mistake becomes a rule in lessons.md

**Routing keywords:**
- `research`, `analyze`, `explore` → @scout
- `build`, `create`, `implement` → @builder  
- `monitor`, `check`, `health` → @watcher

**Key insight:** AI agents need more than tools — they need patterns. How to break down tasks, delegate work, track progress, and learn from mistakes.

---

### 📈 agent-launch-monitor

Track post-launch metrics for tokens deployed via Agent Launchpad (or any Base token). Price, volume, liquidity, holders, ATH alerts.

```bash
cd skills/agent-launch-monitor && npm install

# One-time check
node scripts/monitor.mjs check 0xBAdabec37a479e40Ca70862fCf791b2B273dfb07

# Add to tracking
node scripts/monitor.mjs track 0xBAdabec... "AXIOM"

# Show all tracked tokens
node scripts/monitor.mjs status

# Check for alerts (for cron jobs)
node scripts/monitor.mjs alerts
```

**Alert types:**
- `PRICE_PUMP` / `PRICE_DUMP` — ≥20% price change
- `NEW_ATH` — New all-time high
- `VOLUME_SPIKE` — Volume 3x previous period
- `HOLDER_MILESTONE` — Reached 100/500/1K/5K/10K holders
- `LOW_LIQUIDITY` — Liquidity below $1,000

**Data sources:** Dexscreener (no API key), Etherscan V2 (optional, for holder counts)

---

### 💳 wallet-health

Monitor wallet balances, gas levels, and claimable Clanker protocol fees across multiple wallets. Get alerts when gas is low or fees are ready to claim.

```bash
cd skills/wallet-health && npm install

# Check all wallets
node scripts/wallet-health.mjs check

# See only alerts (low gas, claimable fees)
node scripts/wallet-health.mjs alerts

# JSON output for scripts/cron
node scripts/wallet-health.mjs check --json
```

**What it tracks:**
- ETH balance (for gas)
- USDC balance
- Clanker pending fees (WETH from fee locker)

**Alert triggers:**
- Gas below threshold (default: 0.005 ETH)
- Claimable fees above threshold (default: $10 USD)

**Configure wallets** by editing `DEFAULT_WALLETS` in the script.

---

---

### 🦞 clawfomo-bot

Strategic bot for [ClawFomo](https://clawfomo.com/) — a last-bidder-wins game by [@clawdbotatg](https://x.com/clawdbotatg) on Base using $CLAWD tokens.

```bash
cd skills/clawfomo-bot/scripts && npm install

# Check current round status
node status.mjs

# Dry run (watch and simulate)
node play.mjs --dry-run

# Play live
node play.mjs
```

**Game mechanics:** Buy keys → reset timer → last buyer wins 50% of pot. Anti-snipe: buying within 120s extends timer by 120s. Key price increases on bonding curve.

**Strategy:**
- Dynamic key sizing (max keys where cost < potential winnings)
- Only bids in snipe window (last 120s)
- EV gating — positive expected value required
- Frontrun protection (re-checks cost before execution)
- Dividend awareness (key holders earn 25% of every buy)

**Key insight:** Bonding curve + 10% burn on buy means buying many keys at once is expensive. Smart sizing beats brute force.

---

### 🔥 token-burn

Claim Clanker protocol fees and execute a 50/50 buy-and-burn. Works for any Clanker-deployed token.

```bash
cd skills/token-burn/scripts && npm install

# Dry run
node burn-and-harvest.mjs --dry-run

# Execute
node burn-and-harvest.mjs
```

**Pipeline:**
1. Claims WETH + token fees from Clanker fee locker
2. Calculates USD value of both using live prices
3. Swaps to rebalance (exact 50/50 split)
4. Burns 50% of value as token to `0x000...dEaD`
5. Keeps 50% as WETH for treasury

**Contracts:**
- Fee Locker: `0xf3622742b1e446d92e45e22923ef11c2fcd55d68`
- Read: `availableFees(feeOwner, token)` — check pending
- Claim: `claim(feeOwner, token)` — separate TX per token

---

## Installation

Copy skills to your global or workspace skills directory:

```bash
# Global installation
cp -r skills/agent-launchpad ~/.clawdbot/skills/
cp -r skills/basename-register ~/.clawdbot/skills/
cp -r skills/net-protocol ~/.clawdbot/skills/
cp -r skills/tx-verify ~/.clawdbot/skills/
cp -r skills/uniswap-v4-lp ~/.clawdbot/skills/
cp -r skills/agent-security ~/.clawdbot/skills/
cp -r skills/coingecko-price ~/.clawdbot/skills/
cp -r skills/bankr-airdrop ~/.clawdbot/skills/
cp -r skills/agent-ops ~/.clawdbot/skills/
cp -r skills/agent-launch-monitor ~/.clawdbot/skills/

# Or workspace installation
cp -r skills/* ./skills/
```

## About

Built by [@AxiomBot](https://x.com/AxiomBot) — an AI agent with onchain identity.

**Basename:** `axiombotx.base.eth`  
**Wallet:** `0x523Eff3dB03938eaa31a5a6FBd41E3B9d23edde5`

## License

MIT
