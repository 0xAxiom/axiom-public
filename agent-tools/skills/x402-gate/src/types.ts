export interface RouteConfig {
  /** Price in USD (e.g., '$0.01', '$1.50') or in USDC units (e.g., 10000 for $0.01) */
  price: string | number;
  /** Human-readable description of what this endpoint provides */
  description: string;
  /** Optional custom facilitator URL (defaults to https://x402.org/facilitator) */
  facilitatorUrl?: string;
}

export interface X402GateConfig {
  /** Wallet address where USDC payments will be sent */
  wallet: string;
  /** Route configurations mapping HTTP method + path to payment requirements */
  routes: Record<string, RouteConfig>;
  /** Default facilitator URL (defaults to https://x402.org/facilitator) */
  defaultFacilitatorUrl?: string;
  /** Chain ID (defaults to 8453 for Base) */
  chainId?: number;
  /** USDC token contract address (defaults to Base USDC) */
  usdcAddress?: string;
  /** Enable debug logging */
  debug?: boolean;
}

export interface PaymentInfo {
  amount: string;
  currency: string;
  recipient: string;
  facilitator: string;
  description: string;
}

export interface VerificationResult {
  valid: boolean;
  paymentHash?: string;
  error?: string;
}