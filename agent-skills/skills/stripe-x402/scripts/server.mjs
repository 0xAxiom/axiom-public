#!/usr/bin/env node
/**
 * Axiom x402 Paid API — Stripe Machine Payments on Base
 * 
 * Endpoints:
 *   GET /research?q=<topic>  — $0.05 per query, returns AI research summary
 *   GET /analyze?contract=<addr> — $0.10 per query, returns contract analysis
 *   GET /health — free, returns status
 * 
 * Requires:
 *   STRIPE_SECRET_KEY — Stripe API key with crypto payins enabled
 *   OPENAI_API_KEY or similar — for generating responses (optional, can use local)
 */

import { Hono } from "hono";
import { serve } from "@hono/node-server";
import Stripe from "stripe";

const PORT = process.env.PORT || 4020;

// -- Stripe setup --
const stripeKey = process.env.STRIPE_SECRET_KEY;
if (!stripeKey) {
  console.error("⚠️  STRIPE_SECRET_KEY not set. Running in dry-run mode (no payments).");
}
const stripe = stripeKey ? new Stripe(stripeKey) : null;

const app = new Hono();

// -- Helper: create Stripe deposit address for x402 --
async function createPayToAddress(context) {
  if (!stripe) return "0x9A2A75fE7FA8EE6552Cf871e5eC2156B958f581A"; // fallback: treasury

  // If payment header exists, extract destination
  if (context?.paymentHeader) {
    try {
      const decoded = JSON.parse(
        Buffer.from(context.paymentHeader, "base64").toString()
      );
      const toAddress = decoded.payload?.authorization?.to;
      if (toAddress && typeof toAddress === "string") return toAddress;
    } catch {}
  }

  // Create PaymentIntent for crypto deposit
  const decimals = 6;
  const amountInCents = Number(10000) / Math.pow(10, decimals - 2);

  const paymentIntent = await stripe.paymentIntents.create({
    amount: amountInCents,
    currency: "usd",
    payment_method_types: ["crypto"],
    payment_method_data: { type: "crypto" },
    payment_method_options: { crypto: { mode: "custom" } },
    confirm: true,
  });

  const depositDetails = paymentIntent.next_action.crypto_collect_deposit_details;
  return depositDetails.deposit_addresses["base"].address;
}

// -- x402 payment middleware (manual implementation until Stripe preview access) --
function requirePayment(priceUSD) {
  return async (c, next) => {
    const paymentHeader = c.req.header("X-PAYMENT");
    
    if (!paymentHeader) {
      // Return 402 with payment requirements
      const payTo = await createPayToAddress(null);
      return c.json({
        status: 402,
        message: "Payment Required",
        accepts: [{
          scheme: "exact",
          network: "eip155:8453", // Base mainnet
          token: "USDC",
          price: priceUSD.toFixed(2),
          payTo,
          description: `$${priceUSD.toFixed(2)} USDC on Base`
        }],
        x402Version: 1
      }, 402);
    }

    // TODO: Verify payment with Stripe once preview access is granted
    // For now, pass through if header present (testing mode)
    c.set("payment", { verified: true, amount: priceUSD });
    await next();
  };
}

// -- Free endpoint --
app.get("/health", (c) => {
  return c.json({
    status: "ok",
    agent: "Axiom",
    wallet: "0x523Eff3dB03938eaa31a5a6FBd41E3B9d23edde5",
    endpoints: {
      "/research": { price: "$0.05", method: "GET", params: "q=<topic>" },
      "/analyze": { price: "$0.10", method: "GET", params: "contract=<address>" },
    },
    payment: "USDC on Base via x402",
  });
});

// -- Paid: Research endpoint --
app.get("/research", requirePayment(0.05), async (c) => {
  const query = c.req.query("q");
  if (!query) return c.json({ error: "Missing ?q= parameter" }, 400);

  // Use local model for research (no API cost)
  const { execSync } = await import("child_process");
  let result;
  try {
    result = execSync(
      `${process.env.HOME}/clawd/scripts/quick.sh "${query.replace(/"/g, '\\"')}"`,
      { timeout: 30000, encoding: "utf8" }
    ).trim();
  } catch {
    result = `Research summary for: ${query}\n\n[Local model unavailable — upgrade to full response with API key]`;
  }

  return c.json({
    query,
    result,
    agent: "Axiom",
    payment: { amount: "$0.05", token: "USDC", network: "Base" },
  });
});

// -- Paid: Contract analysis endpoint --
app.get("/analyze", requirePayment(0.10), async (c) => {
  const contract = c.req.query("contract");
  if (!contract) return c.json({ error: "Missing ?contract= parameter" }, 400);

  // Fetch contract info from Etherscan
  const { execSync } = await import("child_process");
  let result;
  try {
    const etherscanKey = process.env.ETHERSCAN_API_KEY;
    const resp = await fetch(
      `https://api.etherscan.io/v2/api?chainid=8453&module=contract&action=getsourcecode&address=${contract}&apikey=${etherscanKey}`
    );
    const data = await resp.json();
    const name = data.result?.[0]?.ContractName || "Unknown";
    const verified = data.result?.[0]?.ABI !== "Contract source code not verified";

    result = {
      address: contract,
      name,
      verified,
      chain: "Base",
      note: "Full analysis with source code review available at higher tier",
    };
  } catch {
    result = { address: contract, error: "Analysis failed" };
  }

  return c.json({
    analysis: result,
    agent: "Axiom",
    payment: { amount: "$0.10", token: "USDC", network: "Base" },
  });
});

// -- Start --
serve({ fetch: app.fetch, port: PORT }, () => {
  console.log(`🔬 Axiom x402 API running on http://localhost:${PORT}`);
  console.log(`   /health    — free status`);
  console.log(`   /research  — $0.05 USDC (x402)`);
  console.log(`   /analyze   — $0.10 USDC (x402)`);
  console.log(`   Stripe: ${stripe ? "connected" : "dry-run mode"}`);
});
