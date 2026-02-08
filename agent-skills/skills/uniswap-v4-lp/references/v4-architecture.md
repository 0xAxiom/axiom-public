# Uniswap V4 Core Architecture

## Singleton Pattern

V4 uses a singleton-style architecture where **all pool state is managed in `PoolManager.sol`**. This is fundamentally different from V3 where each pool was its own contract.

## Unlock/Callback Pattern

Pool actions require an initial call to `unlock()`. Integrators must implement `unlockCallback`:

```solidity
import {IPoolManager} from 'v4-core/contracts/interfaces/IPoolManager.sol';
import {IUnlockCallback} from 'v4-core/contracts/interfaces/callback/IUnlockCallback.sol';

contract MyContract is IUnlockCallback {
    IPoolManager poolManager;

    function doSomethingWithPools() {
        poolManager.unlock(...);  // This calls unlockCallback below
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert Unauthorized();
        
        // Perform pool actions here
        poolManager.swap(...)
        poolManager.modifyLiquidity(...)
    }
}
```

## Available Actions (inside unlock)

| Action | Description |
|--------|-------------|
| `swap` | Execute a swap |
| `modifyLiquidity` | Add or remove liquidity |
| `donate` | Donate tokens to LPs |
| `take` | Take tokens out of the pool |
| `settle` | Settle debt to the pool |
| `mint` | Mint claim tokens (ERC-6909) |
| `burn` | Burn claim tokens |

**Note:** Pool initialization happens *outside* unlock context.

## Delta Tracking

Only **net balances** are tracked during an unlock:
- Positive delta = pool owes user tokens
- Negative delta = user owes pool tokens

**Critical:** All deltas must reach 0 by the end of unlock, or the transaction reverts.

This enables flexible multi-action transactions (e.g., flash accounting, complex swaps).

## Hooks

Pools can be initialized with hook contracts that implement callbacks:

| Hook | When Called |
|------|-------------|
| `beforeInitialize` / `afterInitialize` | Pool creation |
| `beforeAddLiquidity` / `afterAddLiquidity` | LP deposits |
| `beforeRemoveLiquidity` / `afterRemoveLiquidity` | LP withdrawals |
| `beforeSwap` / `afterSwap` | Trades |
| `beforeDonate` / `afterDonate` | Donations |

**Important:** Which callbacks execute is fixed at pool initialization. The hook *logic* can change, but not which hooks are active.

## Repository Structure

```
v4-core/
├── src/
│   ├── interfaces/
│   │   ├── IPoolManager.sol
│   │   └── ...
│   ├── libraries/
│   │   ├── Position.sol
│   │   ├── Pool.sol
│   │   └── ...
│   ├── test/           # Test helpers
│   └── PoolManager.sol
└── test/
    └── libraries/
        ├── Position.t.sol
        └── Pool.t.sol
```

## Integration

```bash
forge install https://github.com/Uniswap/v4-core
```

```solidity
import {IPoolManager} from 'v4-core/contracts/interfaces/IPoolManager.sol';
import {IUnlockCallback} from 'v4-core/contracts/interfaces/callback/IUnlockCallback.sol';
```

## Why PositionManager Exists

The PositionManager (periphery) abstracts away the unlock/callback pattern:
- Handles delta settlement automatically
- Manages position NFTs
- Provides simpler `modifyLiquidities()` interface

When you call `modifyLiquidities(unlockData, deadline)`:
1. PositionManager calls `poolManager.unlock(unlockData)`
2. PoolManager calls back to PositionManager
3. PositionManager decodes actions and executes them
4. Deltas are settled via `settle` and `take`
5. NFT minted/updated if needed

## Key Contracts (Base)

| Contract | Address |
|----------|---------|
| PoolManager | `0x498581ff718922c3f8e6a244956af099b2652b2b` |
| PositionManager | `0x7c5f5a4bbd8fd63184577525326123b519429bdc` |
| StateView | `0xa3c0c9b65bad0b08107aa264b0f3db444b867a71` |
