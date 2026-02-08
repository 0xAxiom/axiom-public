# Bankr Leaderboard API Reference

**Base URL:** `https://api.bankr.bot/leaderboard`

No authentication required. All endpoints return JSON.

---

## GET /rankings

Fetch paginated leaderboard rankings.

**URL:** `/rankings?timeframe=total&limit=20&type=total&cursor=0`

**Parameters:**

| Param | Type | Required | Values | Default |
|-------|------|----------|--------|---------|
| timeframe | string | no | `24h`, `7d`, `30d`, `total` | `total` |
| limit | number | no | Must be `20` (fixed) | 20 |
| type | string | no | `total`, `staking`, `bnkr`, `earn`, `pnl`, `referral`, `nft`, `booster` | `total` |
| cursor | number | no | Multiples of 20 | 0 |

**Pagination:** Cursor-based. Each page returns up to 20 results. Increment `cursor` by 20 for the next page (cursor=0, cursor=20, cursor=40, etc.). Do NOT use offset math — the cursor IS the offset.

**Response:**
```json
{
  "data": [
    {
      "accountId": "1204220275543433217",
      "username": "thatdudeboz",
      "profileImageUrl": "https://pbs.twimg.com/...",
      "platform": "twitter",
      "rank": 1,
      "scores": {
        "total": { "score": 0.468, "raw": 0.468 },
        "staking": { "score": 0.409, "raw": 98003.45 },
        "bnkr": { "score": 1.0, "raw": 495388.84 },
        "earn": { "score": 0.007, "raw": 232.23 },
        "pnl": { "score": 0.370, "raw": 75333.29 },
        "nft": { "score": 0.068, "raw": 2 },
        "referral": { "score": 0, "raw": 0 },
        "partner": { "score": 0.00004, "raw": 6.68 },
        "mindshare": { "score": 0, "raw": 0 }
      },
      "totalScore": 0.468
    }
  ]
}
```

---

## GET /users/{accountId}/profile

Fetch a user's profile including wallet address.

**URL:** `/users/1204220275543433217/profile`

**Response:**
```json
{
  "accountId": "1204220275543433217",
  "username": "thatdudeboz",
  "walletAddress": "0x9524037a72f13b1fbc632653bcc71de3f496d2a8",
  "socials": {
    "twitter": "thatdudeboz"
  },
  "profilePicture": "https://pbs.twimg.com/...",
  "rank": 1,
  "totalScore": 0.468
}
```

---

## GET /users/{accountId}/scores

Detailed score breakdown for a user within a timeframe.

**URL:** `/users/1204220275543433217/scores?timeframe=24h`

**Parameters:**

| Param | Type | Values |
|-------|------|--------|
| timeframe | string | `24h`, `7d`, `30d`, `total` |

**Response:** Score object with category breakdowns (same structure as scores in rankings).

---

## GET /tree-map

Top traders visualization data.

**URL:** `/tree-map?timeframe=24h&limit=10`

**Parameters:**

| Param | Type | Values |
|-------|------|--------|
| timeframe | string | `24h`, `7d`, `30d`, `total` |
| limit | number | Number of traders to include |

---

## GET /users/booster-coins

List of booster coins.

**URL:** `/users/booster-coins`

**Response:** Array of booster coin objects.

---

## Notes

### Pagination
- Uses **cursor**, not offset or page number
- Cursor increments by 20 (the page size)
- Page 1: `cursor=0`, Page 2: `cursor=20`, Page 3: `cursor=40`
- Empty `data` array means no more results

### Rate Limiting
- No documented rate limits, but be respectful
- Recommended: 80ms delay between sequential requests
- Bulk wallet resolution (~200 users) takes about 16 seconds

### Score Types
- **total** — weighted combination of all categories
- **staking** — BNKR token staking amount
- **bnkr** — BNKR trading volume
- **earn** — earnings from the platform
- **pnl** — profit and loss from trading
- **referral** — referral program points
- **nft** — NFT-related score
- **booster** — booster coin multiplier

### Account IDs
- Account IDs are Twitter/X user IDs (numeric strings)
- The `platform` field is typically `"twitter"`
- Usernames correspond to Twitter handles
