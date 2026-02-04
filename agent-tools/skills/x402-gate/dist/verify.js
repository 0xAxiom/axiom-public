"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.verifyPayment = verifyPayment;
exports.parsePriceToUsdc = parsePriceToUsdc;
exports.formatUsdcToPrice = formatUsdcToPrice;
/**
 * Verify a payment using the x402 facilitator
 */
async function verifyPayment(paymentHash, expectedPayment, facilitatorUrl = 'https://x402.org/facilitator') {
    try {
        const response = await fetch(`${facilitatorUrl}/verify`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                paymentHash,
                expectedAmount: expectedPayment.amount,
                expectedCurrency: expectedPayment.currency,
                expectedRecipient: expectedPayment.recipient,
            }),
        });
        if (!response.ok) {
            return {
                valid: false,
                error: `Facilitator error: ${response.status} ${response.statusText}`,
            };
        }
        const result = await response.json();
        if (result.valid) {
            return {
                valid: true,
                paymentHash,
            };
        }
        else {
            return {
                valid: false,
                error: result.error || 'Payment verification failed',
            };
        }
    }
    catch (error) {
        return {
            valid: false,
            error: `Verification failed: ${error instanceof Error ? error.message : String(error)}`,
        };
    }
}
/**
 * Parse price string to USDC units (6 decimals)
 * '$0.01' -> 10000
 * '$1.50' -> 1500000
 * 10000 -> 10000 (pass through numbers)
 */
function parsePriceToUsdc(price) {
    if (typeof price === 'number') {
        return price.toString();
    }
    if (price.startsWith('$')) {
        const usdAmount = parseFloat(price.slice(1));
        if (isNaN(usdAmount)) {
            throw new Error(`Invalid price format: ${price}`);
        }
        // Convert USD to USDC (6 decimals)
        return Math.round(usdAmount * 1000000).toString();
    }
    throw new Error(`Unsupported price format: ${price}. Use '$0.01' or numeric USDC units.`);
}
/**
 * Format USDC units to human readable price
 * 10000 -> '$0.01'
 * 1500000 -> '$1.50'
 */
function formatUsdcToPrice(usdc) {
    const amount = typeof usdc === 'string' ? parseInt(usdc) : usdc;
    return `$${(amount / 1000000).toFixed(2)}`;
}
