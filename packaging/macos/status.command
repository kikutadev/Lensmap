#!/bin/zsh
set -u

# Show installation, Native Messaging, Server, and persistent-data locations without starting the Server.
BASE_DIR="$HOME/Library/Application Support/Lensmap"
APP_DIR="$BASE_DIR/app"
DATA_DIR="$BASE_DIR/data"
RUNTIME_DIR="$BASE_DIR/runtime"
NODE="$APP_DIR/runtime/node/bin/node"

print "Lensmap installation"
print "  App:       $APP_DIR"
print "  Data:      $DATA_DIR"
print "  Runtime:   $RUNTIME_DIR"
print "  Extension: $APP_DIR/apps/chrome-extension/.output/chrome-mv3"
print ""

if [[ ! -x "$NODE" ]]; then
  print "Status: not installed"
  exit 1
fi

print "Bundled runtime: $($NODE --version)"
print ""

LENSMAP_DATA_DIR="$DATA_DIR" \
LENSMAP_RUNTIME_DIR="$RUNTIME_DIR" \
  "$NODE" "$APP_DIR/scripts/native-host-manager.mjs" status || true

print ""
LENSMAP_DATA_DIR="$DATA_DIR" \
LENSMAP_RUNTIME_DIR="$RUNTIME_DIR" \
  "$NODE" "$APP_DIR/scripts/lensmap-server.mjs" status || true
