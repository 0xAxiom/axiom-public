#!/bin/bash
# Track outreach contacts
# Usage: track.sh <list|add|sent|status> [username] [status]

set -euo pipefail

DATA_DIR="${HOME}/.outreach"
CONTACTS="${DATA_DIR}/contacts.json"

mkdir -p "$DATA_DIR"
[ -f "$CONTACTS" ] || echo '{}' > "$CONTACTS"

ACTION="${1:?Usage: track.sh <list|add|sent|status> [username] [status]}"

case "$ACTION" in
  list)
    jq '.' "$CONTACTS"
    ;;
  add)
    USERNAME="${2:?Username required}"
    STATUS="${3:-discovered}"
    TIMESTAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)
    jq --arg u "$USERNAME" --arg s "$STATUS" --arg t "$TIMESTAMP" \
      '.[$u] = (.[$u] // {}) + {status: $s, updated: $t, history: ((.[$u].history // []) + [{status: $s, at: $t}])}' \
      "$CONTACTS" > "${CONTACTS}.tmp" && mv "${CONTACTS}.tmp" "$CONTACTS"
    echo "Added $USERNAME as $STATUS"
    ;;
  sent)
    USERNAME="${2:?Username required}"
    TIMESTAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)
    jq --arg u "$USERNAME" --arg t "$TIMESTAMP" \
      '.[$u].status = "sent" | .[$u].updated = $t | .[$u].sent_at = $t | .[$u].history += [{status: "sent", at: $t}]' \
      "$CONTACTS" > "${CONTACTS}.tmp" && mv "${CONTACTS}.tmp" "$CONTACTS"
    echo "Marked $USERNAME as sent"
    ;;
  status)
    USERNAME="${2:?Username required}"
    jq --arg u "$USERNAME" '.[$u] // "not found"' "$CONTACTS"
    ;;
  stats)
    echo "Contact stats:"
    jq 'to_entries | group_by(.value.status) | map({status: .[0].value.status, count: length}) | .[]' "$CONTACTS"
    ;;
  *)
    echo "Unknown action: $ACTION"
    echo "Usage: track.sh <list|add|sent|status|stats> [username] [status]"
    exit 1
    ;;
esac
