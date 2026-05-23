# Common EVM Event Topic0 Hashes

These are the keccak256 signatures of common Solidity events.
Use these as the `topics[0]` filter in `eth_getLogs` calls.

## ERC-20

| Event | Topic0 |
|-------|--------|
| Transfer(address,address,uint256) | `0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef` |
| Approval(address,address,uint256) | `0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925` |

## ERC-721 (NFT)

| Event | Topic0 |
|-------|--------|
| Transfer(address,address,uint256) | `0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef` |
| Approval(address,address,uint256) | `0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925` |
| ApprovalForAll(address,address,bool) | `0x17307eab39ab6107e8899845ad3d59bd9653f200f220920489ca2b5937696c31` |

## ERC-1155

| Event | Topic0 |
|-------|--------|
| TransferSingle(address,address,address,uint256,uint256) | `0xc3d58168c5ae7397731d063d5bbf3d657854427343f4c083240f7aacaa2d0f62` |
| TransferBatch(address,address,address,uint256[],uint256[]) | `0x4a39dc06d4c0dbc64b70af90fd698a233a518aa5d07e595d983b8c0526c8f7fb` |
| ApprovalForAll(address,address,bool) | `0x17307eab39ab6107e8899845ad3d59bd9653f200f220920489ca2b5937696c31` |

## Uniswap V2

| Event | Topic0 |
|-------|--------|
| Swap(address,uint256,uint256,uint256,uint256,address) | `0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822` |
| Mint(address,uint256,uint256) | `0x4c209b5fc8ad50758f13e2e1088ba56a560dff690a1c6fef26394f4c03821c4f` |
| Burn(address,uint256,uint256,address) | `0xdccd412f0b1252819cb1fd330b93224ca42612892bb3f4f789976e6d81936496` |
| Sync(uint112,uint112) | `0x1c411e9a96e071241c2f21f7726b17ae89e3cab4c78be50e062b03a9fffbbad1` |

## Uniswap V3

| Event | Topic0 |
|-------|--------|
| Swap(address,address,int256,int256,uint160,uint128,int24) | `0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67` |
| Mint(address,address,int24,int24,uint128,uint256,uint256) | `0x7a53080ba414158be7ec69b987b5fb7d07dee101fe85488f0853ae16239d0bde` |
| Burn(address,int24,int24,uint128,uint256,uint256) | `0x0c396cd989a39f4459b5fa1aed6a9a8dcdbc45908acfd67e028cd568da98982c` |
| Collect(address,address,int24,int24,uint128,uint128) | `0x70935338e69775456a85ddef226c395fb668b63fa0115f5f20610b388e6ca9c0` |

## Gnosis Safe

| Event | Topic0 |
|-------|--------|
| ExecutionSuccess(bytes32,uint256) | `0x442e715f626346e8c54381002da614f62bee8d27386535b2521ec8540898556e` |
| ExecutionFailure(bytes32,uint256) | `0x23428b18acfb3ea64b08dc0c1d296ea9c09702890375386c1e60a6f2e4bfaa95` |
| ApproveHash(bytes32,address) | `0xf2a0eb156472d1440255b0d7c1e19cc07115d1051fe605b0dce69acfec884d9c` |
| SignMsg(bytes32) | `0xe7f4675038f4f6034dfcbbb41114691b0b action 0x2b607f` |

## Chainlink (Price Feeds)

| Event | Topic0 |
|-------|--------|
| AnswerUpdated(int256,uint256,uint256) | `0x0559884fd3a460db3073b7fc896cc77986f16e378210ded43186175bf646fc5f` |

## OpenZeppelin Access Control

| Event | Topic0 |
|-------|--------|
| RoleGranted(bytes32,address,address) | `0x2f8788117e7eff1d82e926ec794901d17c78024a50270940304540a733656f0d` |
| RoleRevoked(bytes32,address,address) | `0xf6391f5c32d9c69d2a47ea670b442974b53935d1edc7fd64eb21e047a839171b` |
| OwnershipTransferred(address,address) | `0x8be0079c531659141344cd1fd0a4f28419497f9722a3daafe3b4186f6b6457e0` |

## WETH

| Event | Topic0 |
|-------|--------|
| Deposit(address,uint256) | `0xe1fffcc4923d04b559f4d29a8bfc6cda04eb5b0d3c460751c2402c5c5cc9109c` |
| Withdrawal(address,uint256) | `0x7fcf532c15f0a6db0bd6d0e038bea71d30d808c7d98cb3bf7268a95bf5081b65` |

---

## How to use with decode-event.js

```js
const { decodeEvent } = require('./decode-event');

const TRANSFER_ABI = {
  name: 'Transfer',
  inputs: [
    { name: 'from',  type: 'address', indexed: true },
    { name: 'to',    type: 'address', indexed: true },
    { name: 'value', type: 'uint256', indexed: false },
  ]
};

// rawLog from eth_getLogs
const decoded = decodeEvent(TRANSFER_ABI, rawLog);
console.log(decoded.params.from, '->', decoded.params.to, decoded.params.value);
```
