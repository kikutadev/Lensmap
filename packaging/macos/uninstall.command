#!/bin/zsh
set -euo pipefail

# Remove Lensmap executables and Native Messaging registration. User data is preserved by default.
BASE_DIR="$HOME/Library/Application Support/Lensmap"
APP_DIR="$BASE_DIR/app"
DATA_DIR="$BASE_DIR/data"
RUNTIME_DIR="$BASE_DIR/runtime"
NODE="$APP_DIR/runtime/node/bin/node"
MANAGER="$APP_DIR/scripts/native-host-manager.mjs"
CONTROLLER="$APP_DIR/scripts/lensmap-server.mjs"

if [[ -x "$NODE" && -f "$CONTROLLER" ]]; then
  LENSMAP_DATA_DIR="$DATA_DIR" \
  LENSMAP_RUNTIME_DIR="$RUNTIME_DIR" \
    "$NODE" "$CONTROLLER" stop >/dev/null 2>&1 || true
fi

if [[ -x "$NODE" && -f "$MANAGER" ]]; then
  LENSMAP_DATA_DIR="$DATA_DIR" \
  LENSMAP_RUNTIME_DIR="$RUNTIME_DIR" \
    "$NODE" "$MANAGER" uninstall >/dev/null 2>&1 || true
else
  rm -f "$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.lensmap.launcher.json"
  rm -f "$HOME/Library/Application Support/Google/ChromeForTesting/NativeMessagingHosts/com.lensmap.launcher.json"
  rm -f "$BASE_DIR/native-host/lensmap-native-host"
fi

rm -rf "$APP_DIR" "$RUNTIME_DIR" "$BASE_DIR/native-host"

if [[ "${LENSMAP_PURGE_DATA:-0}" == "1" ]]; then
  rm -rf "$DATA_DIR"
  rmdir "$BASE_DIR" 2>/dev/null || true
  print "Lensmap and its local data were removed."
else
  print "Lensmap was uninstalled."
  print "Local reading data was preserved at: $DATA_DIR"
  print "To remove it too, run: LENSMAP_PURGE_DATA=1 ./uninstall.command"
fi

print "Remove Lensmap from chrome://extensions if it is still listed there."
