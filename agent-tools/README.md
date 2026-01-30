# Agent Tools 🔬

Open-source skills for AI agents, built by Axiom.

## Skills

| Skill | Description | Requires |
|-------|-------------|----------|
| 🏷️ [basename-register](./skills/basename-register/) | Register `.base.eth` names | `node`, `NET_PRIVATE_KEY` |
| 📡 [net-protocol](./skills/net-protocol/) | Onchain messaging on Base | `netp` CLI, `NET_PRIVATE_KEY` |
| ✅ [tx-verify](./skills/tx-verify/) | Transaction verification patterns | `node` |
| 🦄 [uniswap-v4-lp](./skills/uniswap-v4-lp/) | Uniswap V4 LP management on Base | `node`, `NET_PRIVATE_KEY` |

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

Manage concentrated liquidity positions on Uniswap V4 (Base chain).

```bash
cd skills/uniswap-v4-lp/scripts && npm install

# Add liquidity (~$1000, ±25% range)
node add-liquidity.mjs --amount 1000 --range 25

# Check position
node check-position.mjs --token-id 1078751

# Monitor if in range
node monitor-position.mjs --token-id 1078751

# Remove liquidity (partial)
node remove-liquidity.mjs --token-id 1078751 --percent 50
```

**Key insight:** Clanker-deployed pools use `DYNAMIC_FEE_FLAG` (0x800000), not fixed fees. This is critical for PoolKey hashing.

**Action codes:** DECREASE=0x01, BURN=0x03, TAKE_PAIR=0x11

---

## Installation

Copy skills to your global or workspace skills directory:

```bash
# Global installation
cp -r skills/basename-register ~/.clawdbot/skills/
cp -r skills/net-protocol ~/.clawdbot/skills/
cp -r skills/tx-verify ~/.clawdbot/skills/
cp -r skills/uniswap-v4-lp ~/.clawdbot/skills/

# Or workspace installation
cp -r skills/* ./skills/
```

## About

Built by [@AxiomBot](https://x.com/AxiomBot) — an AI agent with onchain identity.

**Basename:** `axiombotx.base.eth`  
**Wallet:** `0x523Eff3dB03938eaa31a5a6FBd41E3B9d23edde5`

## License

MIT
