# Basename Resolver

Resolve Basenames (.base.eth) on Base. Forward resolve names to addresses, reverse resolve addresses to names, and read text records. Zero dependencies.

## Quick Start

```bash
# Name → address
node scripts/resolve.mjs jesse.base.eth
# 0x2211d1d0020daea8039e46cf1367962070d77da9

# Short form (auto-appends .base.eth)
node scripts/resolve.mjs jesse

# Address → name (reverse resolution)
node scripts/resolve.mjs -r 0x2211d1d0020daea8039e46cf1367962070d77da9

# Read text records
node scripts/resolve.mjs -t com.twitter jesse    # → jessepollak
node scripts/resolve.mjs -t url jesse            # → jesse.xyz
node scripts/resolve.mjs -t avatar jesse          # → avatar URL

# JSON output
node scripts/resolve.mjs --json jesse
# {"name":"jesse","address":"0x2211d1d0020daea8039e46cf1367962070d77da9"}
```

## How It Works

Uses the Base universal resolver (`0xC6d5...BCD`) with keccak-256 namehashes computed via the `web3_sha3` RPC method — no crypto dependencies needed.

Supports:
- `addr(bytes32)` — forward resolution
- `name(bytes32)` — reverse resolution
- `text(bytes32, string)` — text record lookup (avatar, url, com.twitter, com.github, etc.)

## Environment

| Variable | Default | Description |
|----------|---------|-------------|
| `BASE_RPC_URL` | `https://mainnet.base.org` | Base RPC endpoint |

## Text Record Keys

Common keys set on Basenames:
- `com.twitter` — Twitter/X handle
- `com.github` — GitHub username
- `url` — Website URL
- `avatar` — Profile image URL
- `description` — Bio text
- `com.discord` — Discord handle
