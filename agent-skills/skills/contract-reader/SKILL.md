# contract-reader

Read any EVM smart contract view function via raw JSON-RPC. Zero dependencies. Pure Node.js 18+. Works on any EVM chain — no ethers.js, no viem, no API key.

Agents interact with onchain state constantly: check token balances before trading, read oracle prices before alerting, verify contract ownership before executing. Every major library adds megabytes of dependencies. This does the same thing with `fetch`.

## When to use

- Check if an account holds enough tokens before executing a trade
- Read live oracle prices directly from a Chainlink feed
- Verify contract ownership or admin address
- Get Uniswap V2 pair reserves to calculate price
- Read any ERC-20/ERC-721/ERC-4626 standard function
- Inspect raw storage slots when debugging proxy contracts
- Query vault TVL or liquidity before entering a position
- Any read-only onchain query where you want zero deps

## Triggers

Use this skill when someone says: "read contract", "call view function", "check token balance", "get ERC-20 info", "call onchain", "read from blockchain", "eth_call", "query smart contract", "check contract state", "read storage slot", "get token price from contract", "contract reader", "zero dependency eth call"

## Scripts

```
scripts/
└── contract-reader.mjs   — single script, all commands
```

## Quick start

```bash
# Native ETH balance on Base
node scripts/contract-reader.mjs balance 0xYourAddress 8453

# ERC-20 token info
node scripts/contract-reader.mjs erc20 0xTokenAddress 8453

# ERC-20 balance for a wallet
node scripts/contract-reader.mjs erc20 0xTokenAddress 0xWalletAddress 8453

# Call by built-in function name
node scripts/contract-reader.mjs call 0xContract totalSupply --chain 8453

# Call with a hex selector (any function)
node scripts/contract-reader.mjs call 0xContract 0x70a08231 0xWallet --out uint256 --chain 8453

# Read Uniswap V2 reserves
node scripts/contract-reader.mjs call 0xPair getReserves --chain 8453

# Read Chainlink price feed
node scripts/contract-reader.mjs call 0xFeed latestRoundData --chain 1

# Read storage slot 0
node scripts/contract-reader.mjs slot 0xContract 0 8453

# Current block number
node scripts/contract-reader.mjs block 8453

# List all built-in selectors
node scripts/contract-reader.mjs selectors
```

## Built-in functions

30+ pre-loaded selectors — no need to compute them:

| Category | Functions |
|----------|-----------|
| ERC-20 | `name`, `symbol`, `decimals`, `totalSupply`, `balanceOf`, `allowance` |
| ERC-721 | `ownerOf`, `tokenURI` |
| Ownership | `owner`, `getOwner`, `pendingOwner`, `admin` |
| Pausable | `paused` |
| Uniswap V2 | `token0`, `token1`, `factory`, `getReserves`, `price0CumulativeLast` |
| Uniswap V3 | `liquidity`, `slot0`, `fee` |
| ERC-4626 | `totalAssets`, `convertToShares`, `convertToAssets`, `asset` |
| Chainlink | `latestAnswer`, `latestRoundData`, `description` |
| Proxy | `implementation` |
| Misc | `cap`, `nonces`, `DOMAIN_SEPARATOR`, `version` |

For any other function: find the 4-byte selector with `cast sig "fn(type1,type2)"` (Foundry) or at https://sig.eth.samczsun.com/, then pass it directly.

## Commands

### `balance`

```
node contract-reader.mjs balance <address> [chainId]
```

Returns native token balance (ETH, MATIC, etc) as wei and decimal.

### `erc20`

```
node contract-reader.mjs erc20 <tokenAddress> [walletAddress] [chainId]
```

Returns `{ name, symbol, decimals, totalSupply, balance }`. All calls are parallelized. Gracefully handles non-standard tokens.

### `call`

```
node contract-reader.mjs call <contract> <selector|funcName> [args...] [--out types] [--chain chainId]
```

Call any read-only function. Args are auto-typed (addresses and integers detected automatically) or typed explicitly: `address:0x...`, `uint256:123`.

`--out` accepts comma-separated types: `address`, `uint256`, `int256`, `bool`, `string`, `bytes32`. Built-in functions already know their output types.

### `slot`

```
node contract-reader.mjs slot <contract> <slot> [chainId]
```

Reads raw 32-byte storage slot. Useful for inspecting proxy implementation pointers (EIP-1967 slot: `0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc`).

### `block`

```
node contract-reader.mjs block [chainId]
```

Returns current block number and timestamp.

## Output format

All commands output JSON to stdout — pipe into `jq` or use in scripts:

```bash
# Get USDC decimals
node contract-reader.mjs call 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 decimals --chain 8453 | jq .decoded

# Get reserves and extract reserve0
node contract-reader.mjs call 0xPair getReserves --chain 8453 | jq '.decoded[0]'

# Check if contract is paused
node contract-reader.mjs call 0xContract paused --chain 8453 | jq '.decoded'
```

## ENV vars

| Var | Default | Description |
|-----|---------|-------------|
| `RPC_URL` | public endpoint | Override the RPC for any chain |
| `CHAIN_ID` | `8453` | Default chain when none specified |

## Supported chains

| Chain ID | Network |
|----------|---------|
| 1 | Ethereum Mainnet |
| 8453 | Base |
| 42161 | Arbitrum One |
| 10 | Optimism |
| 137 | Polygon |
| 56 | BNB Chain |
| 100 | Gnosis |
| 43114 | Avalanche C-Chain |
| 11155111 | Sepolia |
| 84532 | Base Sepolia |
| 421614 | Arbitrum Sepolia |

Set `RPC_URL` for any other chain.

## Notes

- Uses public free RPCs by default — for production agents, set `RPC_URL` to a dedicated endpoint (Alchemy, Infura, QuickNode)
- `eth_call` is read-only and free — no gas, no signing, no wallet required
- Complex return types (nested tuples, dynamic arrays) return raw hex — decode manually or open a PR to add support
- ABI encoding supports: `address`, `uint8`–`uint256`, `int8`–`int256`, `bool`, `bytes32`
