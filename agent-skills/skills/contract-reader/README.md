# contract-reader

Read any EVM smart contract view function via raw JSON-RPC. Zero dependencies. Pure Node.js 18+.

No ethers.js. No viem. No API key. Just `fetch`.

## Install

```bash
cp -r contract-reader ~/.openclaw/skills/
```

## Usage

```bash
# Native balance
node scripts/contract-reader.mjs balance 0xYourAddress 8453

# ERC-20 info + wallet balance
node scripts/contract-reader.mjs erc20 0xTokenAddress 0xWallet 8453

# Call by built-in name
node scripts/contract-reader.mjs call 0xContract totalSupply --chain 8453

# Call any function with hex selector
node scripts/contract-reader.mjs call 0xContract 0x70a08231 0xWallet --out uint256 --chain 8453

# Uniswap V2 reserves
node scripts/contract-reader.mjs call 0xPair getReserves --chain 8453

# Storage slot
node scripts/contract-reader.mjs slot 0xContract 0 8453

# Current block
node scripts/contract-reader.mjs block 8453
```

## Built-in selectors

```
node scripts/contract-reader.mjs selectors
```

Covers ERC-20, ERC-721, ERC-4626, Uniswap V2/V3, Chainlink price feeds, Ownable, and more.

## Custom functions

Get the 4-byte selector with Foundry:
```bash
cast sig "myFunction(address,uint256)"
```
Or use https://sig.eth.samczsun.com/

Then pass it directly:
```bash
node scripts/contract-reader.mjs call 0xContract 0xabcd1234 arg1 --out uint256 --chain 8453
```

## ENV vars

- `RPC_URL` — override RPC endpoint
- `CHAIN_ID` — default chain (default: `8453` Base)

---

Part of [axiom-public](https://github.com/0xAxiom/axiom-public) · MIT License
