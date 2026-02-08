# Wallet Health Monitor

Monitor wallet balances, gas levels, and claimable fees across multiple wallets. Get alerts when gas is low or when Clanker fees are ready to claim.

## Quick Start

```bash
# Check all wallets
cd ~/Github/axiom-public/agent-skills/skills/wallet-health
node scripts/wallet-health.mjs check

# See only alerts (low gas, claimable fees)
node scripts/wallet-health.mjs alerts

# JSON output for scripts/cron
node scripts/wallet-health.mjs check --json
```

## What It Monitors

For each configured wallet:
- **ETH Balance** — for gas tracking
- **USDC Balance** — stablecoin holdings
- **Clanker Pending Fees** — WETH fees ready to claim from Clanker fee locker

## Alerts

Triggers alerts when:
- Gas falls below configured minimum (default: 0.005 ETH for main wallet)
- Claimable Clanker fees exceed threshold (default: $10 USD)

## Configuration

Edit the `DEFAULT_WALLETS` object in the script to add/modify wallets:

```javascript
const DEFAULT_WALLETS = {
  main: {
    address: '0x...',
    label: 'My Main Wallet',
    checkGas: true,
    checkClankerFees: true,
    minGasEth: 0.005,
  },
  // Add more wallets...
};
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `BASE_RPC_URL` | No | Custom RPC URL (defaults to public Base RPC) |
| `TELEGRAM_BOT_TOKEN` | No | For `--telegram` alerts |
| `TELEGRAM_CHAT_ID` | No | For `--telegram` alerts |

## Example Output

```
📊 Wallet Health Summary
════════════════════════════════════════

🏷️  Axiom Main
    0x523Eff3d...d23edde5
    ETH: 0.022959
    USDC: $62.10
    Pending Clanker: 0.017676 WETH
    ℹ️ Claimable: 0.017676 WETH (~$44.19)

🏷️  Bankr Wallet
    0x19fe674a...b8e8fe08
    ETH: 0.008798
    USDC: $2.45

════════════════════════════════════════
💰 Totals:
   ETH: 0.031757 (~$79.39)
   USDC: $64.54
   Pending Fees: 0.017676 WETH (~$44.19)
```

## Cron Integration

Add to your cron schedule to get regular alerts:

```yaml
# Check wallet health every 4 hours
schedule:
  kind: cron
  expr: "0 */4 * * *"
payload:
  kind: systemEvent
  text: "Check wallet health: cd ~/Github/axiom-public/agent-skills/skills/wallet-health && node scripts/wallet-health.mjs alerts"
```

## Related Skills

- **uniswap-v4-lp** — For LP fee collection and management
- **analytics** — For detailed portfolio/token analysis
- **agent-launch-monitor** — For tracking launched token performance

## Dependencies

- `viem` — Ethereum interactions
- `dotenv` — Environment configuration

## Author

Built by Axiom 🔬 on 2026-02-02
