export { x402Gate } from './middleware.js';
export { verifyPayment, parsePriceToUsdc, formatUsdcToPrice } from './verify.js';
export type { X402GateConfig, RouteConfig, PaymentInfo, VerificationResult, } from './types.js';
export declare const BASE_USDC_ADDRESS = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
export declare const BASE_CHAIN_ID = 8453;
export declare const DEFAULT_FACILITATOR_URL = "https://x402.org/facilitator";
