// Fee Split Pattern - Route fees to multiple recipients

export default {
  id: 'fee-split',
  name: 'Fee Split',
  description: 'Routes swap fees to multiple recipients (NFT holders, protocol, creators)',
  complexity: 3,
  callbacks: ['beforeSwap'],
  flags: ['beforeSwap', 'beforeSwapReturnDelta'],
  params: [
    { 
      name: 'totalFeeRate', 
      type: 'uint256', 
      description: 'Total fee rate in basis points', 
      default: '100',
      validation: 'Must be <= 10000 (100%)'
    },
    { 
      name: 'protocolFeeShare', 
      type: 'uint256', 
      description: 'Protocol share in basis points (of total fee)', 
      default: '5000',
      validation: 'Must be <= 10000'
    },
    { 
      name: 'nftHolderShare', 
      type: 'uint256', 
      description: 'NFT holder share in basis points (of total fee)', 
      default: '3000',
      validation: 'Must be <= 10000'
    },
    { 
      name: 'creatorShare', 
      type: 'uint256', 
      description: 'Creator share in basis points (of total fee)', 
      default: '2000',
      validation: 'Must be <= 10000'
    },
    { 
      name: 'protocolRecipient', 
      type: 'address', 
      description: 'Protocol fee recipient address'
    },
    { 
      name: 'creatorRecipient', 
      type: 'address', 
      description: 'Creator fee recipient address'
    },
    { 
      name: 'nftContract', 
      type: 'address', 
      description: 'NFT contract address for holder rewards'
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
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";

contract FeeSplitHook is BaseHook {
    using PoolIdLibrary for PoolKey;
    using BeforeSwapDeltaLibrary for BeforeSwapDelta;
    using SafeCast for uint256;
    using SafeCast for int256;
    using CurrencyLibrary for Currency;

    error InvalidFeeShares();
    error InvalidRecipients();
    error InvalidNFTContract();
    error NoNFTHolders();

    struct FeeDistribution {
        uint256 totalFeeRate;      // Total fee in basis points
        uint256 protocolShare;     // Protocol share of fee (basis points)
        uint256 nftHolderShare;    // NFT holder share of fee (basis points)
        uint256 creatorShare;      // Creator share of fee (basis points)
    }

    FeeDistribution public feeDistribution;
    address public immutable protocolRecipient;
    address public immutable creatorRecipient;
    IERC721 public immutable nftContract;

    // Track accumulated fees for NFT holders
    mapping(Currency => uint256) public nftHolderRewards;
    mapping(address => mapping(Currency => uint256)) public claimedRewards;

    // Track total NFT supply for distribution calculations
    uint256 public lastKnownSupply;
    uint256 public lastSupplyUpdate;

    event FeeCollected(
        PoolId indexed poolId,
        address indexed swapper,
        Currency indexed currency,
        uint256 totalFee,
        uint256 protocolFee,
        uint256 nftFee,
        uint256 creatorFee
    );
    
    event NFTRewardsClaimed(address indexed holder, Currency indexed currency, uint256 amount);

    constructor(
        IPoolManager _poolManager,
        uint256 _totalFeeRate,
        uint256 _protocolShare,
        uint256 _nftHolderShare,
        uint256 _creatorShare,
        address _protocolRecipient,
        address _creatorRecipient,
        address _nftContract
    ) BaseHook(_poolManager) {
        // Validate fee distribution adds up correctly
        if (_protocolShare + _nftHolderShare + _creatorShare != 10000) revert InvalidFeeShares();
        if (_totalFeeRate > 10000) revert InvalidFeeShares();
        if (_protocolRecipient == address(0) || _creatorRecipient == address(0)) revert InvalidRecipients();
        
        // Validate NFT contract
        if (_nftContract == address(0)) revert InvalidNFTContract();
        try IERC165(_nftContract).supportsInterface(0x80ac58cd) returns (bool supported) {
            if (!supported) revert InvalidNFTContract();
        } catch {
            revert InvalidNFTContract();
        }

        feeDistribution = FeeDistribution({
            totalFeeRate: _totalFeeRate,
            protocolShare: _protocolShare,
            nftHolderShare: _nftHolderShare,
            creatorShare: _creatorShare
        });

        protocolRecipient = _protocolRecipient;
        creatorRecipient = _creatorRecipient;
        nftContract = IERC721(_nftContract);
        
        _updateNFTSupply();
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
        // Calculate total fee
        bool exactInput = params.amountSpecified < 0;
        uint256 amountIn = exactInput 
            ? uint256(-params.amountSpecified) 
            : uint256(params.amountSpecified);
        
        uint256 totalFee = (amountIn * feeDistribution.totalFeeRate) / 10000;
        
        if (totalFee > 0) {
            Currency feeCurrency = params.zeroForOne ? key.currency0 : key.currency1;
            
            // Take total fee from pool
            poolManager.close(feeCurrency);
            poolManager.take(feeCurrency, address(this), totalFee);
            
            // Distribute fees
            _distributeFees(key.toId(), feeCurrency, totalFee, sender);
        }

        // Return delta representing fee taken
        int128 deltaAmount = totalFee.toInt256().toInt128();
        BeforeSwapDelta hookDelta = BeforeSwapDeltaLibrary.toBeforeSwapDelta(
            params.zeroForOne ? deltaAmount : int128(0),
            params.zeroForOne ? int128(0) : deltaAmount
        );

        return (BaseHook.beforeSwap.selector, hookDelta, 0);
    }

    function _distributeFees(PoolId poolId, Currency currency, uint256 totalFee, address swapper) internal {
        // Calculate individual fee amounts
        uint256 protocolFee = (totalFee * feeDistribution.protocolShare) / 10000;
        uint256 nftFee = (totalFee * feeDistribution.nftHolderShare) / 10000;
        uint256 creatorFee = (totalFee * feeDistribution.creatorShare) / 10000;
        
        // Ensure all fees are distributed (handle rounding)
        uint256 distributed = protocolFee + nftFee + creatorFee;
        if (distributed < totalFee) {
            protocolFee += (totalFee - distributed); // Give remainder to protocol
        }

        // Distribute protocol fee immediately
        poolManager.close(currency);
        poolManager.settle(currency);
        currency.transfer(protocolRecipient, protocolFee);

        // Distribute creator fee immediately  
        currency.transfer(creatorRecipient, creatorFee);

        // Accumulate NFT holder rewards for later claiming
        nftHolderRewards[currency] += nftFee;
        _updateNFTSupply(); // Update supply for reward calculations

        emit FeeCollected(poolId, swapper, currency, totalFee, protocolFee, nftFee, creatorFee);
    }

    function _updateNFTSupply() internal {
        // Update NFT supply periodically (gas optimization)
        if (block.timestamp - lastSupplyUpdate > 3600) { // Update hourly
            try nftContract.totalSupply() returns (uint256 supply) {
                lastKnownSupply = supply;
                lastSupplyUpdate = block.timestamp;
            } catch {
                // Fallback: assume supply hasn't changed
            }
        }
    }

    // NFT holder reward claiming
    function claimRewards(Currency currency) external {
        address holder = msg.sender;
        uint256 balance = nftContract.balanceOf(holder);
        
        if (balance == 0) revert NoNFTHolders();
        if (lastKnownSupply == 0) revert NoNFTHolders();

        // Calculate holder's share of accumulated rewards
        uint256 totalRewards = nftHolderRewards[currency];
        uint256 holderShare = (totalRewards * balance) / lastKnownSupply;
        
        // Subtract already claimed rewards
        uint256 alreadyClaimed = claimedRewards[holder][currency];
        if (holderShare <= alreadyClaimed) return; // Nothing to claim
        
        uint256 claimableReward = holderShare - alreadyClaimed;
        
        // Update claimed amount
        claimedRewards[holder][currency] = holderShare;
        
        // Transfer rewards
        currency.transfer(holder, claimableReward);
        
        emit NFTRewardsClaimed(holder, currency, claimableReward);
    }

    function batchClaimRewards(Currency[] calldata currencies) external {
        for (uint256 i = 0; i < currencies.length; i++) {
            try this.claimRewards(currencies[i]) {
                // Continue on success
            } catch {
                // Skip failed claims
            }
        }
    }

    // View functions
    function getClaimableRewards(address holder, Currency currency) external view returns (uint256) {
        uint256 balance = nftContract.balanceOf(holder);
        if (balance == 0 || lastKnownSupply == 0) return 0;

        uint256 totalRewards = nftHolderRewards[currency];
        uint256 holderShare = (totalRewards * balance) / lastKnownSupply;
        uint256 alreadyClaimed = claimedRewards[holder][currency];
        
        return holderShare > alreadyClaimed ? holderShare - alreadyClaimed : 0;
    }

    function getFeeDistribution() external view returns (
        uint256 totalRate,
        uint256 protocolShare,
        uint256 nftShare,
        uint256 creatorShare
    ) {
        return (
            feeDistribution.totalFeeRate,
            feeDistribution.protocolShare,
            feeDistribution.nftHolderShare,
            feeDistribution.creatorShare
        );
    }

    function getTotalAccumulatedRewards(Currency currency) external view returns (uint256) {
        return nftHolderRewards[currency];
    }

    function getNFTSupplyInfo() external view returns (uint256 supply, uint256 lastUpdate) {
        return (lastKnownSupply, lastSupplyUpdate);
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
import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";

import "../src/FeeSplitHook.sol";

contract MockNFT is ERC721 {
    uint256 private _currentTokenId;
    
    constructor() ERC721("MockNFT", "MNFT") {}
    
    function mint(address to) external returns (uint256) {
        _currentTokenId++;
        _mint(to, _currentTokenId);
        return _currentTokenId;
    }
    
    function totalSupply() external view returns (uint256) {
        return _currentTokenId;
    }
}

contract FeeSplitHookTest is Test, Deployers {
    using PoolIdLibrary for PoolKey;
    using CurrencyLibrary for Currency;

    FeeSplitHook hook;
    PoolKey poolKey;
    PoolId poolId;
    MockNFT nft;

    uint256 constant TOTAL_FEE_RATE = ${params.totalFeeRate || '100'};
    uint256 constant PROTOCOL_SHARE = ${params.protocolFeeShare || '5000'}; // 50%
    uint256 constant NFT_HOLDER_SHARE = ${params.nftHolderShare || '3000'}; // 30%
    uint256 constant CREATOR_SHARE = ${params.creatorShare || '2000'}; // 20%

    address constant PROTOCOL_RECIPIENT = ${params.protocolRecipient || 'address(0xprotocol)'};
    address constant CREATOR_RECIPIENT = ${params.creatorRecipient || 'address(0xcreator)'};
    address constant ALICE = address(0xa11ce);
    address constant BOB = address(0xb0b);

    TestERC20 token0;
    TestERC20 token1;

    function setUp() public {
        deployFreshManagerAndRouters();
        
        // Deploy mock NFT
        nft = new MockNFT();
        
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
            type(FeeSplitHook).creationCode,
            abi.encode(
                address(manager),
                TOTAL_FEE_RATE,
                PROTOCOL_SHARE,
                NFT_HOLDER_SHARE,
                CREATOR_SHARE,
                PROTOCOL_RECIPIENT,
                CREATOR_RECIPIENT,
                address(nft)
            )
        );

        // Deploy hook
        hook = new FeeSplitHook{salt: salt}(
            IPoolManager(address(manager)),
            TOTAL_FEE_RATE,
            PROTOCOL_SHARE,
            NFT_HOLDER_SHARE,
            CREATOR_SHARE,
            PROTOCOL_RECIPIENT,
            CREATOR_RECIPIENT,
            address(nft)
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

        // Setup tokens
        token0.mint(address(this), 1000 ether);
        token1.mint(address(this), 1000 ether);
        token0.approve(address(router), type(uint256).max);
        token1.approve(address(router), type(uint256).max);

        // Mint NFTs to test holders
        nft.mint(ALICE); // Alice gets tokenId 1
        nft.mint(BOB);   // Bob gets tokenId 2
        nft.mint(ALICE); // Alice gets tokenId 3 (now has 2 NFTs total)
    }

    function testFeeDistributionOnSwap() public {
        uint256 swapAmount = 1 ether;
        uint256 expectedTotalFee = (swapAmount * TOTAL_FEE_RATE) / 10000;
        uint256 expectedProtocolFee = (expectedTotalFee * PROTOCOL_SHARE) / 10000;
        uint256 expectedCreatorFee = (expectedTotalFee * CREATOR_SHARE) / 10000;
        uint256 expectedNFTFee = (expectedTotalFee * NFT_HOLDER_SHARE) / 10000;

        uint256 protocolBalanceBefore = token0.balanceOf(PROTOCOL_RECIPIENT);
        uint256 creatorBalanceBefore = token0.balanceOf(CREATOR_RECIPIENT);

        // Perform swap
        _performSwap(true, swapAmount);

        // Check immediate distributions (protocol and creator)
        uint256 protocolBalanceAfter = token0.balanceOf(PROTOCOL_RECIPIENT);
        uint256 creatorBalanceAfter = token0.balanceOf(CREATOR_RECIPIENT);

        assertEq(protocolBalanceAfter - protocolBalanceBefore, expectedProtocolFee, "Protocol fee incorrect");
        assertEq(creatorBalanceAfter - creatorBalanceBefore, expectedCreatorFee, "Creator fee incorrect");

        // Check NFT holder rewards accumulated
        uint256 accumulatedNFTRewards = hook.getTotalAccumulatedRewards(Currency.wrap(address(token0)));
        assertEq(accumulatedNFTRewards, expectedNFTFee, "NFT holder rewards not accumulated correctly");
    }

    function testNFTHolderRewardClaiming() public {
        uint256 swapAmount = 10 ether; // Larger amount for easier calculations
        
        // Perform swap to generate fees
        _performSwap(true, swapAmount);
        
        uint256 totalNFTSupply = nft.totalSupply(); // Should be 3
        uint256 aliceBalance = nft.balanceOf(ALICE); // Should be 2
        uint256 bobBalance = nft.balanceOf(BOB);     // Should be 1
        
        assertEq(totalNFTSupply, 3, "Total supply should be 3");
        assertEq(aliceBalance, 2, "Alice should have 2 NFTs");
        assertEq(bobBalance, 1, "Bob should have 1 NFT");

        // Check claimable rewards before claiming
        Currency currency = Currency.wrap(address(token0));
        uint256 aliceClaimable = hook.getClaimableRewards(ALICE, currency);
        uint256 bobClaimable = hook.getClaimableRewards(BOB, currency);
        
        uint256 totalRewards = hook.getTotalAccumulatedRewards(currency);
        uint256 expectedAliceRewards = (totalRewards * aliceBalance) / totalNFTSupply;
        uint256 expectedBobRewards = (totalRewards * bobBalance) / totalNFTSupply;
        
        assertEq(aliceClaimable, expectedAliceRewards, "Alice claimable amount incorrect");
        assertEq(bobClaimable, expectedBobRewards, "Bob claimable amount incorrect");

        // Alice claims rewards
        uint256 aliceBalanceBefore = token0.balanceOf(ALICE);
        vm.prank(ALICE);
        hook.claimRewards(currency);
        uint256 aliceBalanceAfter = token0.balanceOf(ALICE);
        
        assertEq(aliceBalanceAfter - aliceBalanceBefore, aliceClaimable, "Alice didn't receive correct rewards");
        
        // Bob claims rewards
        uint256 bobBalanceBefore = token0.balanceOf(BOB);
        vm.prank(BOB);
        hook.claimRewards(currency);
        uint256 bobBalanceAfter = token0.balanceOf(BOB);
        
        assertEq(bobBalanceAfter - bobBalanceBefore, bobClaimable, "Bob didn't receive correct rewards");
    }

    function testDoubleClaimingPrevention() public {
        _performSwap(true, 1 ether);
        
        Currency currency = Currency.wrap(address(token0));
        uint256 aliceClaimableBefore = hook.getClaimableRewards(ALICE, currency);
        
        // Alice claims once
        vm.prank(ALICE);
        hook.claimRewards(currency);
        
        // Alice tries to claim again immediately
        uint256 aliceClaimableAfter = hook.getClaimableRewards(ALICE, currency);
        assertEq(aliceClaimableAfter, 0, "Alice should have no claimable rewards after claiming");
        
        uint256 aliceBalanceBefore = token0.balanceOf(ALICE);
        vm.prank(ALICE);
        hook.claimRewards(currency); // Should be safe to call, but no transfer
        uint256 aliceBalanceAfter = token0.balanceOf(ALICE);
        
        assertEq(aliceBalanceAfter, aliceBalanceBefore, "Alice balance shouldn't change on double claim");
    }

    function testBatchRewardClaiming() public {
        // Generate fees in both tokens
        _performSwap(true, 1 ether);  // Fee in token0
        _performSwap(false, 1 ether); // Fee in token1
        
        Currency[] memory currencies = new Currency[](2);
        currencies[0] = Currency.wrap(address(token0));
        currencies[1] = Currency.wrap(address(token1));
        
        uint256 alice0Before = token0.balanceOf(ALICE);
        uint256 alice1Before = token1.balanceOf(ALICE);
        
        vm.prank(ALICE);
        hook.batchClaimRewards(currencies);
        
        uint256 alice0After = token0.balanceOf(ALICE);
        uint256 alice1After = token1.balanceOf(ALICE);
        
        assertGt(alice0After, alice0Before, "Alice should receive token0 rewards");
        assertGt(alice1After, alice1Before, "Alice should receive token1 rewards");
    }

    function testNoNFTHolderCannotClaim() public {
        _performSwap(true, 1 ether);
        
        address nonHolder = address(0xdead);
        assertEq(nft.balanceOf(nonHolder), 0, "Non-holder should have 0 NFTs");
        
        vm.expectRevert(FeeSplitHook.NoNFTHolders.selector);
        vm.prank(nonHolder);
        hook.claimRewards(Currency.wrap(address(token0)));
    }

    function testFeeDistributionView() public {
        (
            uint256 totalRate,
            uint256 protocolShare,
            uint256 nftShare,
            uint256 creatorShare
        ) = hook.getFeeDistribution();
        
        assertEq(totalRate, TOTAL_FEE_RATE, "Total rate incorrect");
        assertEq(protocolShare, PROTOCOL_SHARE, "Protocol share incorrect");
        assertEq(nftShare, NFT_HOLDER_SHARE, "NFT share incorrect");
        assertEq(creatorShare, CREATOR_SHARE, "Creator share incorrect");
    }

    function testConstructorValidation() public {
        // Test invalid fee shares (don't add to 100%)
        vm.expectRevert(FeeSplitHook.InvalidFeeShares.selector);
        new FeeSplitHook(
            IPoolManager(address(manager)),
            100, 5000, 3000, 3000, // Adds to 110%
            PROTOCOL_RECIPIENT,
            CREATOR_RECIPIENT,
            address(nft)
        );
        
        // Test invalid recipients
        vm.expectRevert(FeeSplitHook.InvalidRecipients.selector);
        new FeeSplitHook(
            IPoolManager(address(manager)),
            100, 5000, 3000, 2000,
            address(0), // Invalid protocol recipient
            CREATOR_RECIPIENT,
            address(nft)
        );
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
    'Fee share percentages must add up to exactly 10000 (100%)',
    'NFT holder rewards require claiming mechanism - not automatic',
    'Consider gas costs of reward claiming vs automatic distribution',
    'NFT contract changes (burns, mints) affect reward distribution',
    'Unclaimed rewards accumulate - consider sweep mechanisms for abandoned rewards',
    'Precision loss in fee splitting calculations',
    'Security: validate NFT contract implements ERC721 correctly'
  ],

  gasEstimate: {
    beforeSwap: 95000,
    claimRewards: 65000,
    total: 95000
  }
};