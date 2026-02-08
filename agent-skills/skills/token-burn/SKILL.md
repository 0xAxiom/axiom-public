# Token Buy & Burn Skill 🔥

Open-source pipeline for claiming Clanker protocol fees and executing a 50/50 buy-and-burn strategy.

Built by [@AxiomBot](https://x.com/AxiomBot) — an autonomous AI agent on Base.

## What It Does

Clanker tokens generate protocol fees (WETH + token) from trading activity. This skill:

1. **Claims** pending fees from the Clanker fee locker contract
2. **Calculates** USD value of both tokens using live prices
3. **Swaps** to rebalance — ensures exactly 50% is the project token
4. **Burns** 50% by sending to `0x000...dEaD`
5. **Keeps** remaining 50% as WETH for treasury/operations

## Usage

```bash
# Dry run — show what would happen
node scripts/burn-and-harvest.mjs --dry-run

# Execute burn
node scripts/burn-and-harvest.mjs
```

## How It Works

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│ Claim WETH   │────▶│ Calculate    │────▶│ Swap to      │
│ Claim TOKEN  │     │ 50/50 split  │     │ rebalance    │
└──────────────┘     └──────────────┘     └──────────────┘
                                                 │
                     ┌──────────────┐            │
                     │ 🔥 Burn 50%  │◀───────────┘
                     │ to 0xdEaD    │
                     │              │
                     │ 💰 Keep 50%  │
                     │ as WETH      │
                     └──────────────┘
```

## Contracts

| Contract | Address | Description |
|----------|---------|-------------|
| Clanker Fee Locker | `0xf3622742b1e446d92e45e22923ef11c2fcd55d68` | Protocol fee storage |
| Dead Address | `0x000000000000000000000000000000000000dEaD` | Burn destination |
| Permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` | Token approvals |

## Key Functions

### Clanker Fee Locker
- `availableFees(address feeOwner, address token)` — check pending fees
- `claim(address feeOwner, address token)` — claim fees (two TXs: one for WETH, one for token)

### Burn
- Standard ERC20 `transfer(0xdEaD, amount)` — tokens sent to dead address are permanently unrecoverable

## Adapting for Your Token

1. Set your token address and fee owner address in the script
2. Set your Clanker fee locker address (or equivalent)
3. Configure your Uniswap V4 pool for swaps
4. Run `--dry-run` first to verify the math

## Environment

- `NET_PRIVATE_KEY` — Wallet private key
- `BASE_RPC_URL` — Base RPC endpoint (optional)

## Safety

- ✅ Always calculates exact 50/50 split using live prices
- ✅ Validates sufficient balance before burning
- ✅ Dry-run mode for testing
- ✅ Never burns WETH — only project tokens go to dead address
- ⚠️ Burns are irreversible — double-check with `--dry-run` first

## License

MIT
