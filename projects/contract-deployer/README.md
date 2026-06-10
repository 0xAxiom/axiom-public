# contract-deployer

Find who deployed any contract and when — via binary search.

Given a contract address, binary-searches the blockchain to locate the exact block where the contract was created, then pulls the deployer address, transaction hash, timestamp, and bytecode size.

Zero dependencies. Raw JSON-RPC only.

## Usage

```bash
# Base mainnet (default)
node find-deployer.mjs 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913

# Ethereum mainnet
node find-deployer.mjs 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48 --rpc https://eth.llamarpc.com

# JSON output
node find-deployer.mjs 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 --json
```

## Output

```
─── Contract Deploy Info ───
Address:      0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
Deploy Block: 2177524
Timestamp:    2023-09-05T13:42:07.000Z
Deployer:     0x3304...
Deploy Tx:    0xabc123...
Bytecode:     8192 bytes (8.00 KB)
```

## How it works

1. Verifies the address has code at the latest block
2. Binary-searches block range to find the first block where code exists (~25 RPC calls for any chain)
3. Scans that block's transactions for the creation tx (direct CREATE or factory CREATE2)
4. Reports deployer, tx hash, timestamp, and bytecode size

## Limitations

- Internal CREATE2 deploys (factory patterns) may not resolve the deployer without trace APIs
- Genesis-deployed contracts are detected but won't have a creation tx
