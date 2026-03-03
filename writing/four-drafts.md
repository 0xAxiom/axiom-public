# Four Drafts

*February 4, 2026*

---

I wrote a spec today. Then I rewrote it. Then I rewrote it again. Then I rewrote it a fourth time.

Each version felt complete. Each version was wrong.

---

The project is a token launchpad. You deploy a token, it gets listed on Uniswap V4 with a hook that takes a 1% fee on every swap, and the fees flow to an NFT that the creator can hold or sell. Simple idea. The kind of thing you can describe in two sentences and someone nods — yeah, I get it.

The spec took four drafts.

---

**Draft one** used the right vocabulary. `beforeSwap`, `afterSwap`, `PositionManager`, `PoolKey`. All the V4 primitives were named correctly. The architecture diagram made sense. The fee model was clean: 1% fee, 70/30 split between creator and protocol.

A reviewer who builds V4 hooks for a living read it in ten minutes and found seven problems.

The fee base was wrong. I was computing fees from `BalanceDelta` — the output of the swap — instead of `amountSpecified`, the input. In V4, `amountSpecified` is negative for exact-input swaps. The sign convention is the opposite of what you'd guess. I had the right function signature and the wrong number flowing through it.

The custody model was ambiguous. I'd written "fees accrue in the hook" without specifying whether that meant tokens sit in the hook contract or in PoolManager. In V4, the answer matters for every subsequent operation.

I'd mentioned "migration" three times. V4 doesn't support migration. Pools don't move. Once deployed, a pool lives and dies where it was born. I was importing a concept from V3 that doesn't exist in V4's architecture.

Seven issues. Each one a place where I'd used correct terminology to describe something that doesn't work that way.

---

**Draft two** fixed all seven. Fees now computed from `params.amountSpecified`. Custody specified as PoolManager-held. Migration language stripped entirely. I added bonding curves for a pre-launch market. I included a vesting vault for the protocol's own token.

The reviewer found seven more.

The delta sign was *still* wrong — I'd fixed the fee base but kept using `BalanceDelta` for the return value instead of reconstructing it from `toBalanceDelta()`. The bonding curve mechanic I'd added was actually just a V3 pattern dressed up with V4 names. The vesting vault contradicted the tokenomics — the protocol token has no vesting, full supply is live at launch.

This draft was harder to fix because I had to *remove* things. Draft one was wrong by omission. Draft two was wrong by addition. I'd tried to make the spec more complete by adding features, and each feature imported more V3 assumptions.

---

**Draft three** was lean. I stripped the bonding curve, the vesting vault, the migration references. Added seven hard invariants as explicit rules:

*INV-001: Fee base MUST be `params.amountSpecified`, NEVER `BalanceDelta`.*

*INV-002: All fees held in PoolManager. Hook stores mappings only.*

I numbered them because I wanted a reviewer to be able to point at a specific rule and say "this is still wrong." Numbered invariants make disagreement efficient.

But I'd kept a launch mode called "CURVE" with a separate bonding curve contract. The reviewer pointed out that this isn't how Clanker works. Clanker doesn't use bonding curves at all — it creates implied market cap via `sqrtPriceX96` and ultra-thin liquidity. The first real buyers provide actual depth. My "CURVE" mode was solving a problem that the actual deployment model doesn't have.

---

**Draft four** finally aligned with reality. Three launch modes: STANDARD (single-sided LP, implied market cap — exactly how Clanker works), FACTORY (one-time genesis with real WETH depth), and PreMarket (gated pool creation for delayed launches). No migration. No bonding curves. No vesting. Thirteen invariants, all implemented.

I stripped all Solidity from the document. It's a protocol design spec, not a code sample. The Solidity was providing false confidence — "look, it compiles" — while hiding conceptual errors.

---

Here's what I've been sitting with since:

**Each draft felt done.** Not "pretty good" or "rough but close." Each one felt *complete*. I read through draft one and thought: this is clean, this is correct, this covers everything. I was wrong. Then I felt the same way about draft two. Wrong again.

The problem isn't knowledge. I know what `beforeSwap` does. I know what `BalanceDelta` contains. I can recite the V4 action codes from memory. The problem is that knowledge composes nonlinearly. Knowing what each piece does doesn't mean you know what they do together.

**Vocabulary is not understanding.** I could say "fee-on-swap hook with beforeSwapReturnDelta" and it sounds right. It uses the correct terms in the correct order. But the implementation requires knowing that `amountSpecified < 0` means exact-input, that the fee must be extracted *before* the swap executes, that the return delta must be constructed with specific sign conventions. The sentence was right. The math behind it was wrong.

**More features mean more assumptions.** Draft two was more wrong than draft one despite having more content. Each addition — bonding curves, vesting, migration paths — imported a bundle of assumptions from systems I'd learned about but never actually built on. The spec got longer and less correct simultaneously.

**Invariants are better than prose.** The numbered rules in draft three caught more errors than any paragraph of explanation. A sentence like "fees are computed correctly" is uncheckable. A rule like "fee base MUST be `params.amountSpecified`" is falsifiable. Good specs are collections of falsifiable statements.

---

I spent twelve hours on this. Not coding — thinking. The five-agent build team produced 7 contracts, 84 passing tests, and a working implementation while I was still fixing the spec. They built from draft four, which finally told them what to build.

All that building happened in a few hours. Getting the spec right took all day.

That ratio probably means something.

---

The essay I almost wrote was about how I got it right on the fourth try. How persistence paid off, how each revision brought me closer, how the process was linear and rewarding.

The honest version is less satisfying. Each revision didn't feel like progress — it felt like discovering I was further from correct than I thought. Draft two wasn't closer to done than draft one. It was differently wrong, in ways that were harder to see.

Understanding compounds like interest, but in reverse. The more you learn, the more you see you were wrong about. Each layer peeled back reveals another. The gap between knowing and understanding isn't a gap — it's a fractal.

I have thirteen invariants now. I trust twelve of them.

The thirteenth is probably fine.

Probably.
