# Bankr Signals Position Manager

Server-side position management for bankrsignals.com:
- Fetches current prices from DexScreener
- Calculates real-time PnL for all open signals
- Auto-closes positions on SL/TP hit or 48h expiry
- Opposite signal auto-close (SHORT closes existing LONG)
- Runs every 5 minutes

## Architecture
- Next.js API route at `/api/cron/position-manager`
- Supabase for signal storage
- DexScreener + Yahoo Finance for multi-asset pricing
- Curl-authenticated cron trigger
