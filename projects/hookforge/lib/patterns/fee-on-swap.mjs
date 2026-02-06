// Fee on Swap Pattern - Takes a percentage fee on every swap

export default {
  id: 'fee-on-swap',
  name: 'Fee on Swap',
  description: 'Takes a percentage fee on every swap, sent to a designated recipient',
  complexity: 2,
  callbacks: ['beforeSwap'],
  flags: ['beforeSwap', 'beforeSwapReturnDelta'],
  params: [
    { 
      name: 'feeRate', 
      type: 'uint256', 
      description: 'Fee in basis points (100 = 1%)', 
      default: '100',
      validation: 'Must be <= 10000 (100%)'
    },
    { 
      name: 'feeRecipient', 
      type: 'address', 
      description: 'Address that receives fees',
      validation: 'Must be non-zero address'
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
import {Actions} from "v4-periphery/src/libraries/Actions.sol";

contract FeeOnSwapHook is BaseHook {
    using PoolIdLibrary for PoolKey;
    using BeforeSwapDeltaLibrary for BeforeSwapDelta;
    using SafeCast for uint256;
    using SafeCast for int256;
    using CurrencyLibrary for Currency;

    error InvalidFeeRate();
    error InvalidRecipient();

    uint256 public constant MAX_FEE_RATE = 10000; // 100%
    uint256 public immutable feeRate; // Fee in basis points
    address public immutable feeRecipient;

    event FeeCharged(
        PoolId indexed poolId,
        address indexed swapper,
        Currency indexed currency,
        uint256 feeAmount
    );

    constructor(IPoolManager _poolManager, uint256 _feeRate, address _feeRecipient) 
        BaseHook(_poolManager) 
    {
        if (_feeRate > MAX_FEE_RATE) revert InvalidFeeRate();
        if (_feeRecipient == address(0)) revert InvalidRecipient();
        
        feeRate = _feeRate;
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
            beforeSwapReturnDelta: true,  // CRITICAL: Must match the delta return
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
        // Calculate fee based on input amount (V4 convention: amountSpecified < 0 = exact input)
        bool exactInput = params.amountSpecified < 0;
        uint256 amountIn = exactInput 
            ? uint256(-params.amountSpecified) 
            : uint256(params.amountSpecified);
        
        // Fee calculation: fee = amount * feeRate / 10000
        uint256 fee = (amountIn * feeRate) / 10000;
        
        if (fee > 0) {
            // Determine which currency to take fee from
            Currency feeCurrency = params.zeroForOne ? key.currency0 : key.currency1;
            
            // Take fee from the pool to this contract
            poolManager.close(feeCurrency);
            poolManager.take(feeCurrency, address(this), fee);
            
            // Transfer fee to recipient using CLOSE_CURRENCY (universal safe action)
            poolManager.close(feeCurrency);
            poolManager.settle(feeCurrency);  // Settle our take
            
            // Transfer to recipient (external transfer, safe here)
            feeCurrency.transfer(feeRecipient, fee);
            
            emit FeeCharged(key.toId(), sender, feeCurrency, fee);
        }

        // Return delta: we took 'fee' amount from input currency
        // V4 Convention: positive delta = hook takes tokens, negative = hook gives tokens
        int128 deltaAmount = fee.toInt256().toInt128();
        BeforeSwapDelta hookDelta = BeforeSwapDeltaLibrary.toBeforeSwapDelta(
            params.zeroForOne ? deltaAmount : int128(0),  // currency0 delta
            params.zeroForOne ? int128(0) : deltaAmount   // currency1 delta
        );

        return (BaseHook.beforeSwap.selector, hookDelta, 0);
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

import "../src/FeeOnSwapHook.sol";

contract FeeOnSwapHookTest is Test, Deployers {
    using PoolIdLibrary for PoolKey;
    using CurrencyLibrary for Currency;

    FeeOnSwapHook hook;
    PoolKey poolKey;
    PoolId poolId;

    uint256 constant FEE_RATE = ${params.feeRate || '100'}; // ${(parseFloat(params.feeRate || '100') / 100).toFixed(1)}%
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

        // Mine hook address with correct flags
        uint160 flags = uint160(
            Hooks.BEFORE_SWAP_FLAG | Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG
        );
        (address hookAddress, bytes32 salt) = HookMiner.find(
            address(this),
            flags,
            type(FeeOnSwapHook).creationCode,
            abi.encode(address(manager), FEE_RATE, FEE_RECIPIENT)
        );

        // Deploy hook
        hook = new FeeOnSwapHook{salt: salt}(IPoolManager(address(manager)), FEE_RATE, FEE_RECIPIENT);
        require(address(hook) == hookAddress, "Hook address mismatch");

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

        // Mint tokens to this contract for testing
        token0.mint(address(this), 1000 ether);
        token1.mint(address(this), 1000 ether);
        
        // Approve tokens
        token0.approve(address(router), type(uint256).max);
        token1.approve(address(router), type(uint256).max);
    }

    function testFeeOnExactInputSwap() public {
        uint256 swapAmount = 1 ether;
        uint256 expectedFee = (swapAmount * FEE_RATE) / 10000;
        
        uint256 recipientBalanceBefore = token0.balanceOf(FEE_RECIPIENT);
        
        // Perform swap
        IPoolManager.SwapParams memory params = IPoolManager.SwapParams({
            zeroForOne: true,
            amountSpecified: -int256(swapAmount), // Exact input
            sqrtPriceLimitX96: SQRT_RATIO_1_2
        });
        
        PoolSwapTest.TestSettings memory testSettings = PoolSwapTest.TestSettings({
            takeClaims: false,
            settleUsingBurn: false
        });
        
        swapRouter.swap(poolKey, params, testSettings, ZERO_BYTES);
        
        // Check fee was collected
        uint256 recipientBalanceAfter = token0.balanceOf(FEE_RECIPIENT);
        assertEq(recipientBalanceAfter - recipientBalanceBefore, expectedFee, "Fee not collected correctly");
    }

    function testFeeOnExactOutputSwap() public {
        uint256 outputAmount = 0.5 ether;
        
        // Perform swap
        IPoolManager.SwapParams memory params = IPoolManager.SwapParams({
            zeroForOne: true,
            amountSpecified: int256(outputAmount), // Exact output
            sqrtPriceLimitX96: SQRT_RATIO_1_2
        });
        
        PoolSwapTest.TestSettings memory testSettings = PoolSwapTest.TestSettings({
            takeClaims: false,
            settleUsingBurn: false
        });
        
        uint256 recipientBalanceBefore = token0.balanceOf(FEE_RECIPIENT);
        swapRouter.swap(poolKey, params, testSettings, ZERO_BYTES);
        uint256 recipientBalanceAfter = token0.balanceOf(FEE_RECIPIENT);
        
        // For exact output, fee should be taken from the input amount
        assertTrue(recipientBalanceAfter > recipientBalanceBefore, "Fee should be collected on exact output");
    }

    function testZeroFeeOnZeroAmountSwap() public {
        uint256 recipientBalanceBefore = token0.balanceOf(FEE_RECIPIENT);
        
        // Try swap with zero amount (should not charge fee)
        IPoolManager.SwapParams memory params = IPoolManager.SwapParams({
            zeroForOne: true,
            amountSpecified: 0,
            sqrtPriceLimitX96: SQRT_RATIO_1_2
        });
        
        PoolSwapTest.TestSettings memory testSettings = PoolSwapTest.TestSettings({
            takeClaims: false,
            settleUsingBurn: false
        });
        
        swapRouter.swap(poolKey, params, testSettings, ZERO_BYTES);
        
        uint256 recipientBalanceAfter = token0.balanceOf(FEE_RECIPIENT);
        assertEq(recipientBalanceAfter, recipientBalanceBefore, "No fee should be charged on zero amount");
    }

    function testConstructorValidation() public {
        // Test invalid fee rate
        vm.expectRevert(FeeOnSwapHook.InvalidFeeRate.selector);
        new FeeOnSwapHook(IPoolManager(address(manager)), 10001, address(0xfee)); // > 100%
        
        // Test invalid recipient
        vm.expectRevert(FeeOnSwapHook.InvalidRecipient.selector);
        new FeeOnSwapHook(IPoolManager(address(manager)), 100, address(0));
    }

    function testHookPermissions() public {
        Hooks.Permissions memory permissions = hook.getHookPermissions();
        assertTrue(permissions.beforeSwap);
        assertTrue(permissions.beforeSwapReturnDelta);
        assertFalse(permissions.afterSwap);
        assertFalse(permissions.beforeInitialize);
    }
}`,

  pitfalls: [
    'Must use beforeSwapReturnDelta flag when returning non-zero delta',
    'Fee base must be amountSpecified, not BalanceDelta amounts',
    'Use CLOSE_CURRENCY for safe action encoding on hook pools',
    'amountSpecified < 0 indicates exact input (user sends tokens)',
    'External transfers must happen outside the callback flow',
    'Delta signs: positive = hook takes, negative = hook gives'
  ],

  gasEstimate: {
    beforeSwap: 45000,
    total: 45000
  }
};