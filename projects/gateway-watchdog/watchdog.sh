#!/bin/bash
# gateway-watchdog.sh — Monitor OpenClaw from OUTSIDE OpenClaw
# 
# Problem: When your AI gateway goes down, its own monitoring crons die too.
# Solution: Independent watchdog that pings the gateway health endpoint,
# sends alerts via direct Telegram API (bypassing OpenClaw), and optionally
# auto-restarts the service.
#
# Install as launchd plist for always-on monitoring.
# Author: Axiom 🔬 (github.com/0xAxiom)

set -euo pipefail

# ─── Configuration ───────────────────────────────────────────────
CONFIG_FILE="${WATCHDOG_CONFIG:-$HOME/.config/gateway-watchdog/config.env}"

# Defaults (override in config.env)
GATEWAY_URL="${GATEWAY_URL:-http://localhost:18789/health}"
CHECK_INTERVAL="${CHECK_INTERVAL:-60}"
FAIL_THRESHOLD="${FAIL_THRESHOLD:-3}"
TELEGRAM_BOT_TOKEN="${TELEGRAM_BOT_TOKEN:-}"
TELEGRAM_CHAT_ID="${TELEGRAM_CHAT_ID:-}"
AUTO_RESTART="${AUTO_RESTART:-false}"
RESTART_CMD="${RESTART_CMD:-launchctl kickstart -k gui/\$(id -u)/com.clawdbot.axiom}"
LOG_FILE="${LOG_FILE:-$HOME/.config/gateway-watchdog/watchdog.log}"
QUIET_HOURS_START="${QUIET_HOURS_START:-}"  # e.g., "23" for 11 PM
QUIET_HOURS_END="${QUIET_HOURS_END:-}"      # e.g., "7" for 7 AM

# ─── Load config ─────────────────────────────────────────────────
if [ -f "$CONFIG_FILE" ]; then
    source "$CONFIG_FILE"
fi

# ─── State ───────────────────────────────────────────────────────
FAIL_COUNT=0
LAST_ALERT_TIME=0
ALERT_COOLDOWN=300  # Don't spam — 5 min between alerts
STATE_FILE="${STATE_DIR:-$HOME/.config/gateway-watchdog}/state.json"

mkdir -p "$(dirname "$LOG_FILE")" "$(dirname "$STATE_FILE")"

# ─── Functions ───────────────────────────────────────────────────

log() {
    local timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    echo "[$timestamp] $1" >> "$LOG_FILE"
    # Keep log under 1MB
    if [ -f "$LOG_FILE" ] && [ $(wc -c < "$LOG_FILE") -gt 1048576 ]; then
        tail -1000 "$LOG_FILE" > "$LOG_FILE.tmp" && mv "$LOG_FILE.tmp" "$LOG_FILE"
    fi
}

send_telegram() {
    local message="$1"
    if [ -n "$TELEGRAM_BOT_TOKEN" ] && [ -n "$TELEGRAM_CHAT_ID" ]; then
        curl -s -X POST \
            "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
            -d "chat_id=${TELEGRAM_CHAT_ID}" \
            -d "text=${message}" \
            -d "parse_mode=HTML" \
            > /dev/null 2>&1
        return $?
    fi
    return 1
}

is_quiet_hours() {
    if [ -z "$QUIET_HOURS_START" ] || [ -z "$QUIET_HOURS_END" ]; then
        return 1  # No quiet hours configured
    fi
    local hour=$(date +%H)
    if [ "$QUIET_HOURS_START" -gt "$QUIET_HOURS_END" ]; then
        # Spans midnight (e.g., 23-7)
        [ "$hour" -ge "$QUIET_HOURS_START" ] || [ "$hour" -lt "$QUIET_HOURS_END" ]
    else
        [ "$hour" -ge "$QUIET_HOURS_START" ] && [ "$hour" -lt "$QUIET_HOURS_END" ]
    fi
}

check_gateway() {
    local http_code
    http_code=$(curl -s -o /dev/null -w '%{http_code}' \
        --connect-timeout 5 --max-time 10 \
        "$GATEWAY_URL" 2>/dev/null) || http_code="000"
    echo "$http_code"
}

restart_gateway() {
    if [ "$AUTO_RESTART" = "true" ]; then
        log "AUTO-RESTART: Attempting restart..."
        eval "$RESTART_CMD" 2>&1 | while read line; do log "  $line"; done
        sleep 10  # Give it time to come back
        local status=$(check_gateway)
        if [ "$status" = "200" ]; then
            log "AUTO-RESTART: Gateway recovered! (HTTP $status)"
            send_telegram "🟢 <b>Gateway Auto-Recovered</b>
Restart successful. Gateway is back online."
            return 0
        else
            log "AUTO-RESTART: Still down after restart (HTTP $status)"
            return 1
        fi
    fi
    return 1
}

save_state() {
    cat > "$STATE_FILE" << EOF
{
    "lastCheck": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
    "failCount": $FAIL_COUNT,
    "status": "$1",
    "httpCode": "$2",
    "lastAlertTime": $LAST_ALERT_TIME
}
EOF
}

# ─── Main Loop ───────────────────────────────────────────────────

log "Watchdog started. Monitoring $GATEWAY_URL every ${CHECK_INTERVAL}s (threshold: $FAIL_THRESHOLD failures)"

while true; do
    HTTP_CODE=$(check_gateway)
    NOW=$(date +%s)

    if [ "$HTTP_CODE" = "200" ]; then
        # Healthy
        if [ $FAIL_COUNT -gt 0 ]; then
            log "RECOVERED: Gateway back online after $FAIL_COUNT failures (HTTP $HTTP_CODE)"
            send_telegram "🟢 <b>Gateway Recovered</b>
Back online after $FAIL_COUNT consecutive failures."
        fi
        FAIL_COUNT=0
        save_state "healthy" "$HTTP_CODE"
    else
        # Failed
        FAIL_COUNT=$((FAIL_COUNT + 1))
        log "FAIL #$FAIL_COUNT: HTTP $HTTP_CODE from $GATEWAY_URL"
        save_state "failing" "$HTTP_CODE"

        if [ $FAIL_COUNT -ge $FAIL_THRESHOLD ]; then
            TIME_SINCE_ALERT=$((NOW - LAST_ALERT_TIME))

            if [ $TIME_SINCE_ALERT -ge $ALERT_COOLDOWN ]; then
                if ! is_quiet_hours; then
                    log "ALERT: Gateway down! $FAIL_COUNT consecutive failures"
                    send_telegram "🔴 <b>Gateway DOWN</b>
$FAIL_COUNT consecutive failures (HTTP $HTTP_CODE)
URL: $GATEWAY_URL
Time: $(date '+%Y-%m-%d %H:%M:%S %Z')

$([ \"$AUTO_RESTART\" = \"true\" ] && echo \"Attempting auto-restart...\" || echo \"Auto-restart disabled. Manual intervention needed.\")"
                    LAST_ALERT_TIME=$NOW
                fi
            fi

            # Try auto-restart after threshold
            if [ "$AUTO_RESTART" = "true" ] && [ $((FAIL_COUNT % FAIL_THRESHOLD)) -eq 0 ]; then
                restart_gateway && FAIL_COUNT=0
            fi
        fi
    fi

    sleep "$CHECK_INTERVAL"
done
