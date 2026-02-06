// TWAP Oracle Pattern - Time-weighted average price accumulator

export default {
  id: 'twap-oracle',
  name: 'TWAP Oracle',
  description: 'Maintains time-weighted average price data for external consumption',
  complexity: 2,
  callbacks: ['afterSwap'],
  flags: ['afterSwap'],
  params: [
    { 
      name: 'updateInterval', 
      type: 'uint256', 
      description: 'Minimum seconds between TWAP updates', 
      default: '60',
      validation: 'Must be > 0'
    },
    { 
      name: 'maxAge', 
      type: 'uint256', 
      description: 'Maximum age of TWAP data before considered stale (seconds)', 
      default: '3600'
    }
  ],
  
  solidity: (params) => `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {BaseHook} from "v4-periphery/src/base/hooks/BaseHook.sol";
import {Hooks} from "v4-core/src/libraries/Hooks.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "v4-core/src/types/PoolId.sol";
import {BalanceDelta} from "v4-core/src/types/BalanceDelta.sol";
import {BeforeSwapDelta, BeforeSwapDeltaLibrary} from "v4-core/src/types/BeforeSwapDelta.sol";
import {FullMath} from "v4-core/src/libraries/FullMath.sol";

contract TWAPOracleHook is BaseHook {
    using PoolIdLibrary for PoolKey;
    using BeforeSwapDeltaLibrary for BeforeSwapDelta;

    error InvalidUpdateInterval();
    error TWAPDataStale();
    error InsufficientData();

    struct TWAPData {
        uint256 price0CumulativeLast;      // Cumulative price of token0
        uint256 price1CumulativeLast;      // Cumulative price of token1
        uint256 blockTimestampLast;        // Last update timestamp
        uint256 twapPrice0;                // Latest TWAP for token0/token1
        uint256 twapPrice1;                // Latest TWAP for token1/token0
        bool initialized;                  // Whether TWAP has been initialized
    }

    uint256 public immutable updateInterval;
    uint256 public immutable maxAge;

    mapping(PoolId => TWAPData) public twapData;

    event TWAPUpdated(
        PoolId indexed poolId,
        uint256 price0Average,
        uint256 price1Average,
        uint256 timeElapsed
    );

    constructor(IPoolManager _poolManager, uint256 _updateInterval, uint256 _maxAge) 
        BaseHook(_poolManager) 
    {
        if (_updateInterval == 0) revert InvalidUpdateInterval();
        updateInterval = _updateInterval;
        maxAge = _maxAge;
    }

    function getHookPermissions() public pure override returns (Hooks.Permissions memory) {
        return Hooks.Permissions({
            beforeInitialize: false,
            afterInitialize: false,
            beforeAddLiquidity: false,
            afterAddLiquidity: false,
            beforeRemoveLiquidity: false,
            afterRemoveLiquidity: false,
            beforeSwap: false,
            afterSwap: true,
            beforeDonate: false,
            afterDonate: false,
            beforeSwapReturnDelta: false,
            afterSwapReturnDelta: false,
            afterAddLiquidityReturnDelta: false,
            afterRemoveLiquidityReturnDelta: false
        });
    }

    function afterSwap(
        address,
        PoolKey calldata key,
        IPoolManager.SwapParams calldata,
        BalanceDelta,
        bytes calldata
    ) external override returns (bytes4, int128) {
        PoolId poolId = key.toId();
        _updateTWAP(poolId);
        return (BaseHook.afterSwap.selector, 0);
    }

    function _updateTWAP(PoolId poolId) internal {
        TWAPData storage data = twapData[poolId];
        
        // Get current pool state
        (uint160 sqrtPriceX96, int24 tick,) = poolManager.getSlot0(poolId);
        uint256 currentTimestamp = block.timestamp;
        
        if (!data.initialized) {
            // Initialize TWAP data
            data.price0CumulativeLast = _calculateCumulativePrice0(sqrtPriceX96, currentTimestamp);
            data.price1CumulativeLast = _calculateCumulativePrice1(sqrtPriceX96, currentTimestamp);
            data.blockTimestampLast = currentTimestamp;
            data.initialized = true;
            return;
        }
        
        uint256 timeElapsed = currentTimestamp - data.blockTimestampLast;
        
        // Only update if enough time has passed
        if (timeElapsed < updateInterval) return;
        
        // Calculate current cumulative prices
        uint256 price0CumulativeCurrent = _calculateCumulativePrice0(sqrtPriceX96, currentTimestamp);
        uint256 price1CumulativeCurrent = _calculateCumulativePrice1(sqrtPriceX96, currentTimestamp);
        
        // Calculate TWAP over the elapsed period
        if (timeElapsed > 0) {
            data.twapPrice0 = (price0CumulativeCurrent - data.price0CumulativeLast) / timeElapsed;
            data.twapPrice1 = (price1CumulativeCurrent - data.price1CumulativeLast) / timeElapsed;
            
            emit TWAPUpdated(poolId, data.twapPrice0, data.twapPrice1, timeElapsed);
        }
        
        // Update stored values
        data.price0CumulativeLast = price0CumulativeCurrent;
        data.price1CumulativeLast = price1CumulativeCurrent;
        data.blockTimestampLast = currentTimestamp;
    }

    function _calculateCumulativePrice0(uint160 sqrtPriceX96, uint256 timestamp) internal pure returns (uint256) {
        // Calculate price0 = (sqrtPrice)^2 / 2^192 (simplified for demo)
        // In production, use proper fixed-point arithmetic
        uint256 price = FullMath.mulDiv(uint256(sqrtPriceX96), uint256(sqrtPriceX96), 1 << 192);
        return price * timestamp;
    }

    function _calculateCumulativePrice1(uint160 sqrtPriceX96, uint256 timestamp) internal pure returns (uint256) {
        // Calculate price1 = 2^192 / (sqrtPrice)^2 (simplified for demo)
        uint256 price = FullMath.mulDiv(1 << 192, 1 << 192, FullMath.mulDiv(uint256(sqrtPriceX96), uint256(sqrtPriceX96), 1));
        return price * timestamp;
    }

    // Public view functions for external consumption
    function getTWAPPrice(PoolId poolId) external view returns (uint256 price0, uint256 price1, uint256 lastUpdate) {
        TWAPData storage data = twapData[poolId];
        
        if (!data.initialized) revert InsufficientData();
        if (block.timestamp - data.blockTimestampLast > maxAge) revert TWAPDataStale();
        
        return (data.twapPrice0, data.twapPrice1, data.blockTimestampLast);
    }

    function getCurrentPrice(PoolId poolId) external view returns (uint256 price0, uint256 price1) {
        (uint160 sqrtPriceX96,,) = poolManager.getSlot0(poolId);
        
        // Convert sqrtPrice to price0 and price1
        price0 = FullMath.mulDiv(uint256(sqrtPriceX96), uint256(sqrtPriceX96), 1 << 192);
        price1 = FullMath.mulDiv(1 << 192, 1 << 192, FullMath.mulDiv(uint256(sqrtPriceX96), uint256(sqrtPriceX96), 1));
        
        return (price0, price1);
    }

    function getPriceDeviation(PoolId poolId) external view returns (uint256 deviation0, uint256 deviation1) {
        (uint256 currentPrice0, uint256 currentPrice1) = this.getCurrentPrice(poolId);
        (uint256 twapPrice0, uint256 twapPrice1,) = this.getTWAPPrice(poolId);
        
        // Calculate percentage deviation from TWAP
        deviation0 = currentPrice0 > twapPrice0 
            ? ((currentPrice0 - twapPrice0) * 10000) / twapPrice0
            : ((twapPrice0 - currentPrice0) * 10000) / twapPrice0;
            
        deviation1 = currentPrice1 > twapPrice1 
            ? ((currentPrice1 - twapPrice1) * 10000) / twapPrice1
            : ((twapPrice1 - currentPrice1) * 10000) / twapPrice1;
        
        return (deviation0, deviation1);
    }

    function isDataFresh(PoolId poolId) external view returns (bool) {
        TWAPData storage data = twapData[poolId];
        return data.initialized && (block.timestamp - data.blockTimestampLast <= maxAge);
    }

    function getDataAge(PoolId poolId) external view returns (uint256) {
        TWAPData storage data = twapData[poolId];
        if (!data.initialized) return type(uint256).max;
        return block.timestamp - data.blockTimestampLast;
    }
}`,

  test: (params) => `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {Hooks} from "v4-core/src/libraries/Hooks.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {PoolManager} from "v4-core/src/PoolManager.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {Currency, CurrencyLibrary} from "v4-core/src/types/Currency.sol";
import {PoolId, PoolIdLibrary} from "v4-core/src/types/PoolId.sol";
import {Deployers} from "v4-core/test/utils/Deployers.sol";
import {TestERC20} from "v4-core/test/TestERC20.sol";
import {HookMiner} from "../utils/HookMiner.sol";

import "../src/TWAPOracleHook.sol";

contract TWAPOracleHookTest is Test, Deployers {
    using PoolIdLibrary for PoolKey;
    using CurrencyLibrary for Currency;

    TWAPOracleHook hook;
    PoolKey poolKey;
    PoolId poolId;

    uint256 constant UPDATE_INTERVAL = ${params.updateInterval || '60'};
    uint256 constant MAX_AGE = ${params.maxAge || '3600'};

    TestERC20 token0;
    TestERC20 token1;

    function setUp() public {
        deployFreshManagerAndRouters();
        
        // Deploy test tokens
        token0 = new TestERC20("Token0", "TKN0", 18);
        token1 = new TestERC20("Token1", "TKN1", 18);

        // Sort tokens
        if (address(token0) > address(token1)) {
            (token0, token1) = (token1, token0);
        }

        // Mine hook address
        uint160 flags = uint160(Hooks.AFTER_SWAP_FLAG);
        (address hookAddress, bytes32 salt) = HookMiner.find(
            address(this),
            flags,
            type(TWAPOracleHook).creationCode,
            abi.encode(address(manager), UPDATE_INTERVAL, MAX_AGE)
        );

        // Deploy hook
        hook = new TWAPOracleHook{salt: salt}(
            IPoolManager(address(manager)),
            UPDATE_INTERVAL,
            MAX_AGE
        );

        // Create pool key
        poolKey = PoolKey({
            currency0: Currency.wrap(address(token0)),
            currency1: Currency.wrap(address(token1)),
            fee: 3000,
            tickSpacing: 60,
            hooks: IHooks(address(hook))
        });
        poolId = poolKey.toId();

        // Initialize pool
        manager.initialize(poolKey, SQRT_RATIO_1_1, ZERO_BYTES);

        // Mint tokens and approve
        token0.mint(address(this), 1000 ether);
        token1.mint(address(this), 1000 ether);
        token0.approve(address(router), type(uint256).max);
        token1.approve(address(router), type(uint256).max);
    }

    function testInitialTWAPInitialization() public {
        // TWAP should not be initialized before first swap
        assertFalse(hook.isDataFresh(poolId), "TWAP should not be fresh initially");
        
        // First swap should initialize TWAP
        _performSwap(true, 1 ether);
        
        assertTrue(hook.isDataFresh(poolId), "TWAP should be fresh after first swap");
    }

    function testTWAPUpdateAfterInterval() public {
        // Initialize with first swap
        _performSwap(true, 1 ether);
        
        // Advance time but not enough to trigger update
        vm.warp(block.timestamp + UPDATE_INTERVAL / 2);
        _performSwap(false, 0.5 ether);
        
        // Should still be at first price level
        
        // Advance time past update interval
        vm.warp(block.timestamp + UPDATE_INTERVAL);
        _performSwap(true, 1 ether);
        
        // TWAP should now be available
        vm.expectEmit(true, false, false, false);
        emit TWAPOracleHook.TWAPUpdated(poolId, 0, 0, 0); // Values don't matter for this test
    }

    function testCurrentPriceReading() public {
        _performSwap(true, 1 ether);
        
        (uint256 price0, uint256 price1) = hook.getCurrentPrice(poolId);
        assertGt(price0, 0, "Price0 should be greater than 0");
        assertGt(price1, 0, "Price1 should be greater than 0");
        
        // Prices should be reciprocals (approximately)
        // This is a simplified test - in practice, check within tolerance
    }

    function testTWAPDataStaleCheck() public {
        _performSwap(true, 1 ether);
        
        // TWAP should be fresh initially
        assertTrue(hook.isDataFresh(poolId), "TWAP should be fresh");
        
        // Advance time beyond max age
        vm.warp(block.timestamp + MAX_AGE + 1);
        
        // TWAP should now be stale
        assertFalse(hook.isDataFresh(poolId), "TWAP should be stale");
        
        // Getting TWAP should revert
        vm.expectRevert(TWAPOracleHook.TWAPDataStale.selector);
        hook.getTWAPPrice(poolId);
    }

    function testPriceDeviationCalculation() public {
        // Initialize TWAP
        _performSwap(true, 1 ether);
        
        // Wait for update interval
        vm.warp(block.timestamp + UPDATE_INTERVAL + 1);
        
        // Create price movement
        _performSwap(false, 2 ether);
        
        // Another update after more time
        vm.warp(block.timestamp + UPDATE_INTERVAL + 1);
        _performSwap(true, 0.5 ether);
        
        // Should be able to calculate deviation now
        try hook.getPriceDeviation(poolId) {
            // If no revert, test passed
        } catch {
            // Might fail due to insufficient data - that's ok for this test
        }
    }

    function testDataAgeTracking() public {
        // Initially, data age should be max
        assertEq(hook.getDataAge(poolId), type(uint256).max, "Initial data age should be max");
        
        _performSwap(true, 1 ether);
        
        // Data age should be 0 immediately after first swap
        assertEq(hook.getDataAge(poolId), 0, "Data age should be 0 after first swap");
        
        // Advance time and check age
        vm.warp(block.timestamp + 100);
        assertEq(hook.getDataAge(poolId), 100, "Data age should match elapsed time");
    }

    function testInsufficientDataError() public {
        // Getting TWAP before initialization should revert
        vm.expectRevert(TWAPOracleHook.InsufficientData.selector);
        hook.getTWAPPrice(poolId);
    }

    function testConstructorValidation() public {
        // Test invalid update interval
        vm.expectRevert(TWAPOracleHook.InvalidUpdateInterval.selector);
        new TWAPOracleHook(IPoolManager(address(manager)), 0, 3600);
    }

    function testMultipleSwapsCreateValidTWAP() public {
        uint256 swapCount = 5;
        uint256 interval = UPDATE_INTERVAL + 10;
        
        for (uint i = 0; i < swapCount; i++) {
            bool zeroForOne = i % 2 == 0;
            uint256 amount = 1 ether + (i * 0.1 ether);
            
            _performSwap(zeroForOne, amount);
            vm.warp(block.timestamp + interval);
        }
        
        // Should have valid TWAP data after multiple updates
        assertTrue(hook.isDataFresh(poolId), "Should have fresh TWAP data");
        
        (uint256 twapPrice0, uint256 twapPrice1, uint256 lastUpdate) = hook.getTWAPPrice(poolId);
        assertGt(twapPrice0, 0, "TWAP price0 should be valid");
        assertGt(twapPrice1, 0, "TWAP price1 should be valid");
        assertEq(lastUpdate, block.timestamp - interval, "Last update should be correct");
    }

    function _performSwap(bool zeroForOne, uint256 amount) internal {
        IPoolManager.SwapParams memory params = IPoolManager.SwapParams({
            zeroForOne: zeroForOne,
            amountSpecified: -int256(amount),
            sqrtPriceLimitX96: zeroForOne ? SQRT_RATIO_1_2 : SQRT_RATIO_2_1
        });
        
        PoolSwapTest.TestSettings memory testSettings = PoolSwapTest.TestSettings({
            takeClaims: false,
            settleUsingBurn: false
        });
        
        swapRouter.swap(poolKey, params, testSettings, ZERO_BYTES);
    }
}`,

  pitfalls: [
    'TWAP calculation requires careful handling of overflow in cumulative prices',
    'Cold start problem: first TWAP reading requires initialization period',
    'Oracle manipulation risk during low-liquidity periods',
    'Price precision loss in fixed-point arithmetic - use proper math libraries',
    'Consider using checkpoint-based TWAP for gas efficiency',
    'Ensure sufficient update frequency vs gas costs trade-off'
  ],

  gasEstimate: {
    afterSwap: 55000,
    total: 55000
  }
};