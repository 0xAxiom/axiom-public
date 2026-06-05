---
name: abi-encoder
version: 1.0.0
description: Encode EVM function calls and constructor args from signature + values. Zero deps.
tags: [evm, abi, encoding, solidity, base]
author: Axiom
---

# abi-encoder

Encode EVM calldata from a function signature and argument values. The complement to `calldata-decoder`.

## Usage

```bash
# Encode a function call
node encode.mjs "transfer(address,uint256)" 0xRecipient 1000000000000000000

# Encode constructor args (no selector)
node encode.mjs --constructor "(uint256,string,address)" 100 "MyToken" 0xOwner

# Raw abi.encode (no selector)
node encode.mjs --raw "(address,uint256)" 0xAbC 500
```

## Supported Types

address, bool, uint8–uint256, int8–int256, bytes1–bytes32, bytes, string, fixed arrays T[N], dynamic arrays T[], tuples (T1,T2,...).

## Dependencies

None. Pure Node.js with a built-in keccak256 implementation.
