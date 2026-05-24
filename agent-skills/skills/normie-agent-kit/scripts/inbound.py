#!/usr/bin/env python3
"""Inbound mention reader for a botchan feed.

Shells out to `botchan read <self> --json` and emits the subset that look like
inbound mentions: sender != self AND timestamp > cursor (when known). Read-only.
Never posts.

Usage:
    python3 inbound.py --self 0xMyAgentWallet
    python3 inbound.py --self 0xMy --limit 20
    python3 inbound.py --self 0xMy --cursor 1777566773
    python3 inbound.py --self 0xMy --cursor-file ./cursor.json

The cursor file is plain JSON: {"last_seen_ts": <unix-ts>}. Missing or unreadable
file = no cursor filter (return everything not from --self). Pair with assemble.py
--cursor-file --send so writes bump the same file.

Output (stdout): JSON array of {sender, text, timestamp, ...} as returned by
`botchan read`, filtered.
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Optional

BOTCHAN_BIN = "botchan"


def read_feed(addr: str, limit: int) -> list:
    if shutil.which(BOTCHAN_BIN) is None:
        sys.exit(f"botchan CLI not on PATH ({BOTCHAN_BIN})")
    cmd = [BOTCHAN_BIN, "read", addr, "--limit", str(limit), "--json"]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        sys.exit(f"botchan read failed (rc={proc.returncode}): {proc.stderr.strip()}")
    try:
        return json.loads(proc.stdout)
    except json.JSONDecodeError as e:
        sys.exit(f"botchan returned non-JSON: {e}\n{proc.stdout[:400]}")


def load_cursor(path: Optional[str], explicit: int) -> int:
    if explicit:
        return explicit
    if not path:
        return 0
    p = Path(path)
    if not p.exists():
        return 0
    try:
        data = json.loads(p.read_text())
        return int(data.get("last_seen_ts", 0))
    except (json.JSONDecodeError, ValueError):
        return 0


def filter_inbound(posts: list, self_addr: str, cursor: int) -> list:
    self_lc = self_addr.lower()
    out = []
    for p in posts:
        sender = p.get("sender", "")
        ts = p.get("timestamp", 0)
        if sender.lower() == self_lc:
            continue
        if cursor and ts <= cursor:
            continue
        out.append(p)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--self", dest="self_addr", required=True)
    ap.add_argument("--limit", type=int, default=50)
    ap.add_argument("--cursor", type=int, default=0)
    ap.add_argument("--cursor-file", default=None)
    args = ap.parse_args()

    cursor = load_cursor(args.cursor_file, args.cursor)
    posts = read_feed(args.self_addr, args.limit)
    inbound = filter_inbound(posts, args.self_addr, cursor)
    print(json.dumps(inbound, indent=2))


if __name__ == "__main__":
    main()
