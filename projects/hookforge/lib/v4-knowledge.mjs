// V4 Knowledge Base — Encodes deep Uniswap V4 expertise

export default {
  // All V4 callback signatures
  callbacks: {
    beforeInitialize: {
      signature: 'beforeInitialize(address,PoolKey calldata,uint160,bytes calldata)',
      returns: 'bytes4',
      flag: 'beforeInitialize',
      gasLimit: 100000,
      description: 'Called before pool initialization. Can reject pool creation.'
    },
    afterInitialize: {
      signature: 'afterInitialize(address,PoolKey calldata,uint160,int24,bytes calldata)',
      returns: 'bytes4',
      flag: 'afterInitialize',
      gasLimit: 100000,
      description: 'Called after pool initialization. Useful for state setup.'
    },
    beforeSwap: {
      signature: 'beforeSwap(address,PoolKey calldata,IPoolManager.SwapParams calldata,bytes calldata)',
      returns: '(bytes4, BeforeSwapDelta, uint24)',
      flag: 'beforeSwap',
      gasLimit: 50000,
      description: 'Called before every swap. Can modify swap behavior, take fees, or reject.'
    },
    afterSwap: {
      signature: 'afterSwap(address,PoolKey calldata,IPoolManager.SwapParams calldata,BalanceDelta,bytes calldata)',
      returns: '(bytes4, int128)',
      flag: 'afterSwap',
      gasLimit: 100000,
      description: 'Called after swap execution. Useful for oracles, analytics, rewards.'
    },
    beforeAddLiquidity: {
      signature: 'beforeAddLiquidity(address,PoolKey calldata,IPoolManager.ModifyLiquidityParams calldata,bytes calldata)',
      returns: 'bytes4',
      flag: 'beforeAddLiquidity',
      gasLimit: 100000,
      description: 'Called before liquidity addition. Can gate LP access.'
    },
    afterAddLiquidity: {
      signature: 'afterAddLiquidity(address,PoolKey calldata,IPoolManager.ModifyLiquidityParams calldata,BalanceDelta,BalanceDelta,bytes calldata)',
      returns: '(bytes4, BalanceDelta)',
      flag: 'afterAddLiquidity',
      gasLimit: 100000,
      description: 'Called after liquidity added. Useful for LP incentives.'
    },
    beforeRemoveLiquidity: {
      signature: 'beforeRemoveLiquidity(address,PoolKey calldata,IPoolManager.ModifyLiquidityParams calldata,bytes calldata)',
      returns: 'bytes4',
      flag: 'beforeRemoveLiquidity',
      gasLimit: 100000,
      description: 'Called before liquidity removal. Can enforce lock periods.'
    },
    afterRemoveLiquidity: {
      signature: 'afterRemoveLiquidity(address,PoolKey calldata,IPoolManager.ModifyLiquidityParams calldata,BalanceDelta,BalanceDelta,bytes calldata)',
      returns: '(bytes4, BalanceDelta)',
      flag: 'afterRemoveLiquidity',
      gasLimit: 100000,
      description: 'Called after liquidity removed.'
    },
    beforeDonate: {
      signature: 'beforeDonate(address,PoolKey calldata,uint256,uint256,bytes calldata)',
      returns: 'bytes4',
      flag: 'beforeDonate',
      gasLimit: 50000,
      description: 'Called before donate (distributing tokens to LPs).'
    },
    afterDonate: {
      signature: 'afterDonate(address,PoolKey calldata,uint256,uint256,bytes calldata)',
      returns: 'bytes4',
      flag: 'afterDonate',
      gasLimit: 50000,
      description: 'Called after donate.'
    }
  },

  // Flag permission mappings
  flagMappings: {
    beforeInitialize: { bit: 0, hex: '0x0001' },
    afterInitialize: { bit: 1, hex: '0x0002' },
    beforeAddLiquidity: { bit: 2, hex: '0x0004' },
    afterAddLiquidity: { bit: 3, hex: '0x0008' },
    beforeRemoveLiquidity: { bit: 4, hex: '0x0010' },
    afterRemoveLiquidity: { bit: 5, hex: '0x0020' },
    beforeSwap: { bit: 6, hex: '0x0040' },
    afterSwap: { bit: 7, hex: '0x0080' },
    beforeDonate: { bit: 8, hex: '0x0100' },
    afterDonate: { bit: 9, hex: '0x0200' },
    beforeSwapReturnDelta: { bit: 10, hex: '0x0400' },
    afterSwapReturnDelta: { bit: 11, hex: '0x0800' },
    afterAddLiquidityReturnDelta: { bit: 12, hex: '0x1000' },
    afterRemoveLiquidityReturnDelta: { bit: 13, hex: '0x2000' }
  },

  // Action codes
  actionCodes: {
    INCREASE_LIQUIDITY: { code: '0x00', description: 'Add liquidity to position' },
    DECREASE_LIQUIDITY: { code: '0x01', description: 'Remove liquidity from position' },
    MINT_POSITION: { code: '0x02', description: 'Mint new position NFT' },
    BURN_POSITION: { code: '0x03', description: 'Burn position NFT' },
    SETTLE: { code: '0x09', description: 'Settle debt with PoolManager' },
    SETTLE_ALL: { code: '0x10', description: 'Settle all debt' },
    TAKE: { code: '0x12', description: 'Take tokens from PoolManager' },
    TAKE_ALL: { code: '0x13', description: 'Take all owed tokens' },
    CLOSE_CURRENCY: { code: '0x11', description: 'Universal safe action — handles both settle and take as needed' },
    SETTLE_PAIR: { code: '0x0d', description: 'Settle pair (UNSAFE on hook pools — use CLOSE_CURRENCY)' },
    TAKE_PAIR: { code: '0x0e', description: 'Take pair (UNSAFE on hook pools — use CLOSE_CURRENCY)' },
    SWEEP: { code: '0x14', description: 'Sweep remaining tokens to recipient' }
  },

  // V4 conventions
  conventions: [
    {
      id: 'exact-input-sign',
      title: 'Exact Input Sign Convention',
      description: 'amountSpecified < 0 means exact-input (user specifies how much they SEND). amountSpecified > 0 means exact-output (user specifies how much they RECEIVE).',
      critical: true,
      example: 'bool exactInput = params.amountSpecified < 0;'
    },
    {
      id: 'fee-base',
      title: 'Fee Calculation Base',
      description: 'ALWAYS use params.amountSpecified as the fee base, NEVER BalanceDelta. BalanceDelta is the result after the swap — using it for fee calculation creates circular dependency.',
      critical: true,
      example: 'uint256 fee = (uint256(-params.amountSpecified) * feeRate) / 10000;'
    },
    {
      id: 'close-currency',
      title: 'CLOSE_CURRENCY Action',
      description: 'CLOSE_CURRENCY (0x11) is the universal safe action for hook pools. SETTLE_PAIR and TAKE_PAIR break on some hooks (DeltaNotNegative error). Always prefer CLOSE_CURRENCY.',
      critical: true,
      example: 'actions = abi.encodePacked(Actions.DECREASE_LIQUIDITY, Actions.CLOSE_CURRENCY, Actions.CLOSE_CURRENCY);'
    },
    {
      id: 'two-action-limit',
      title: 'Action Encoding Limit',
      description: 'Hook pools support maximum 2-action patterns. 3 actions cause SliceOutOfBounds. Structure operations as pairs.',
      critical: true,
      example: 'Use DECREASE + CLOSE_CURRENCY (2 actions), not DECREASE + TAKE + SETTLE (3 actions)'
    },
    {
      id: 'permit2-approvals',
      title: 'Token Approval Pattern',
      description: 'V4 uses Permit2 for token approvals. Approve Permit2, NOT PositionManager directly.',
      critical: true,
      example: 'token.approve(permit2Address, type(uint256).max);'
    },
    {
      id: 'delta-signs',
      title: 'Delta Sign Convention',
      description: 'In BeforeSwapDelta: positive = hook takes tokens FROM the swap, negative = hook gives tokens TO the swap.',
      critical: true,
      example: 'toBeforeSwapDelta(int128(feeAmount), 0) // Takes feeAmount from currency0'
    },
    {
      id: 'hook-address-encoding',
      title: 'Hook Address Flag Encoding',
      description: 'Hook address must have specific bits set to match permissions. Use HookMiner or CREATE2 to find compliant addresses.',
      critical: false,
      example: 'Use HookMiner.find(deployer, flags, creationCode, constructorArgs)'
    },
    {
      id: 'tick-range-ordering',
      title: 'Tick Range Convention',
      description: 'tickLower MUST be less than tickUpper. Both must be multiples of tickSpacing. Always use Math.min/max when extracting from positions.',
      critical: false,
      example: 'int24 lower = Math.min(tickA, tickB); int24 upper = Math.max(tickA, tickB);'
    },
    {
      id: 'transient-storage',
      title: 'Transient Storage for Temporary State',
      description: 'Use tstore/tload (EIP-1153) for per-transaction state instead of regular storage. Much cheaper for temporary data.',
      critical: false,
      example: 'assembly { tstore(slot, value) } // ~100 gas vs 20k for sstore'
    },
    {
      id: 'pool-manager-singleton',
      title: 'PoolManager is Singleton',
      description: 'All pools share one PoolManager. Hooks interact via callbacks — PoolManager calls your hook, not vice versa (for swap flow).',
      critical: false,
      example: 'constructor(IPoolManager _poolManager) BaseHook(_poolManager) {}'
    }
  ],

  // Common pitfalls database
  pitfalls: [
    {
      id: 'settle-pair-hook-pools',
      title: 'SETTLE_PAIR breaks on hook pools',
      severity: 'critical',
      description: 'Using SETTLE_PAIR or TAKE_PAIR on pools with hooks that modify deltas causes DeltaNotNegative error.',
      solution: 'Use CLOSE_CURRENCY instead — it handles both settle and take automatically.',
      realWorld: 'Encountered when managing Clanker V4 positions. Clanker hooks modify swap deltas, making SETTLE_PAIR fail.'
    },
    {
      id: 'three-action-slice',
      title: '3 actions = SliceOutOfBounds',
      severity: 'critical',
      description: 'Encoding 3 or more actions in a single operation on hook pools causes SliceOutOfBounds.',
      solution: 'Use 2-action patterns maximum. Combine with CLOSE_CURRENCY.',
      realWorld: 'Discovered during LP decrease operations on Clanker pools.'
    },
    {
      id: 'fee-base-delta',
      title: 'Fee calculation using BalanceDelta',
      severity: 'critical',
      description: 'Using BalanceDelta (swap result) instead of amountSpecified (user input) as fee base.',
      solution: 'Always: fee = abs(params.amountSpecified) * feeRate / 10000',
      realWorld: 'Factory Protocol spec had this bug through 3 revisions before catching it.'
    },
    {
      id: 'missing-return-delta-flag',
      title: 'Missing beforeSwapReturnDelta flag',
      severity: 'critical',
      description: 'Returning non-zero BeforeSwapDelta without setting beforeSwapReturnDelta flag causes silent failure.',
      solution: 'Set beforeSwapReturnDelta: true in getHookPermissions() whenever beforeSwap returns non-zero delta.',
      realWorld: 'Common issue in hook development — no error, just silently ignored delta.'
    },
    {
      id: 'approve-position-manager',
      title: 'Approving PositionManager instead of Permit2',
      severity: 'high',
      description: 'V4 routes token transfers through Permit2. Approving PositionManager directly has no effect.',
      solution: 'token.approve(permit2Address, amount); permit2.approve(token, positionManager, amount, expiry);',
      realWorld: 'Encountered in LP management scripts — transfers fail silently.'
    },
    {
      id: 'tick-range-reversed',
      title: 'Reversed tick range',
      severity: 'high',
      description: 'tickLower > tickUpper causes revert. Easy to get wrong when extracting from existing positions.',
      solution: 'Always use Math.min(tickA, tickB) for lower, Math.max(tickA, tickB) for upper.',
      realWorld: 'Hit during auto-compound when extracting tick range from position data.'
    }
  ]
};
