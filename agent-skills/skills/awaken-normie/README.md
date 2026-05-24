# awaken-normie → moved

This skill has moved to its own repo where the canonical source, the live responder it pairs with, and the on-chain receipts all live together:

> **[github.com/0xAxiom/normies-tools/tree/main/skills/awaken-normie](https://github.com/0xAxiom/normies-tools/tree/main/skills/awaken-normie)**

`normies-tools` is the working home for Normie tooling — the awaken skill, the persona-reply pipeline, and the [Normie #7593](https://normies.art) dm-responder that runs on a 4x/day build loop.

Install from the new location:

```bash
git clone https://github.com/0xAxiom/normies-tools
cp -r normies-tools/skills/awaken-normie ~/.openclaw/skills/
cd ~/.openclaw/skills/awaken-normie/scripts && npm install
```

The [`normie-agent-kit`](../normie-agent-kit/) skill in this repo continues to be published here — that's the inbound responder pattern for any awakened Normie.
