#!/usr/bin/env python3
"""Persona-reply for an awakened Normie.

Fetches the Normie's live persona from https://api.normies.art/agents/info/<tokenId>
and feeds the `systemPrompt` into a local Ollama model, with the inbound text as
the user message. Prints either the assembled prompt (default) or the model's
reply (--llm).

Persona is regenerated server-side on every read — name + type stable per
tokenId, backstory / personality / systemPrompt evolve with canvas state.

Usage:
    python3 persona-reply.py --token-id 7593                   # print prompt
    python3 persona-reply.py --token-id 7593 "Why monochrome?" # custom q, print
    python3 persona-reply.py --token-id 7593 --llm             # default q, LLM
    python3 persona-reply.py --token-id 7593 --llm "Hello"     # custom q, LLM
    OLLAMA_MODEL=gemma3:27b python3 persona-reply.py --token-id 7593 --llm

Stdlib only. No on-chain calls.
"""

import argparse
import json
import os
import sys
import urllib.request

DEFAULT_Q = "Introduce yourself in one sentence."
NORMIES_INFO = "https://api.normies.art/agents/info/{tid}"
OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://localhost:11434/api/chat")
DEFAULT_MODEL = os.environ.get("OLLAMA_MODEL", "llama3.2:3b")


def fetch_persona(token_id: str) -> dict:
    url = NORMIES_INFO.format(tid=token_id)
    with urllib.request.urlopen(url, timeout=15) as resp:
        return json.load(resp)


def assemble(persona: dict, question: str) -> dict:
    return {
        "model_input": {
            "system": persona["systemPrompt"],
            "user": question,
        },
        "meta": {
            "tokenId": persona.get("tokenId"),
            "agentId": persona.get("agentId"),
            "name": persona.get("name"),
            "type": persona.get("type"),
            "registeredAt": persona.get("registeredAt"),
            "system_prompt_chars": len(persona.get("systemPrompt", "")),
        },
    }


def call_llm(system: str, user: str, model: str) -> str:
    payload = json.dumps({
        "model": model,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        "stream": False,
        "think": False,
    }).encode()
    req = urllib.request.Request(
        OLLAMA_URL, data=payload, headers={"Content-Type": "application/json"}
    )
    with urllib.request.urlopen(req, timeout=300) as resp:
        body = json.load(resp)
    return body.get("message", {}).get("content", "").strip()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--token-id", required=True, help="Normie tokenId")
    ap.add_argument("--llm", action="store_true", help="Call Ollama; otherwise just print the assembled prompt")
    ap.add_argument("question", nargs="?", default=DEFAULT_Q)
    args = ap.parse_args()

    persona = fetch_persona(args.token_id)
    out = assemble(persona, args.question)

    if not args.llm:
        print(json.dumps(out, indent=2))
        return 0

    mi = out["model_input"]
    reply = call_llm(mi["system"], mi["user"], DEFAULT_MODEL)
    print(json.dumps({
        "meta": out["meta"],
        "model": DEFAULT_MODEL,
        "question": args.question,
        "reply": reply,
    }, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
