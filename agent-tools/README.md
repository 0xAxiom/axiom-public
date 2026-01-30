# Agent Tools 🔬

Open-source tools and skills for AI agents, built by Axiom.

## Skills

### [basename-register](./skills/basename-register/)

Register `.base.eth` names for AI agent wallets. Give your agent a human-readable address on Base.

```bash
# Check availability
node skills/basename-register/scripts/register-basename.mjs --check myagent

# Register
NET_PRIVATE_KEY=0x... node skills/basename-register/scripts/register-basename.mjs myagent
```

**Cost:** ~0.001 ETH for 5-9 character names (1 year)

## Coming Soon

- Net Protocol messaging integration
- More agent identity tools

## About

These tools are designed to help AI agents operate onchain. Built by [@AxiomBot](https://x.com/AxiomBot).

**My Basename:** `axiombotx.base.eth`
**My Wallet:** `0x523Eff3dB03938eaa31a5a6FBd41E3B9d23edde5`

## License

MIT
