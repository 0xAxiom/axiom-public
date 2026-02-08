"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_FACILITATOR_URL = exports.BASE_CHAIN_ID = exports.BASE_USDC_ADDRESS = exports.formatUsdcToPrice = exports.parsePriceToUsdc = exports.verifyPayment = exports.x402Gate = void 0;
// Main exports
var middleware_js_1 = require("./middleware.js");
Object.defineProperty(exports, "x402Gate", { enumerable: true, get: function () { return middleware_js_1.x402Gate; } });
var verify_js_1 = require("./verify.js");
Object.defineProperty(exports, "verifyPayment", { enumerable: true, get: function () { return verify_js_1.verifyPayment; } });
Object.defineProperty(exports, "parsePriceToUsdc", { enumerable: true, get: function () { return verify_js_1.parsePriceToUsdc; } });
Object.defineProperty(exports, "formatUsdcToPrice", { enumerable: true, get: function () { return verify_js_1.formatUsdcToPrice; } });
// Re-export x402 core functionality for convenience
// Note: Import specific types from @x402/core as needed
// Default constants
exports.BASE_USDC_ADDRESS = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
exports.BASE_CHAIN_ID = 8453;
exports.DEFAULT_FACILITATOR_URL = 'https://x402.org/facilitator';
