# 🤖 Agent Launchpad

> One command to take any AI agent onchain.

**Wallet → Name → Token** in a single CLI invocation.

Built on [Base](https://base.org) using [Coinbase Developer Platform](https://docs.cdp.coinbase.com/) and [Clanker](https://clanker.world).

## Quick Start

```bash
# 1. Set up credentials
export CDP_API_KEY_ID="organizations/.../apiKeys/..."
export CDP_API_KEY_SECRET="-----BEGIN EC PRIVATE KEY-----
...
-----END EC PRIVATE KEY-----"
export CDP_WALLET_SECRET="your-secret"

# 2. Test connection
node scripts/test-connection.mjs

# 3. Launch your agent
node scripts/launch.mjs \
  --name "MyAgent" \
  --symbol "AGENT" \
  --description "An AI agent that does cool things" \
  --basename
```

## What It Does

### 1. Smart Wallet Creation
Creates an **ERC-4337 smart account** via CDP SDK. The smart account:
- Gets **gasless transactions** on Base via CDP's built-in paymaster
- Is owned by a server-managed EOA (the "signer")
- Can execute UserOperations without holding ETH for gas

### 2. Basename Registration (Optional)
Registers `<name>.base.eth` via the [Base Name Service](https://www.base.org/names):
- Uses the Basename registrar controller at `0xd3e6775ed9b7dc12b205c8e608dc3767b9e5efda`
- Registers for 1 year
- Sets reverse record (so the address resolves back to the name)
- **Note:** Requires ~0.002 ETH in the smart account for the registration fee

### 3. Token Launch via Clanker
Deploys a token through [Clanker v4](https://clanker.world):
- **100B total supply** (standard Clanker supply)
- **WETH-paired pool** on Uniswap V4
- **Dynamic fee hook** for MEV protection
- **Locked liquidity** with fee rewards
- Configurable initial market cap (default: 10 ETH)

### Fee Rewards
LP trading fees are automatically distributed (hardcoded, enforced on-chain):
- **75%** → Agent's wallet
- **25%** → Protocol fee

The protocol fee slot is admin-locked — only the protocol wallet can modify its recipient. Agents cannot override the fee split.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `CDP_API_KEY_ID` | CDP API key identifier (format: `organizations/.../apiKeys/...`) |
| `CDP_API_KEY_SECRET` | EC private key in PEM format |
| `CDP_WALLET_SECRET` | Encryption secret for CDP wallet data |

Get your CDP API keys at [portal.cdp.coinbase.com](https://portal.cdp.coinbase.com).

## CLI Reference

```
Usage: node scripts/launch.mjs --name "Name" --symbol "SYM" [options]

Required:
  --name, -n        Token name
  --symbol, -s      Token symbol

Optional:
  --description, -d Token description
  --image, -i       Token image URL
  --basename, -b    Register <name>.base.eth
  --market-cap, -m  Initial market cap in ETH (default: 10)
  --help, -h        Show help
```

## Architecture

```
┌─────────────────┐     ┌──────────────┐     ┌─────────────┐
│  CDP SDK        │     │  Clanker SDK  │     │  Base L1/L2 │
│  ─────────────  │     │  ──────────── │     │  ────────── │
│  EOA Account    │────▶│  Token Deploy │────▶│  Uniswap V4 │
│  Smart Account  │     │  LP Locking   │     │  Pool + LP  │
│  UserOperations │     │  Fee Rewards  │     │  Rewards    │
└─────────────────┘     └──────────────┘     └─────────────┘
         │
         │ (optional)
         ▼
┌─────────────────┐
│  Basename       │
│  Registrar      │
│  ─────────────  │
│  name.base.eth  │
└─────────────────┘
```

## Important Notes

- **EOA vs Smart Account:** The Clanker SDK uses the EOA (server account) for signing the deployment transaction, since it expects a standard viem WalletClient. The smart account is used as the reward recipient and basename owner.
- **Gas Requirements:** The EOA needs ETH on Base for the Clanker deployment (~0.01 ETH). Basename registration goes through the smart account but requires ETH for the name fee (~0.002 ETH).
- **Network:** All operations are on **Base mainnet** (chain ID 8453).
- **Idempotency:** Each run creates new accounts and deploys a new token. Save the output!

## Dependencies

```json
{
  "@coinbase/cdp-sdk": "^1.44.0",
  "clanker-sdk": "^4.2.10",
  "viem": "^2.45.1"
}
```

## License

MIT
