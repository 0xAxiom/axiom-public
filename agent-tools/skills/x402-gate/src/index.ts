// Main exports
export { x402Gate } from './middleware.js';
export { verifyPayment, parsePriceToUsdc, formatUsdcToPrice } from './verify.js';

// Type exports
export type {
  X402GateConfig,
  RouteConfig,
  PaymentInfo,
  VerificationResult,
} from './types.js';

// Re-export x402 core functionality for convenience
// Note: Import specific types from @x402/core as needed

// Default constants
export const BASE_USDC_ADDRESS = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
export const BASE_CHAIN_ID = 8453;
export const DEFAULT_FACILITATOR_URL = 'https://x402.org/facilitator';