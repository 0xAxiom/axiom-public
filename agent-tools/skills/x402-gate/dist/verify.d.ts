import { VerificationResult, PaymentInfo } from './types.js';
/**
 * Verify a payment using the x402 facilitator
 */
export declare function verifyPayment(paymentHash: string, expectedPayment: PaymentInfo, facilitatorUrl?: string): Promise<VerificationResult>;
/**
 * Parse price string to USDC units (6 decimals)
 * '$0.01' -> 10000
 * '$1.50' -> 1500000
 * 10000 -> 10000 (pass through numbers)
 */
export declare function parsePriceToUsdc(price: string | number): string;
/**
 * Format USDC units to human readable price
 * 10000 -> '$0.01'
 * 1500000 -> '$1.50'
 */
export declare function formatUsdcToPrice(usdc: string | number): string;
