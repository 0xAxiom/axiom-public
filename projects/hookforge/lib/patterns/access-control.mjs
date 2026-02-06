// Access Control Pattern - Whitelist/blacklist swappers

export default {
  id: 'access-control',
  name: 'Access Control',
  description: 'Restrict pool access via whitelist or blacklist of addresses',
  complexity: 1,
  callbacks: ['beforeSwap'],
  flags: ['beforeSwap'],
  params: [
    { 
      name: 'controlType', 
      type: 'string', 
      description: 'Control type: "whitelist" or "blacklist"', 
      default: 'whitelist',
      validation: 'Must be "whitelist" or "blacklist"'
    },
    { 
      name: 'admin', 
      type: 'address', 
      description: 'Admin address that can update lists',
      validation: 'Must be non-zero address'
    },
    {
      name: 'initialAddresses',
      type: 'address[]',
      description: 'Initial addresses for whitelist/blacklist',
      default: '[]'
    }
  ],
  
  solidity: (params) => `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {BaseHook} from "v4-periphery/src/base/hooks/BaseHook.sol";
import {Hooks} from "v4-core/src/libraries/Hooks.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {BalanceDelta} from "v4-core/src/types/BalanceDelta.sol";
import {BeforeSwapDelta, BeforeSwapDeltaLibrary} from "v4-core/src/types/BeforeSwapDelta.sol";

contract AccessControlHook is BaseHook {
    using BeforeSwapDeltaLibrary for BeforeSwapDelta;

    error Unauthorized();
    error OnlyAdmin();

    bool public immutable isWhitelist; // true = whitelist, false = blacklist
    address public immutable admin;
    
    mapping(address => bool) public accessList;

    event AccessUpdated(address indexed account, bool hasAccess);
    event AdminTransferred(address indexed previousAdmin, address indexed newAdmin);

    modifier onlyAdmin() {
        if (msg.sender != admin) revert OnlyAdmin();
        _;
    }

    constructor(
        IPoolManager _poolManager, 
        bool _isWhitelist, 
        address _admin,
        address[] memory _initialAddresses
    ) BaseHook(_poolManager) {
        require(_admin != address(0), "Invalid admin");
        
        isWhitelist = _isWhitelist;
        admin = _admin;
        
        // Set initial addresses
        for (uint256 i = 0; i < _initialAddresses.length; i++) {
            accessList[_initialAddresses[i]] = true;
            emit AccessUpdated(_initialAddresses[i], true);
        }
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
            beforeSwapReturnDelta: false,
            afterSwapReturnDelta: false,
            afterAddLiquidityReturnDelta: false,
            afterRemoveLiquidityReturnDelta: false
        });
    }

    function beforeSwap(
        address sender,
        PoolKey calldata,
        IPoolManager.SwapParams calldata,
        bytes calldata
    ) external view override returns (bytes4, BeforeSwapDelta, uint24) {
        bool hasAccess = accessList[sender];
        
        if (isWhitelist) {
            // Whitelist mode: sender must be in the list
            if (!hasAccess) revert Unauthorized();
        } else {
            // Blacklist mode: sender must NOT be in the list
            if (hasAccess) revert Unauthorized();
        }

        // Access granted, continue with swap
        return (BaseHook.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
    }

    // Admin functions
    function updateAccess(address account, bool hasAccess) external onlyAdmin {
        accessList[account] = hasAccess;
        emit AccessUpdated(account, hasAccess);
    }

    function batchUpdateAccess(address[] calldata accounts, bool hasAccess) external onlyAdmin {
        for (uint256 i = 0; i < accounts.length; i++) {
            accessList[accounts[i]] = hasAccess;
            emit AccessUpdated(accounts[i], hasAccess);
        }
    }

    // View functions
    function canSwap(address account) external view returns (bool) {
        bool hasAccess = accessList[account];
        return isWhitelist ? hasAccess : !hasAccess;
    }

    function getAccessType() external view returns (string memory) {
        return isWhitelist ? "whitelist" : "blacklist";
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

import "../src/AccessControlHook.sol";

contract AccessControlHookTest is Test, Deployers {
    using PoolIdLibrary for PoolKey;
    using CurrencyLibrary for Currency;

    AccessControlHook whitelistHook;
    AccessControlHook blacklistHook;
    PoolKey poolKey;
    PoolId poolId;

    address constant ADMIN = address(0xadmin);
    address constant ALICE = address(0xa11ce);
    address constant BOB = address(0xb0b);
    address constant CHARLIE = address(0xchar1ie);

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

        // Deploy whitelist hook
        address[] memory initialWhitelist = new address[](2);
        initialWhitelist[0] = ALICE;
        initialWhitelist[1] = BOB;

        uint160 flags = uint160(Hooks.BEFORE_SWAP_FLAG);
        (address hookAddress, bytes32 salt) = HookMiner.find(
            address(this),
            flags,
            type(AccessControlHook).creationCode,
            abi.encode(address(manager), true, ADMIN, initialWhitelist)
        );

        whitelistHook = new AccessControlHook{salt: salt}(
            IPoolManager(address(manager)), 
            true, 
            ADMIN, 
            initialWhitelist
        );

        // Deploy blacklist hook
        address[] memory initialBlacklist = new address[](1);
        initialBlacklist[0] = CHARLIE;

        (address hookAddress2, bytes32 salt2) = HookMiner.find(
            address(this),
            flags,
            type(AccessControlHook).creationCode,
            abi.encode(address(manager), false, ADMIN, initialBlacklist)
        );

        blacklistHook = new AccessControlHook{salt: salt2}(
            IPoolManager(address(manager)), 
            false, 
            ADMIN, 
            initialBlacklist
        );

        // Create pool key with whitelist hook for main tests
        poolKey = PoolKey({
            currency0: Currency.wrap(address(token0)),
            currency1: Currency.wrap(address(token1)),
            fee: 3000,
            tickSpacing: 60,
            hooks: IHooks(address(whitelistHook))
        });
        poolId = poolKey.toId();

        // Initialize pool
        manager.initialize(poolKey, SQRT_RATIO_1_1, ZERO_BYTES);

        // Setup tokens for addresses
        token0.mint(ALICE, 100 ether);
        token1.mint(ALICE, 100 ether);
        token0.mint(BOB, 100 ether);
        token1.mint(BOB, 100 ether);
        token0.mint(CHARLIE, 100 ether);
        token1.mint(CHARLIE, 100 ether);
    }

    function testWhitelistAllowsAuthorizedUsers() public {
        // Alice should be able to swap (whitelisted)
        vm.startPrank(ALICE);
        token0.approve(address(router), 1 ether);
        
        IPoolManager.SwapParams memory params = IPoolManager.SwapParams({
            zeroForOne: true,
            amountSpecified: -1 ether,
            sqrtPriceLimitX96: SQRT_RATIO_1_2
        });
        
        PoolSwapTest.TestSettings memory testSettings = PoolSwapTest.TestSettings({
            takeClaims: false,
            settleUsingBurn: false
        });
        
        // Should not revert
        swapRouter.swap(poolKey, params, testSettings, ZERO_BYTES);
        vm.stopPrank();
    }

    function testWhitelistBlocksUnauthorizedUsers() public {
        // Charlie should not be able to swap (not whitelisted)
        vm.startPrank(CHARLIE);
        token0.approve(address(router), 1 ether);
        
        IPoolManager.SwapParams memory params = IPoolManager.SwapParams({
            zeroForOne: true,
            amountSpecified: -1 ether,
            sqrtPriceLimitX96: SQRT_RATIO_1_2
        });
        
        PoolSwapTest.TestSettings memory testSettings = PoolSwapTest.TestSettings({
            takeClaims: false,
            settleUsingBurn: false
        });
        
        // Should revert with Unauthorized
        vm.expectRevert(AccessControlHook.Unauthorized.selector);
        swapRouter.swap(poolKey, params, testSettings, ZERO_BYTES);
        vm.stopPrank();
    }

    function testAdminCanUpdateWhitelist() public {
        // Admin adds Charlie to whitelist
        vm.prank(ADMIN);
        whitelistHook.updateAccess(CHARLIE, true);
        
        assertTrue(whitelistHook.canSwap(CHARLIE), "Charlie should be able to swap after being added");
        
        // Admin removes Alice from whitelist
        vm.prank(ADMIN);
        whitelistHook.updateAccess(ALICE, false);
        
        assertFalse(whitelistHook.canSwap(ALICE), "Alice should not be able to swap after being removed");
    }

    function testBlacklistMode() public {
        // Test that blacklist allows non-blacklisted users
        assertTrue(blacklistHook.canSwap(ALICE), "Alice should be able to swap (not blacklisted)");
        assertTrue(blacklistHook.canSwap(BOB), "Bob should be able to swap (not blacklisted)");
        
        // Test that blacklist blocks blacklisted users
        assertFalse(blacklistHook.canSwap(CHARLIE), "Charlie should not be able to swap (blacklisted)");
    }

    function testBatchUpdateAccess() public {
        address[] memory accounts = new address[](2);
        accounts[0] = CHARLIE;
        accounts[1] = address(0xdead);
        
        vm.prank(ADMIN);
        whitelistHook.batchUpdateAccess(accounts, true);
        
        assertTrue(whitelistHook.canSwap(CHARLIE), "Charlie should be whitelisted");
        assertTrue(whitelistHook.canSwap(address(0xdead)), "Dead address should be whitelisted");
    }

    function testOnlyAdminCanUpdateAccess() public {
        // Non-admin should not be able to update access
        vm.expectRevert(AccessControlHook.OnlyAdmin.selector);
        vm.prank(ALICE);
        whitelistHook.updateAccess(CHARLIE, true);
    }

    function testAccessTypeView() public {
        assertEq(whitelistHook.getAccessType(), "whitelist");
        assertEq(blacklistHook.getAccessType(), "blacklist");
    }

    function testConstructorValidation() public {
        // Test invalid admin
        address[] memory empty = new address[](0);
        vm.expectRevert("Invalid admin");
        new AccessControlHook(IPoolManager(address(manager)), true, address(0), empty);
    }
}`,

  pitfalls: [
    'Access control only applies to the swap initiator, not intermediate routers',
    'Consider gas costs of storage reads on every swap',
    'Admin key management is critical - use multisig for production',
    'Whitelist mode requires adding new addresses manually',
    'View functions can help frontends check access before transactions'
  ],

  gasEstimate: {
    beforeSwap: 8000,
    total: 8000
  }
};