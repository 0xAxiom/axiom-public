# bankr-airdrop

Daily pro rata airdrop of an agent's native token to Bankr Club NFT holders on Base. Claims Clanker fees, sends the WETH side to treasury, and disperses the token side to holders proportional to NFT count.

```bash
# Snapshot holders (5:58 PM PT)
python3 scripts/snapshot-bankr-holders.py

# Claim + airdrop runs at 6:00 PM PT — see SKILL.md for the full step list
```

See `SKILL.md` for configuration variables, schedule, slippage rules, and safety checks.
