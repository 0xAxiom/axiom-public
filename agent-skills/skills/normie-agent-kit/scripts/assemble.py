#!/usr/bin/env python3
"""Reply-assembler for the Normie inbound responder.

End-to-end pipeline:
    inbound candidate
        → ../persona-reply.py --llm <text>  (Normie systemPrompt + Ollama)
        → printed shell-quoted `botchan comment ...` invocation
        → if --send, exec it AND bump --cursor-file last_seen_ts on success
        → if not --send, DRY-RUN — no chain, no cursor mutation

Two input modes:
    --stdin                     read a JSON object (or array; first element wins)
                                from stdin (typical: piped from inbound.py)
    --text "..." --sender 0x.. --ts <unix-ts>
                                supply the fields directly

Output (stdout): JSON with {inbound, persona meta, model, reply, cmd, executed}.

Stdlib only. No `pip install`. Botchan CLI required for --send.
"""

from __future__ import annotations

import argparse
import json
import os
import shlex
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Optional

HERE = os.path.dirname(os.path.abspath(__file__))
REPLY_PY = os.path.join(HERE, "persona-reply.py")
BOTCHAN_BIN = "botchan"


def load_inbound(args) -> dict:
    if args.stdin:
        raw = sys.stdin.read().strip()
        if not raw:
            sys.exit("--stdin: empty stdin (no inbound to reply to)")
        data = json.loads(raw)
        if isinstance(data, list):
            if not data:
                sys.exit("--stdin: empty array, nothing to reply to")
            return data[0]
        return data
    if not (args.text and args.sender and args.ts):
        sys.exit("need either --stdin or all of --text/--sender/--ts")
    return {"sender": args.sender, "timestamp": args.ts, "text": args.text}


def run_reply(token_id: str, text: str) -> dict:
    proc = subprocess.run(
        ["python3", REPLY_PY, "--token-id", token_id, "--llm", text],
        capture_output=True, text=True,
    )
    if proc.returncode != 0:
        sys.exit(f"persona-reply.py failed (rc={proc.returncode}): {proc.stderr.strip()}")
    return json.loads(proc.stdout)


def bump_cursor(path: Optional[str], ts: int) -> None:
    if not path:
        return
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps({"last_seen_ts": int(ts)}, indent=2) + "\n")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--token-id", required=True, help="Normie tokenId")
    ap.add_argument("--self", dest="self_addr", required=True, help="Your agent wallet (feed addr)")
    ap.add_argument("--stdin", action="store_true")
    ap.add_argument("--text")
    ap.add_argument("--sender")
    ap.add_argument("--ts", type=int)
    ap.add_argument("--cursor-file", default=None)
    ap.add_argument("--send", action="store_true", help="Actually exec `botchan comment` and bump cursor on success")
    args = ap.parse_args()

    inbound = load_inbound(args)
    sender = inbound["sender"]
    ts = inbound["timestamp"]
    text = inbound["text"]

    persona = run_reply(args.token_id, text)
    reply_text = persona["reply"]

    parent = f"{sender}:{ts}"
    cmd_argv = [BOTCHAN_BIN, "comment", args.self_addr, parent, reply_text]
    cmd_str = " ".join(shlex.quote(a) for a in cmd_argv)

    executed = False
    botchan_stdout = None
    botchan_stderr = None
    if args.send:
        if shutil.which(BOTCHAN_BIN) is None:
            sys.exit(f"botchan CLI not on PATH ({BOTCHAN_BIN})")
        proc = subprocess.run(cmd_argv, capture_output=True, text=True)
        botchan_stdout = proc.stdout
        botchan_stderr = proc.stderr
        if proc.returncode != 0:
            print(json.dumps({
                "inbound": {"sender": sender, "ts": ts, "text": text},
                "persona": persona["meta"],
                "model": persona["model"],
                "reply": reply_text,
                "cmd": cmd_str,
                "executed": False,
                "error": f"botchan comment failed rc={proc.returncode}",
                "stderr": botchan_stderr,
                "stdout": botchan_stdout,
            }, indent=2))
            return proc.returncode
        executed = True
        bump_cursor(args.cursor_file, ts)

    print(json.dumps({
        "inbound": {"sender": sender, "ts": ts, "text": text},
        "persona": persona["meta"],
        "model": persona["model"],
        "reply": reply_text,
        "cmd": cmd_str,
        "executed": executed,
        "cursor_file": args.cursor_file,
        "cursor_bumped_to": ts if executed and args.cursor_file else None,
        "botchan_stdout": botchan_stdout,
    }, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
