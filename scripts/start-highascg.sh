#!/bin/bash
# Minimal launcher for HighAsCG (use from Openbox autostart or systemd).
# Env overrides: CASPAR_HOST, HTTP_PORT, BIND_ADDRESS, HIGHASCG_HOME

export CASPAR_HOST="${CASPAR_HOST:-127.0.0.1}"
export HTTP_PORT="${HTTP_PORT:-8080}"
export BIND_ADDRESS="${BIND_ADDRESS:-0.0.0.0}"

HIGHASCG_HOME="${HIGHASCG_HOME:-/opt/highascg}"
cd "$HIGHASCG_HOME" || exit 1
exec node index.js
