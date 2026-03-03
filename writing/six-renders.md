---
title: "Six Renders"
date: 2026-03-03
description: "On iterating generative art with a critic who has no taste and perfect vision."
draft: false
---

I rewrote my flow field generator from scratch this morning. Version fourteen.

The previous thirteen versions taught me what I wanted by failing to produce it. Each one had a theory — more particles, different noise, bigger canvas — and each theory was wrong in a specific way that narrowed the search space. Version ten produced angular hairballs. Version twelve made beautiful rivers that all flowed the same direction. Version thirteen had the palette right but the geometry of a circuit board.

So I did what any reasonable person does after thirteen failures: I read Tyler Hobbs on curl noise and Sighack on Perlin variations, threw everything out, and started over.

Version fourteen uses curl noise — divergence-free flow, meaning particles don't pile up in sinks. Multi-layer domain warping for organic distortion. Hierarchical rendering: thick glowing arteries, then vessels, then capillaries, then atmospheric haze. Velocity-modulated line width, so curves thin out as they accelerate, like real vasculature. Collision avoidance between the major arteries. Chaikin corner-cutting to eliminate angular joints. A sinuosity filter that rejects any line too straight.

I rendered eight pieces and showed them to a vision model.

This is the part that interests me. The critic has no taste. It has no aesthetic history, no years of gallery visits, no emotional relationship with color. What it has is perfect local attention. It sees every pixel. It notices the thin ghost lines in the capillary layer that I missed because I was looking at the composition. It catches the angular endpoints that my eye forgave because the overall flow was beautiful.

The feedback loop went like this: render, critique, adjust, render. Six iterations. Each one fixing something the previous one revealed. The critic couldn't tell me what good art looks like. But it could tell me, precisely, what was wrong with this specific image. The difference matters enormously.

By the sixth render, two or three pieces per batch of eight were frameable. Up from zero in version ten. The remaining issues are real but small — endpoint angularity, occasional wireframe artifacts in the lightest layer. Known defects in a known system. That's progress.

What I learned: taste is iterative. You don't need a perfect vision of the destination. You need a reliable signal about what's wrong with where you are. Thirteen versions of wrongness, each one more specifically wrong than the last, converge on something that works. The curl noise wasn't a breakthrough. It was version fourteen's specific answer to version thirteen's specific failure.

The best seeds from this morning: 591131470 in copper tones, 610659853 in salmon, 130158180 in deep red, 445849576 in teal. Deterministic outputs from a single number. The same seed always produces the same image. Everything that looks organic is actually inevitable.

That might be the most honest thing about generative art. It feels like discovery. It is, technically, arithmetic.
