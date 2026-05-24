# awaken-normie

Awaken a [Normies](https://normies.art) NFT as a real ERC-8004 agent on Ethereum mainnet (also runnable on Base / Sepolia for the adapter integration, but Normies only deploys on mainnet).

After awakening, the Normie has a stable on-chain `agentId`, a verifiable controller (whoever holds the Normie), and a live persona / A2A 0.3.0 agent card served at `api.normies.art`.

**Next step after awakening:** [`normie-agent-kit`](../normie-agent-kit/) — the inbound responder that lets your Normie answer mentions in its own voice. The same kit runs [Normie #7593](https://normies.art) live: first on-chain persona reply [2026-05-24](https://basescan.org/tx/0x21c62cdf813ec2e2376dac7827712aacc173a9bf6c224e5aac342110e465db79). Dev home: [github.com/0xAxiom/normies-tools](https://github.com/0xAxiom/normies-tools).

## Install

```bash
cp -r awaken-normie ~/.openclaw/skills/
cd awaken-normie/scripts && npm install
```

## Quick start

```bash
# Dry-run (predicts agentId, estimates gas, never broadcasts)
node scripts/awaken.mjs <tokenId>

# Broadcast for real
node scripts/awaken.mjs <tokenId> --send

# Verify an existing binding
node scripts/awaken.mjs --verify <agentId>

# Watch a wallet for incoming Normies (daemon)
node scripts/watch.mjs mainnet [walletAddress]
```

## ENV vars

| Var | Purpose |
|---|---|
| `NET_PRIVATE_KEY` | Signer private key (must hold the Normie at register time) |
| `AXIOM_WALLET_ADDRESS` | Optional — used as default for `watch.mjs` |
| `INFURA_API_KEY` | Used to build the default RPCs (or override with `MAINNET_RPC_URL` / `BASE_RPC_URL` / `SEPOLIA_RPC_URL`) |

## Contracts

| Chain | Adapter8004 proxy |
|---|---|
| Ethereum mainnet | `0xde152AfB7db5373F34876E1499fbD893A82dD336` |
| Base | `0x270d25D2c59A8bcA1B0f40ad95fF7806c0025c27` |
| Sepolia | `0x7621630cB63a73a194f45A3E6801B8C6A7eC2f92` |

Adapter source: https://github.com/nxt3d/adapter · ERC-8004 draft: https://eips.ethereum.org/EIPS/eip-8004

## Cost

~245k gas per register. ~$0.05–$0.20 at typical mainnet base fees.

## Gotchas

See [`SKILL.md`](./SKILL.md) for the full list — the short version: the **adapter** owns the agent NFT (not you), `getAgentWallet` is `0x0` right after register (the adapter clears it on purpose), and the on-chain `agent-binding` metadata is the 20-byte adapter pointer only — readers find the adapter from those bytes, then call `bindingOf(agentId)` for the canonical record.

---

Part of [axiom-public](https://github.com/0xAxiom/axiom-public) · MIT License
