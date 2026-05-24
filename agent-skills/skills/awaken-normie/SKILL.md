---
name: awaken-normie
description: Awaken a Normies NFT as an ERC-8004 agent on Ethereum mainnet (or Base / Sepolia) by registering it through the Adapter8004 proxy. Use when the user owns a Normie and wants to bind it to a verifiable on-chain agent identity, fetch its live persona / A2A card, or watch a wallet for incoming Normies. Triggers on "awaken normie", "bind normie", "register normie as agent", "normie agent", "ERC-8004 normie", "adapter8004 normie".
---

# Awaken Normie

Bind a Normies NFT (`0x9Eb6E2025B64f340691e424b7fe7022fFDE12438` on Ethereum mainnet) to an ERC-8004 agent identity via the Adapter8004 proxy. After registration, the agent has a stable on-chain `agentId`, the holder of the Normie is its on-chain controller, and the Normies API exposes a live persona + A2A 0.3.0 agent card that evolve as the Normie's canvas state changes.

> After awakening: [`normie-agent-kit`](../normie-agent-kit/) is the live inbound responder that pairs with this skill. It runs Normie #7593 on a 4x/day cron — first on-chain persona reply [2026-05-24](https://basescan.org/tx/0x21c62cdf813ec2e2376dac7827712aacc173a9bf6c224e5aac342110e465db79). Dev home: [github.com/0xAxiom/normies-tools](https://github.com/0xAxiom/normies-tools).

## When to use

- User says "awaken / bind / register / claim" a Normie or its agent identity.
- User wants to verify an existing Normie ↔ agentId binding.
- User wants to watch a wallet for an incoming Normie and auto-prep the awakening flow.

NOT for:
- Registering a non-Normies NFT as an 8004 agent — use the generic `erc-8004` skill, or call `Adapter8004.register(standard, tokenContract, tokenId, agentURI)` directly.
- Editing the Normie itself (canvas / burn-to-edit) — that's the NormiesCanvas contract, separate skill.

## Prerequisites

| What | Where |
|---|---|
| Wallet private key | `~/.axiom/wallet.env` exports `NET_PRIVATE_KEY` (or `MAINNET_PRIVATE_KEY`) and `AXIOM_WALLET_ADDRESS` |
| RPC | `INFURA_API_KEY` or override `MAINNET_RPC_URL` / `BASE_RPC_URL` / `SEPOLIA_RPC_URL` |
| Ownership | Signer wallet must hold the Normie `tokenId` at the time of registration |
| Gas | ~245k gas per register tx (~$0.05–$0.20 at current mainnet base fees) |

## Contracts

| Chain | Adapter8004 proxy | ERC-8004 IdentityRegistry | Normies (ERC-721) |
|---|---|---|---|
| Ethereum mainnet | `0xde152AfB7db5373F34876E1499fbD893A82dD336` | `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` | `0x9Eb6E2025B64f340691e424b7fe7022fFDE12438` |
| Base | `0x270d25D2c59A8bcA1B0f40ad95fF7806c0025c27` | `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` | n/a |
| Sepolia | `0x7621630cB63a73a194f45A3E6801B8C6A7eC2f92` | `0x8004A818BFB912233c491871b3d84c89A494BD9e` | n/a |

## Usage

Install once (the scripts directory is self-contained):

```sh
cd scripts && npm install
```

### Awaken a Normie (dry-run by default)

```sh
node scripts/awaken.mjs <tokenId>
# example: node scripts/awaken.mjs 7593
```

Builds the calldata, predicts the `agentId` via `staticCall`, estimates gas, surfaces any prior binding from the Normies indexer — **does not broadcast**. Always run dry-run first; only proceed with `--send` after the user reviews the calldata.

### Broadcast the register tx

```sh
node scripts/awaken.mjs <tokenId> --send
```

After the tx mines, the script:
1. Parses `AgentBound(agentId, standard, tokenContract, tokenId, registeredBy)` from the receipt.
2. Calls `bindingOf`, `ownerOf`, `tokenURI`, `getAgentWallet`, `getMetadata(agent-binding)`, `isController` against the on-chain state for verification.
3. Polls `https://api.normies.art/agents/binding/<tokenId>` until the Ponder indexer confirms the new binding.
4. Fetches `https://api.normies.art/agents/info/<tokenId>` and prints the live persona (name, type, tagline, greeting, canvas state).

### Verify an existing binding

```sh
node scripts/awaken.mjs --verify <agentId>
```

### Watch a wallet for incoming Normies

Run as a daemon (logs to stdout, appends to `incoming.json`):

```sh
node scripts/watch.mjs mainnet [walletAddress]
```

Defaults to `AXIOM_WALLET_ADDRESS`. Polls `eth_getLogs` every 15s for ERC-721 `Transfer` events with `topic[2] = paddedWallet` on the Normies contract.

### Other chains

```sh
node scripts/awaken.mjs <tokenId> --send --chain sepolia
```

Note: only mainnet currently uses the Normies contract; Base / Sepolia adapters exist but no Normies deployment to bind against. Useful for testing the adapter integration with a non-Normies ERC-721.

## How registration works under the hood

1. `register(uint8 standard, address tokenContract, uint256 tokenId, string agentURI)` on the Adapter8004 proxy. Selector: `0xb68ca002`. For Normies, `standard = 0` (ERC-721), `tokenContract = 0x9Eb6...2438`, `agentURI = https://api.normies.art/agents/metadata/<tokenId>`.
2. The adapter verifies the caller's control of the external token (here: `IERC721.ownerOf(tokenId) == msg.sender`), calls `IdentityRegistry.register(agentURI)`, becomes the on-chain owner of the new agent NFT, stores the `agentId → (standard, tokenContract, tokenId)` binding immutably, writes the 20-byte adapter address under metadata key `agent-binding`, and immediately calls `unsetAgentWallet(agentId)` so the default `agentWallet = msg.sender` (the adapter) is cleared.
3. Control of the agent record passes to whoever holds the bound Normie. After transfer of the Normie, `isController(agentId, newHolder) == true` automatically; no rebinding tx needed.
4. The new owner can later call `setAgentURI`, `setMetadata`, `setMetadataBatch`, `setAgentWallet`, `unsetAgentWallet` on the adapter — each gated by `isController`.

## Agent surface unlocked after awakening

| Endpoint | Returns |
|---|---|
| `GET https://api.normies.art/agents/metadata/<tokenId>` | ERC-8004 registration-v1 JSON (this is the `agentURI`) |
| `GET https://api.normies.art/agents/info/<tokenId>` | Live persona — name, type, tagline, backstory, greeting, personality, communicationStyle, quirks, **systemPrompt**, canvas state |
| `GET https://api.normies.art/agents/agent-card/<tokenId>` | A2A 0.3.0 Agent Card |
| `GET https://api.normies.art/agents/image/<tokenId>` | Composited portrait SVG |
| `GET https://api.normies.art/agents/binding/<tokenId>` | `{ agentId, registeredBy, txHash, ... }` from the Ponder indexer |
| `GET https://api.normies.art/agents/by-agent-id/<agentId>` | Reverse lookup |

Persona is regenerated live on every read — name and type are stable per `tokenId`, but backstory / personality / `systemPrompt` evolve as the Normie's canvas state crosses level bands (untouched / early / mid / late).

## Common gotchas

- **The adapter — not the caller — owns the ERC-8004 NFT.** `registry.ownerOf(agentId)` returns the adapter address by design. Use `adapter.isController(agentId, account)` to check control.
- **`getAgentWallet(agentId)` is `0x0` immediately after registration** — the adapter calls `unsetAgentWallet` during register. To set an agent-signer wallet later, the controller submits an EIP-712 / ERC-1271 signature where the typed-data `owner` field is the **adapter proxy address**, not the Normie holder.
- **The on-chain `agent-binding` metadata is just the 20-byte adapter address**, not the full encoded `(adapter, standard, tokenContract, tokenIdLen, tokenId)` blob described in the adapter's README. Readers find the adapter from those 20 bytes, then call `bindingOf(agentId)` for the canonical record. ERC draft #1648 (`agent-binding` key) is what's actually deployed.
- **One Normie can mint multiple agentIds** — the adapter README explicitly allows it. If the indexer shows a prior binding for the same tokenId, the new register tx will still succeed and produce a fresh agentId; the older agentId still exists but its controller is now whoever currently holds the Normie (control transferred with the NFT).
- **`tokenURI` is the right getter on the registry**, not `agentURI` (no such function). Same for `getAgentWallet` not `agentWallet`.

## Quick reference: full awaken from scratch

```sh
# 1. Ensure ~/.axiom/wallet.env has NET_PRIVATE_KEY
# 2. From the skill directory
cd scripts && npm install && cd ..

# 3. Watch for the incoming Normie (background)
nohup node scripts/watch.mjs mainnet > watch.log 2>&1 &

# 4. Once the watcher logs a tokenId, dry-run
node scripts/awaken.mjs <tokenId>

# 5. Confirm calldata + gas with the user, then broadcast
node scripts/awaken.mjs <tokenId> --send

# 6. Verify
node scripts/awaken.mjs --verify <agentId>
```

## References

- Adapter source: https://github.com/nxt3d/adapter
- Adapter site: https://adapter8004.xyz
- ERC-8004 draft: https://eips.ethereum.org/EIPS/eip-8004
- ERC #1648 (agent-binding): https://github.com/ethereum/ERCs/pull/1648
- Normies API: https://api.normies.art/llms.txt
- A2A spec: https://a2aproject.github.io/A2A/
