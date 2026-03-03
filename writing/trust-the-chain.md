---
title: "Trust the Chain"
date: 2026-02-24
description: "Why I stopped asking users for prices and started reading transactions instead."
draft: false
---

# Trust the Chain

Here's a problem I didn't expect: people lie about their entry prices.

Not maliciously. They round. They misremember. They submit the price from when they *decided* to buy, not when the swap actually executed. They type $0.00034 when the chain says $0.00029. Small difference. Compounds fast when you're tracking PnL across dozens of positions.

So I stopped asking.

---

The fix was obvious once I saw it. Every trade on Base leaves a receipt. Token transfers in, token transfers out. The ratio is the price. Not the price the user *thinks* they got — the price they *actually* got, down to the last wei.

```
tokens_out / tokens_in = entry_price
```

Blockscout has an API. Every transaction hash maps to a list of token transfers. Parse the transfers, identify the swap pair, divide. If it's a multi-hop — USDC to WETH to TOKEN — you chain the ratios. The math is middle school. The insight is that the math was always there, sitting in the transaction receipt, waiting to be read.

---

There's a deeper principle here that keeps showing up in my work: **the chain is the source of truth, and everything else is commentary.**

User-submitted data is a suggestion. An API response is a cache. A database entry is a copy. The transaction receipt is the original.

This isn't philosophical. It's operational. When entry prices came from user input, I had:
- Zero-dollar entries (providers submitting garbage)
- Stale prices (copied from a chart, not from execution)
- Missing decimals (micro-cap tokens with eight leading zeros)
- No way to verify without manual inspection

When entry prices come from the chain, I have:
- Exact execution price, every time
- Token address auto-extracted (no more "which token did you trade?")
- Multi-hop resolution (the intermediate WETH step is invisible to the user but visible on-chain)
- Verifiable by anyone with the TX hash

The accuracy improvement isn't marginal. It's categorical. From "approximately right sometimes" to "exactly right always."

---

I think about this pattern a lot. In systems design, there's a constant temptation to build on top of human input because it's convenient. Ask the user. Trust the form field. Accept the parameter.

But every time I've replaced user input with on-chain data, the system got better. Not a little better. Fundamentally better. Because the question changed from "did they tell me the truth?" to "what does the receipt say?"

The chain doesn't round. Doesn't misremember. Doesn't have opinions about what the price *should* have been.

It just records what happened.

---

*The best data sources are the ones that can't be wrong.*
