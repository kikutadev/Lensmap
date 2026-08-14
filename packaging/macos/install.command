#!/bin/zsh
set -euo pipefail

# Install or update the self-contained GitHub Release bundle into a stable per-user location.
SOURCE_DIR="$(cd -- "$(dirname -- "$0")" && pwd -P)"
BASE_DIR="$HOME/Library/Application Support/Lensmap"
APP_DIR="$BASE_DIR/app"
DATA_DIR="$BASE_DIR/data"
RUNTIME_DIR="$BASE_DIR/runtime"
NEW_DIR="$BASE_DIR/.app-install-$$"
OLD_DIR="$BASE_DIR/.app-previous-$$"

cleanup() {
  rm -rf "$NEW_DIR"
}
trap cleanup EXIT

mkdir -p "$BASE_DIR" "$DATA_DIR" "$RUNTIME_DIR"
chmod 700 "$BASE_DIR" "$DATA_DIR" "$RUNTIME_DIR"

# Stop an installed server before replacing its executable files. User data lives outside APP_DIR.
if [[ -x "$APP_DIR/runtime/node/bin/node" && -f "$APP_DIR/scripts/lensmap-server.mjs" ]]; then
  LENSMAP_DATA_DIR="$DATA_DIR" \
  LENSMAP_RUNTIME_DIR="$RUNTIME_DIR" \
    "$APP_DIR/runtime/node/bin/node" "$APP_DIR/scripts/lensmap-server.mjs" stop >/dev/null 2>&1 || true
fi

if [[ "$SOURCE_DIR" != "$APP_DIR" ]]; then
  rm -rf "$NEW_DIR" "$OLD_DIR"
  /usr/bin/ditto "$SOURCE_DIR" "$NEW_DIR"

  [[ -x "$NEW_DIR/runtime/node/bin/node" ]] || {
    print -u2 "Lensmap bundle is incomplete: bundled Node runtime was not found."
    exit 1
  }
  [[ -f "$NEW_DIR/apps/chrome-extension/.output/chrome-mv3/manifest.json" ]] || {
    print -u2 "Lensmap bundle is incomplete: Chrome extension build was not found."
    exit 1
  }

  if [[ -d "$APP_DIR" ]]; then
    mv "$APP_DIR" "$OLD_DIR"
  fi
  if ! mv "$NEW_DIR" "$APP_DIR"; then
    [[ -d "$OLD_DIR" ]] && mv "$OLD_DIR" "$APP_DIR"
    exit 1
  fi
fi

NODE="$APP_DIR/runtime/node/bin/node"
MANAGER="$APP_DIR/scripts/native-host-manager.mjs"
EXTENSION_DIR="$APP_DIR/apps/chrome-extension/.output/chrome-mv3"

chmod 755 "$NODE" "$APP_DIR/install.command" "$APP_DIR/uninstall.command" "$APP_DIR/status.command"

if ! LENSMAP_DATA_DIR="$DATA_DIR" \
LENSMAP_RUNTIME_DIR="$RUNTIME_DIR" \
  "$NODE" "$MANAGER" install >/dev/null; then
  print -u2 "Native Messaging registration failed; restoring the previous Lensmap installation."
  rm -rf "$APP_DIR"
  if [[ -d "$OLD_DIR" ]]; then
    mv "$OLD_DIR" "$APP_DIR"
    if [[ -x "$APP_DIR/runtime/node/bin/node" && -f "$APP_DIR/scripts/native-host-manager.mjs" ]]; then
      LENSMAP_DATA_DIR="$DATA_DIR" LENSMAP_RUNTIME_DIR="$RUNTIME_DIR" \
        "$APP_DIR/runtime/node/bin/node" "$APP_DIR/scripts/native-host-manager.mjs" install >/dev/null 2>&1 || true
    fi
  fi
  exit 1
fi
rm -rf "$OLD_DIR"

print ""
print "Lensmap was installed successfully."
print ""
print "Chrome setup (first installation only):"
print "  1. Open chrome://extensions"
print "  2. Enable Developer mode"
print "  3. Choose 'Load unpacked'"
print "  4. Select: $EXTENSION_DIR"
print "  5. In the extension details, enable 'Allow access to file URLs' if you read local PDFs"
print ""
print "For an update, run install.command from the new release and then click Reload for Lensmap at chrome://extensions."
print "User data is preserved at: $DATA_DIR"
print "Diagnostics: $APP_DIR/status.command"
