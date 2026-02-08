import { Request, Response, NextFunction } from 'express';
import { X402GateConfig, RouteConfig, PaymentInfo } from './types.js';
import { verifyPayment, parsePriceToUsdc, formatUsdcToPrice } from './verify.js';

// Base USDC contract address
const BASE_USDC_ADDRESS = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';

/**
 * Create x402 payment gate middleware for Express
 */
export function x402Gate(config: X402GateConfig) {
  // Validate config
  if (!config.wallet || !config.wallet.startsWith('0x')) {
    throw new Error('Invalid wallet address. Must be a valid Ethereum address starting with 0x');
  }

  const chainId = config.chainId || 8453; // Base
  const usdcAddress = config.usdcAddress || BASE_USDC_ADDRESS;
  const defaultFacilitatorUrl = config.defaultFacilitatorUrl || 'https://x402.org/facilitator';

  return async (req: Request, res: Response, next: NextFunction) => {
    const route = `${req.method} ${req.path}`;
    const routeConfig = findMatchingRoute(config.routes, route);

    if (!routeConfig) {
      // No payment required for this route
      return next();
    }

    if (config.debug) {
      console.log(`x402-gate: Payment required for ${route}`);
    }

    // Check for payment header
    const paymentHeader = req.headers['x-payment-hash'] as string;
    
    if (!paymentHeader) {
      // No payment provided, return 402 with payment requirements
      return sendPaymentRequired(res, routeConfig, config.wallet, chainId, usdcAddress, defaultFacilitatorUrl);
    }

    // Verify the payment
    const facilitatorUrl = routeConfig.facilitatorUrl || defaultFacilitatorUrl;
    const expectedPayment: PaymentInfo = {
      amount: parsePriceToUsdc(routeConfig.price),
      currency: 'USDC',
      recipient: config.wallet,
      facilitator: facilitatorUrl,
      description: routeConfig.description,
    };

    try {
      const verification = await verifyPayment(paymentHeader, expectedPayment, facilitatorUrl);
      
      if (verification.valid) {
        if (config.debug) {
          console.log(`x402-gate: Payment verified for ${route}`);
        }
        return next();
      } else {
        if (config.debug) {
          console.log(`x402-gate: Payment verification failed: ${verification.error}`);
        }
        return res.status(402).json({
          error: 'Payment verification failed',
          details: verification.error,
        });
      }
    } catch (error) {
      if (config.debug) {
        console.error(`x402-gate: Verification error:`, error);
      }
      return res.status(500).json({
        error: 'Internal server error during payment verification',
      });
    }
  };
}

/**
 * Find matching route configuration
 * Supports exact matches like "GET /api/data"
 */
function findMatchingRoute(routes: Record<string, RouteConfig>, requestRoute: string): RouteConfig | null {
  // Try exact match first
  if (routes[requestRoute]) {
    return routes[requestRoute];
  }

  // Try wildcard matching (future enhancement)
  for (const [pattern, config] of Object.entries(routes)) {
    if (pattern.includes('*') && matchesWildcard(pattern, requestRoute)) {
      return config;
    }
  }

  return null;
}

/**
 * Simple wildcard matching for routes
 */
function matchesWildcard(pattern: string, route: string): boolean {
  const regex = new RegExp(pattern.replace(/\*/g, '.*'));
  return regex.test(route);
}

/**
 * Send 402 Payment Required response with x402 headers
 */
function sendPaymentRequired(
  res: Response,
  routeConfig: RouteConfig,
  wallet: string,
  chainId: number,
  usdcAddress: string,
  facilitatorUrl: string
) {
  const amount = parsePriceToUsdc(routeConfig.price);
  const priceDisplay = formatUsdcToPrice(amount);

  // Set x402 headers according to the protocol
  res.setHeader('Accept-Payment', 'x402');
  res.setHeader('Payment-Amount', amount);
  res.setHeader('Payment-Currency', 'USDC');
  res.setHeader('Payment-Recipient', wallet);
  res.setHeader('Payment-Facilitator', facilitatorUrl);
  res.setHeader('Payment-Chain-Id', chainId.toString());
  res.setHeader('Payment-Token-Address', usdcAddress);

  return res.status(402).json({
    error: 'Payment Required',
    message: `Payment of ${priceDisplay} required to access this endpoint`,
    payment: {
      amount,
      currency: 'USDC',
      recipient: wallet,
      facilitator: facilitatorUrl,
      chainId,
      tokenAddress: usdcAddress,
      description: routeConfig.description,
    },
    instructions: {
      step1: 'Use a compatible x402 client like @x402/fetch',
      step2: 'The client will automatically handle USDC payment on Base',
      step3: 'Include the payment hash in X-Payment-Hash header',
    },
  });
}