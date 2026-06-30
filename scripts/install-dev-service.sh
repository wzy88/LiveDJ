#!/bin/zsh
set -e

SERVICE_LABEL="com.wzy.claudio-radio"
APP_SUPPORT_DIR="/Users/wzy/Library/Application Support/ClaudioRadio"
WRAPPER_PATH="$APP_SUPPORT_DIR/launchd-wrapper.sh"
PLIST_PATH="/Users/wzy/Documents/网页电台/scripts/com.wzy.claudio-radio.plist"

mkdir -p "$APP_SUPPORT_DIR" "/Users/wzy/Library/Logs"
cp "/Users/wzy/Documents/网页电台/scripts/launchd-wrapper.sh" "$WRAPPER_PATH"
chmod +x "$WRAPPER_PATH"
chmod +x "/Users/wzy/Documents/网页电台/scripts/launch-dev.sh" "/Users/wzy/Documents/网页电台/scripts/ensure-dev.sh"

ln -s "/Users/wzy/Documents/网页电台" "/Users/wzy/Documents/claudio-radio-dev" 2>/dev/null || true

launchctl bootout "gui/$(id -u)/$SERVICE_LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST_PATH"
launchctl enable "gui/$(id -u)/$SERVICE_LABEL"
launchctl kickstart -k "gui/$(id -u)/$SERVICE_LABEL"

echo "Claudio Radio dev service installed: $SERVICE_LABEL"
