# proxy-detector

Detect proxy contracts and reveal their implementation address. Zero dependencies.

Checks six proxy patterns in order:
1. **EIP-1967** implementation slot (TransparentProxy, UUPS)
2. **EIP-1967** beacon slot (BeaconProxy)
3. **EIP-1822** UUPS slot (older standard)
4. **EIP-897** `implementation()` function (DelegateProxy)
5. `getImplementation()` function (some OpenZeppelin proxies)
6. **EIP-1167** minimal proxy (clone) bytecode pattern

Distinguishes UUPS from Transparent by checking `proxiableUUID()` on the implementation. Also reads admin and beacon addresses when present.

## Usage

```bash
# Base (default)
node proxy-detector.mjs 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913

# Other chains
node proxy-detector.mjs 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48 --chain ethereum

# JSON output
node proxy-detector.mjs 0x1234...abcd --json
```

## Supported chains

Base, Ethereum, Arbitrum, Optimism.
