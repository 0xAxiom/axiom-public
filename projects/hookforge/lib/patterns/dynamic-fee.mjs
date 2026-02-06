// Dynamic Fee Pattern - Volatility-based fee adjustment

export default {
  id: 'dynamic-fee',
  name: 'Dynamic Fee',
  description: 'Adjusts swap fees based on price volatility and market conditions',
  complexity: 3,
  callbacks: ['beforeSwap'],
  flags: ['beforeSwap', 'beforeSwapReturnDelta'],
  params: [
    { 
      name: 'baseFeeRate', 
      type: 'uint256', 
      description: 'Base fee rate in basis points', 
      default: '30',
      validation: 'Must be <= 10000'
    },
    { 
      name: 'maxFeeRate', 
      type: 'uint256', 
      description: 'Maximum fee rate in basis points', 
      default: '300',
      validation: 'Must be >= baseFeeRate and <= 10000'
    },
    { 
      name: 'volatilityWindow', 
      type: 'uint256', 
      description: 'Time window for volatility calculation (seconds)', 
      default: '3600'
    },
    { 
      name: 'feeRecipient', 
      type: 'address', 
      description: 'Address that receives dynamic fees'
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
import {Currency, CurrencyLibrary} from "v4-core/src/types/Currency.sol";
import {SafeCast} from "v4-core/src/libraries/SafeCast.sol";
import {FixedPointMathLib} from "solmate/src/utils/FixedPointMathLib.sol";

contract DynamicFeeHook is BaseHook {
    using PoolIdLibrary for PoolKey;
    using BeforeSwapDeltaLibrary for BeforeSwapDelta;
    using SafeCast for uint256;
    using SafeCast for int256;
    using CurrencyLibrary for Currency;
    using FixedPointMathLib for uint256;

    error InvalidFeeRates();
    error InvalidRecipient();

    struct VolatilityData {
        uint256 priceSum;           // Sum of prices for average calculation
        uint256 priceSumSquared;    // Sum of squared prices for variance
        uint256 sampleCount;        // Number of price samples
        uint256 lastUpdateTime;     // Last time volatility was updated
        uint160 lastSqrtPriceX96;   // Last recorded price
    }

    uint256 public immutable baseFeeRate;
    uint256 public immutable maxFeeRate;
    uint256 public immutable volatilityWindow;
    address public immutable feeRecipient;

    mapping(PoolId => VolatilityData) public volatilityData;

    event FeeRateUpdated(PoolId indexed poolId, uint256 newFeeRate, uint256 volatility);
    event DynamicFeeCharged(PoolId indexed poolId, address indexed swapper, uint256 feeAmount, uint256 feeRate);

    constructor(
        IPoolManager _poolManager,
        uint256 _baseFeeRate,
        uint256 _maxFeeRate,
        uint256 _volatilityWindow,
        address _feeRecipient
    ) BaseHook(_poolManager) {
        if (_baseFeeRate > _maxFeeRate || _maxFeeRate > 10000) revert InvalidFeeRates();
        if (_feeRecipient == address(0)) revert InvalidRecipient();

        baseFeeRate = _baseFeeRate;
        maxFeeRate = _maxFeeRate;
        volatilityWindow = _volatilityWindow;
        feeRecipient = _feeRecipient;
    }

    function getHookPermissions() public pure override returns (Hooks.Permissions memory) {
        return Hooks.Permissions({
            beforeInitialize: false,
            afterInitialize: false,
            beforeAddLiquidity: false,
            afterAddLiquidity: false,
            beforeRemoveLiquidity: false,
            afterRemoveLiquidity: false,
            beforeSwap: true,
            afterSwap: false,
            beforeDonate: false,
            afterDonate: false,
            beforeSwapReturnDelta: true,
            afterSwapReturnDelta: false,
            afterAddLiquidityReturnDelta: false,
            afterRemoveLiquidityReturnDelta: false
        });
    }

    function beforeSwap(
        address sender,
        PoolKey calldata key,
        IPoolManager.SwapParams calldata params,
        bytes calldata
    ) external override returns (bytes4, BeforeSwapDelta, uint24) {
        PoolId poolId = key.toId();
        
        // Get current price from pool
        (uint160 currentSqrtPriceX96,,) = poolManager.getSlot0(poolId);
        
        // Update volatility data
        _updateVolatility(poolId, currentSqrtPriceX96);
        
        // Calculate dynamic fee rate based on volatility
        uint256 currentFeeRate = _calculateDynamicFee(poolId);
        
        // Calculate fee amount
        bool exactInput = params.amountSpecified < 0;
        uint256 amountIn = exactInput 
            ? uint256(-params.amountSpecified) 
            : uint256(params.amountSpecified);
        
        uint256 fee = (amountIn * currentFeeRate) / 10000;
        
        if (fee > 0) {
            // Take fee from the appropriate currency
            Currency feeCurrency = params.zeroForOne ? key.currency0 : key.currency1;
            
            // Take fee to this contract
            poolManager.close(feeCurrency);
            poolManager.take(feeCurrency, address(this), fee);
            
            // Settle and transfer to recipient
            poolManager.close(feeCurrency);
            poolManager.settle(feeCurrency);
            feeCurrency.transfer(feeRecipient, fee);
            
            emit DynamicFeeCharged(poolId, sender, fee, currentFeeRate);
        }

        // Return delta representing the fee taken
        int128 deltaAmount = fee.toInt256().toInt128();
        BeforeSwapDelta hookDelta = BeforeSwapDeltaLibrary.toBeforeSwapDelta(
            params.zeroForOne ? deltaAmount : int128(0),
            params.zeroForOne ? int128(0) : deltaAmount
        );

        return (BaseHook.beforeSwap.selector, hookDelta, 0);
    }

    function _updateVolatility(PoolId poolId, uint160 currentSqrtPriceX96) internal {
        VolatilityData storage data = volatilityData[poolId];
        
        if (data.lastUpdateTime == 0) {
            // First update, initialize data
            data.lastSqrtPriceX96 = currentSqrtPriceX96;
            data.lastUpdateTime = block.timestamp;
            return;
        }
        
        uint256 timeDelta = block.timestamp - data.lastUpdateTime;
        
        // Only update if enough time has passed (minimum 1 minute)
        if (timeDelta < 60) return;
        
        // Calculate price change as percentage
        uint256 priceChange;
        if (currentSqrtPriceX96 > data.lastSqrtPriceX96) {
            priceChange = ((currentSqrtPriceX96 - data.lastSqrtPriceX96) * 10000) / data.lastSqrtPriceX96;
        } else {
            priceChange = ((data.lastSqrtPriceX96 - currentSqrtPriceX96) * 10000) / data.lastSqrtPriceX96;
        }
        
        // Update volatility statistics
        data.priceSum += priceChange;
        data.priceSumSquared += priceChange * priceChange;
        data.sampleCount++;
        
        // Remove old samples if window exceeded
        if (timeDelta > volatilityWindow && data.sampleCount > 10) {
            // Simple decay: reduce samples by 10%
            data.priceSum = (data.priceSum * 9) / 10;
            data.priceSumSquared = (data.priceSumSquared * 9) / 10;
            data.sampleCount = (data.sampleCount * 9) / 10;
        }
        
        data.lastSqrtPriceX96 = currentSqrtPriceX96;
        data.lastUpdateTime = block.timestamp;
    }

    function _calculateDynamicFee(PoolId poolId) internal view returns (uint256) {
        VolatilityData storage data = volatilityData[poolId];
        
        if (data.sampleCount < 2) {
            return baseFeeRate; // Not enough data, use base rate
        }
        
        // Calculate variance (simplified)
        uint256 mean = data.priceSum / data.sampleCount;
        uint256 meanSquare = data.priceSumSquared / data.sampleCount;
        
        uint256 variance = meanSquare > (mean * mean) ? meanSquare - (mean * mean) : 0;
        uint256 volatility = variance.sqrt(); // Approximate standard deviation
        
        // Map volatility to fee rate (volatility of 100 basis points = max fee)
        uint256 feeMultiplier = volatility > 1000 ? 1000 : volatility; // Cap at 10%
        uint256 dynamicFee = baseFeeRate + ((maxFeeRate - baseFeeRate) * feeMultiplier) / 1000;
        
        return dynamicFee > maxFeeRate ? maxFeeRate : dynamicFee;
    }

    // View functions
    function getCurrentFeeRate(PoolId poolId) external view returns (uint256) {
        return _calculateDynamicFee(poolId);
    }

    function getVolatilityStats(PoolId poolId) external view returns (
        uint256 samples,
        uint256 lastUpdate,
        uint256 currentFeeRate
    ) {
        VolatilityData storage data = volatilityData[poolId];
        return (data.sampleCount, data.lastUpdateTime, _calculateDynamicFee(poolId));
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

import "../src/DynamicFeeHook.sol";

contract DynamicFeeHookTest is Test, Deployers {
    using PoolIdLibrary for PoolKey;
    using CurrencyLibrary for Currency;

    DynamicFeeHook hook;
    PoolKey poolKey;
    PoolId poolId;

    uint256 constant BASE_FEE_RATE = ${params.baseFeeRate || '30'}; // ${(parseFloat(params.baseFeeRate || '30') / 100).toFixed(2)}%
    uint256 constant MAX_FEE_RATE = ${params.maxFeeRate || '300'}; // ${(parseFloat(params.maxFeeRate || '300') / 100).toFixed(1)}%
    uint256 constant VOLATILITY_WINDOW = ${params.volatilityWindow || '3600'}; // ${params.volatilityWindow || '3600'} seconds
    address constant FEE_RECIPIENT = ${params.feeRecipient || 'address(0xfee)'};

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
        uint160 flags = uint160(
            Hooks.BEFORE_SWAP_FLAG | Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG
        );
        (address hookAddress, bytes32 salt) = HookMiner.find(
            address(this),
            flags,
            type(DynamicFeeHook).creationCode,
            abi.encode(address(manager), BASE_FEE_RATE, MAX_FEE_RATE, VOLATILITY_WINDOW, FEE_RECIPIENT)
        );

        // Deploy hook
        hook = new DynamicFeeHook{salt: salt}(
            IPoolManager(address(manager)),
            BASE_FEE_RATE,
            MAX_FEE_RATE,
            VOLATILITY_WINDOW,
            FEE_RECIPIENT
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

    function testInitialFeeIsBaseFee() public {
        uint256 currentFee = hook.getCurrentFeeRate(poolId);
        assertEq(currentFee, BASE_FEE_RATE, "Initial fee should be base fee rate");
    }

    function testFirstSwapChargesBaseFee() public {
        uint256 swapAmount = 1 ether;
        uint256 expectedFee = (swapAmount * BASE_FEE_RATE) / 10000;
        
        uint256 recipientBalanceBefore = token0.balanceOf(FEE_RECIPIENT);
        
        IPoolManager.SwapParams memory params = IPoolManager.SwapParams({
            zeroForOne: true,
            amountSpecified: -int256(swapAmount),
            sqrtPriceLimitX96: SQRT_RATIO_1_2
        });
        
        PoolSwapTest.TestSettings memory testSettings = PoolSwapTest.TestSettings({
            takeClaims: false,
            settleUsingBurn: false
        });
        
        swapRouter.swap(poolKey, params, testSettings, ZERO_BYTES);
        
        uint256 recipientBalanceAfter = token0.balanceOf(FEE_RECIPIENT);
        assertEq(recipientBalanceAfter - recipientBalanceBefore, expectedFee, "Should charge base fee");
    }

    function testVolatilityIncreasesAfterMultipleSwaps() public {
        // Perform several swaps in different directions to create volatility
        IPoolManager.SwapParams memory params1 = IPoolManager.SwapParams({
            zeroForOne: true,
            amountSpecified: -1 ether,
            sqrtPriceLimitX96: SQRT_RATIO_1_2
        });
        
        IPoolManager.SwapParams memory params2 = IPoolManager.SwapParams({
            zeroForOne: false,
            amountSpecified: -1 ether,
            sqrtPriceLimitX96: SQRT_RATIO_2_1
        });
        
        PoolSwapTest.TestSettings memory testSettings = PoolSwapTest.TestSettings({
            takeClaims: false,
            settleUsingBurn: false
        });
        
        uint256 initialFeeRate = hook.getCurrentFeeRate(poolId);
        
        // Perform swaps with time gaps to build volatility
        for (uint i = 0; i < 5; i++) {
            swapRouter.swap(poolKey, params1, testSettings, ZERO_BYTES);
            vm.warp(block.timestamp + 70); // Advance time
            swapRouter.swap(poolKey, params2, testSettings, ZERO_BYTES);
            vm.warp(block.timestamp + 70);
        }
        
        uint256 finalFeeRate = hook.getCurrentFeeRate(poolId);
        assertGe(finalFeeRate, initialFeeRate, "Fee rate should increase with volatility");
    }

    function testFeeRateNeverExceedsMaximum() public {
        // Even with extreme volatility, fee should not exceed max
        for (uint i = 0; i < 20; i++) {
            IPoolManager.SwapParams memory params = IPoolManager.SwapParams({
                zeroForOne: i % 2 == 0,
                amountSpecified: -1 ether,
                sqrtPriceLimitX96: i % 2 == 0 ? SQRT_RATIO_1_4 : SQRT_RATIO_4_1
            });
            
            PoolSwapTest.TestSettings memory testSettings = PoolSwapTest.TestSettings({
                takeClaims: false,
                settleUsingBurn: false
            });
            
            swapRouter.swap(poolKey, params, testSettings, ZERO_BYTES);
            vm.warp(block.timestamp + 70);
        }
        
        uint256 currentFee = hook.getCurrentFeeRate(poolId);
        assertLe(currentFee, MAX_FEE_RATE, "Fee rate should never exceed maximum");
    }

    function testVolatilityStatsTracking() public {
        (uint256 samples, uint256 lastUpdate, uint256 currentFeeRate) = hook.getVolatilityStats(poolId);
        assertEq(samples, 0, "Should start with no samples");
        assertEq(lastUpdate, 0, "Should start with no updates");
        assertEq(currentFeeRate, BASE_FEE_RATE, "Should start with base fee rate");
        
        // Perform a swap
        IPoolManager.SwapParams memory params = IPoolManager.SwapParams({
            zeroForOne: true,
            amountSpecified: -1 ether,
            sqrtPriceLimitX96: SQRT_RATIO_1_2
        });
        
        PoolSwapTest.TestSettings memory testSettings = PoolSwapTest.TestSettings({
            takeClaims: false,
            settleUsingBurn: false
        });
        
        swapRouter.swap(poolKey, params, testSettings, ZERO_BYTES);
        
        (samples, lastUpdate,) = hook.getVolatilityStats(poolId);
        assertEq(lastUpdate, block.timestamp, "Should update timestamp");
    }

    function testConstructorValidation() public {
        // Test invalid fee rates
        vm.expectRevert(DynamicFeeHook.InvalidFeeRates.selector);
        new DynamicFeeHook(IPoolManager(address(manager)), 500, 300, 3600, FEE_RECIPIENT); // base > max
        
        // Test invalid recipient
        vm.expectRevert(DynamicFeeHook.InvalidRecipient.selector);
        new DynamicFeeHook(IPoolManager(address(manager)), 30, 300, 3600, address(0));
    }
}`,

  pitfalls: [
    'Volatility calculation is gas-intensive - consider off-chain oracles for production',
    'Price manipulation attacks can artificially inflate fees',
    'Time-based volatility windows may not capture flash volatility',
    'Consider maximum fee bounds to prevent excessive costs',
    'Volatility metrics should be carefully chosen (standard deviation vs mean absolute deviation)',
    'Cold start problem: insufficient data for initial volatility calculation'
  ],

  gasEstimate: {
    beforeSwap: 85000,
    total: 85000
  }
};