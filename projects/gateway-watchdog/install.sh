#!/bin/bash
# install.sh — Install Gateway Watchdog as a macOS launchd service
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CONFIG_DIR="$HOME/.config/gateway-watchdog"
PLIST_NAME="com.axiom.gateway-watchdog"
PLIST_DEST="$HOME/Library/LaunchAgents/$PLIST_NAME.plist"

echo "🐕 Gateway Watchdog Installer"
echo "=============================="
echo ""

# Create config directory
mkdir -p "$CONFIG_DIR"

# Copy config if not exists
if [ ! -f "$CONFIG_DIR/config.env" ]; then
    cp "$SCRIPT_DIR/config.example.env" "$CONFIG_DIR/config.env"
    echo "✅ Created config at $CONFIG_DIR/config.env"
    echo "   ⚠️  Edit this file to add your Telegram bot token and chat ID!"
else
    echo "ℹ️  Config already exists at $CONFIG_DIR/config.env"
fi

# Make watchdog executable
chmod +x "$SCRIPT_DIR/watchdog.sh"

# Generate plist with correct paths
sed -e "s|WATCHDOG_PATH|$SCRIPT_DIR|g" \
    -e "s|LOG_PATH|$CONFIG_DIR|g" \
    -e "s|HOME_PATH|$HOME|g" \
    "$SCRIPT_DIR/com.axiom.gateway-watchdog.plist" > "$PLIST_DEST"

echo "✅ Installed launchd plist at $PLIST_DEST"

# Load the service
launchctl load "$PLIST_DEST" 2>/dev/null || true
launchctl start "$PLIST_NAME" 2>/dev/null || true

echo "✅ Watchdog service started!"
echo ""
echo "Commands:"
echo "  Status:  launchctl list | grep watchdog"
echo "  Logs:    tail -f $CONFIG_DIR/watchdog.log"
echo "  Stop:    launchctl unload $PLIST_DEST"
echo "  Restart: launchctl kickstart -k gui/\$(id -u)/$PLIST_NAME"
echo ""
echo "⚠️  Don't forget to configure Telegram alerts in $CONFIG_DIR/config.env"
