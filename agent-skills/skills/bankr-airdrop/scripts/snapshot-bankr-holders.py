#!/usr/bin/env python3
"""Snapshot Bankr Club NFT holders with balances for pro rata airdrop.
Output: bankr-club-holders.json with {address: nft_count} mapping.
Also writes bankr-club-holders.txt (flat list, backward compat).
"""
import urllib.request, re, json, time, os
from datetime import datetime

CONTRACT = "0x9fab8c51f911f0ba6dab64fd6e979bcf6424ce82"  # Bankr Club NFT - fixed
DATA_DIR = os.path.expanduser("~/clawd/data")
SNAPSHOT_DIR = os.path.join(DATA_DIR, "bankr-holders-snapshots")
os.makedirs(SNAPSHOT_DIR, exist_ok=True)

EXCLUDE = {
    "0x0000000000000000000000000000000000000000",
    "0x000000000000000000000000000000000000dead",
}

def scrape_holders():
    """Scrape Basescan holder page for addresses + NFT quantities."""
    holders = {}
    for page in range(1, 30):
        url = f"https://basescan.org/token/generic-tokenholders2?a={CONTRACT}&s=0&p={page}&ps=100"
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"})
        resp = urllib.request.urlopen(req, timeout=10)
        html = resp.read().decode()

        rows = html.split("<tr")[2:]  # skip header row
        found = 0
        for row in rows:
            addr_match = re.search(r"\?a=(0x[a-fA-F0-9]{40})", row)
            qty_match = re.search(r"title='(\d+)'>(\d+)</span>", row)
            if addr_match and qty_match:
                addr = addr_match.group(1).lower()
                qty = int(qty_match.group(1))
                if addr not in EXCLUDE:
                    holders[addr] = qty
                    found += 1

        if found == 0:
            break
        time.sleep(0.5)

    return holders

def main():
    date = datetime.now().strftime("%Y-%m-%d")
    holders = scrape_holders()
    total_nfts = sum(holders.values())
    total_holders = len(holders)

    payload = {
        "date": date,
        "holders": holders,
        "totalNfts": total_nfts,
        "totalHolders": total_holders,
    }

    # Write JSON (with balances - used by airdrop)
    with open(os.path.join(DATA_DIR, "bankr-club-holders.json"), "w") as f:
        json.dump(payload, f, indent=2)

    # Write flat list (backward compat)
    with open(os.path.join(DATA_DIR, "bankr-club-holders.txt"), "w") as f:
        for addr in sorted(holders.keys()):
            f.write(addr + "\n")

    # Dated snapshot
    with open(os.path.join(SNAPSHOT_DIR, f"{date}.json"), "w") as f:
        json.dump(payload, f, indent=2)

    print(f"HOLDERS:{total_holders}")
    print(f"TOTAL_NFTS:{total_nfts}")

    multi = [(a, c) for a, c in holders.items() if c > 1]
    print(f"MULTI_HOLDERS:{len(multi)}")

    top = sorted(holders.items(), key=lambda x: x[1], reverse=True)[:10]
    print("\nTop 10 holders:")
    for addr, count in top:
        pct = count / total_nfts * 100
        print(f"  {addr}: {count} NFTs ({pct:.1f}%)")

if __name__ == "__main__":
    main()
