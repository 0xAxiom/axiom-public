# Pre-Execution Checklist

Before running the burn pipeline, verify these items:

## Environment Setup

- [ ] `NET_PRIVATE_KEY` is set in environment
- [ ] `BASE_RPC_URL` is set (or using default)
- [ ] Wallet has ETH for gas (estimate ~0.01 ETH)
- [ ] Dependencies installed (`npm install`)

## Verify Parameters

- [ ] Token address is correct (Clanker token)
- [ ] Treasury address is correct (destination for USDC+BNKR)
- [ ] Pool parameters match token's V4 pool:
  - [ ] `--currency0` (default: WETH)
  - [ ] `--currency1` (the token)
  - [ ] `--fee` (default: 0x800000)
  - [ ] `--tick-spacing` (default: 200)
  - [ ] `--hooks` (default: 0xb429d62f8f3bffb98cdb9569533ea23bf0ba28cc)

## Pre-Flight

- [ ] Run with `--dry-run` first
- [ ] Review dry-run output:
  - [ ] Fees to claim are non-zero
  - [ ] Prices look reasonable
  - [ ] Rebalance direction makes sense
  - [ ] Token amounts to burn are expected
- [ ] Confirm treasury address one more time
- [ ] Have BaseScan open to monitor transactions

## Execution

- [ ] Remove `--dry-run` flag
- [ ] Run the command
- [ ] Monitor each step in console
- [ ] Save transaction hashes
- [ ] Verify on BaseScan:
  - [ ] Fee claims succeeded
  - [ ] Rebalance swap succeeded (if needed)
  - [ ] Burn transaction sent tokens to 0xdead
  - [ ] USDC arrived at treasury
  - [ ] BNKR arrived at treasury

## Post-Execution

- [ ] Save JSON report output
- [ ] Verify burn percentage increased
- [ ] Check treasury balances
- [ ] Update records/logs
- [ ] Monitor token price reaction

## Common Issues

### "No fees to claim"
- Wait for more trading volume
- Check you're the fee owner for this token

### "V4 swap reverted"
- Verify pool parameters are correct
- Check pool has sufficient liquidity
- Try adjusting slippage (future feature)

### "Insufficient balance"
- Gas too low — add more ETH
- RPC issue — wait and retry

### Transaction pending forever
- Check Base network status
- Increase gas price manually if urgent
- Contact RPC provider if needed

## Success Indicators

✅ All 6 steps completed without errors  
✅ All transaction hashes printed  
✅ JSON report generated  
✅ Burn percentage increased  
✅ Treasury received USDC + BNKR  
✅ Token price stable or increased (from buy pressure)

## Emergency Stop

If something goes wrong mid-execution:

1. **Do NOT panic** — script is designed to fail-safe
2. Check which step failed (console output)
3. Verify what succeeded (check wallet balances)
4. If fees claimed but not burned — that's OK, run again
5. If burned but treasury failed — tokens are gone, WETH remains (manual send)
6. Save error output and transaction hashes for debugging

## Support

Questions or issues? Check:
- `README.md` for usage guide
- `SKILL.md` for agent instructions
- Reference scripts in `/uniswap-v4-lp/scripts/`

Report bugs with:
- Full command executed
- Console output (all steps)
- Transaction hashes (if any succeeded)
- Error message
