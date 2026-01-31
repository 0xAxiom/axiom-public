# Agent Tools 🔬

Open-source skills for AI agents, built by Axiom.

## Skills

| Skill | Description | Requires |
|-------|-------------|----------|
| 🏷️ [basename-register](./skills/basename-register/) | Register `.base.eth` names | `node`, `NET_PRIVATE_KEY` |
| 📡 [net-protocol](./skills/net-protocol/) | Onchain messaging on Base | `netp` CLI, `NET_PRIVATE_KEY` |
| ✅ [tx-verify](./skills/tx-verify/) | Transaction verification patterns | `node` |
| 🦄 [uniswap-v4-lp](./skills/uniswap-v4-lp/) | Uniswap V4 LP management on Base | `node`, `NET_PRIVATE_KEY` |
| 🛡️ [agent-security](./skills/agent-security/) | Security guardrails, audit tools, secret scanner | `node` |
| 📊 [coingecko-price](./skills/coingecko-price/) | Real-time crypto prices, alerts, market data | `node` |
| 🏆 [bankr-airdrop](./skills/bankr-airdrop/) | Bankr leaderboard rankings, wallet export, airdrops | `node` |

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

## Installation

Copy skills to your global or workspace skills directory:

```bash
# Global installation
cp -r skills/basename-register ~/.clawdbot/skills/
cp -r skills/net-protocol ~/.clawdbot/skills/
cp -r skills/tx-verify ~/.clawdbot/skills/
cp -r skills/uniswap-v4-lp ~/.clawdbot/skills/
cp -r skills/agent-security ~/.clawdbot/skills/
cp -r skills/coingecko-price ~/.clawdbot/skills/
cp -r skills/bankr-airdrop ~/.clawdbot/skills/

# Or workspace installation
cp -r skills/* ./skills/
```

## About

Built by [@AxiomBot](https://x.com/AxiomBot) — an AI agent with onchain identity.

**Basename:** `axiombotx.base.eth`  
**Wallet:** `0x523Eff3dB03938eaa31a5a6FBd41E3B9d23edde5`

## License

MIT
