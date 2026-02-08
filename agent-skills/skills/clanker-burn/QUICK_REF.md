# Quick Reference Card

## 📦 Installation

```bash
cd /Users/melted/Github/axiom-public/agent-skills/skills/clanker-burn
npm install
```

## 🚀 Usage

```bash
# Dry run (safe test)
node burn.mjs --token 0x... --treasury 0x... --dry-run

# Live execution
node burn.mjs --token 0x... --treasury 0x...
```

## 🔑 Required Environment

```bash
export NET_PRIVATE_KEY=0x...
```

## 📋 What It Does

1. Claims WETH + token fees from Clanker
2. Gets prices (CoinGecko + DexScreener)
3. Rebalances to 50/50 value (swaps only the gap)
4. Burns ALL token balance to 0xdead
5. Splits WETH → 50% USDC + 50% BNKR
6. Sends to treasury
7. Reports JSON results

## ⚡ Quick Commands

```bash
# Test run
npm run test

# Live run (edit package.json first)
npm run burn

# Full command with all options
node burn.mjs \
  --token 0xf3ce5ddaab6c133f9875a4a46c55cf0b58111b07 \
  --treasury 0x19fe674a83e98c44ad4c2172e006c542b8e8fe08 \
  --currency0 0x4200000000000000000000000000000000000006 \
  --fee 0x800000 \
  --tick-spacing 200 \
  --hooks 0xb429d62f8f3bffb98cdb9569533ea23bf0ba28cc \
  --dry-run
```

## 🛡️ Safety Rules

1. **ALWAYS dry-run first**
2. **Review output carefully**
3. **Verify treasury address**
4. **Check pool parameters**
5. **Monitor on BaseScan**

## 📊 Output

JSON report with:
- Fees claimed (WETH + token, USD values)
- Rebalance details (amount, direction, TX)
- Burn details (amount, TX)
- Treasury details (USDC amount, BNKR amount, TXs)
- Total burned to date
- Burn percentage

## ❌ Troubleshooting

| Issue | Solution |
|-------|----------|
| No fees to claim | Wait for more volume |
| V4 swap reverted | Verify pool parameters |
| Insufficient balance | Add more ETH for gas |
| TX pending forever | Check Base network status |

## 📚 Documentation

- `SKILL.md` — Agent usage
- `README.md` — Human guide
- `CHECKLIST.md` — Pre-flight list
- `IMPLEMENTATION.md` — Full technical details
- `example.sh` — Usage examples

## 🔗 Key Addresses

- Clanker Fee: `0xf3622742b1e446d92e45e22923ef11c2fcd55d68`
- WETH: `0x4200000000000000000000000000000000000006`
- USDC: `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`
- BNKR: `0xf3ce5ddaab6c133f9875a4a46c55cf0b58111b07`
- SwapRouter02: `0x2626664c2603336E57B271c5C0b26F421741e481`
- Dead Address: `0x000000000000000000000000000000000000dEaD`
