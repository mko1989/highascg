#!/usr/bin/env bash
# Quick manual smoke for WO-89 HTTP API (host channel must be playing).
set -euo pipefail
HOST="${HIGHASCG_HTTP_HOST:-127.0.0.1:4200}"
SOURCE_ID="${1:-webpage_test}"

echo "GET targets"
curl -sf "http://${HOST}/api/cef-interactive/targets" | jq .

echo "POST focus sourceId=${SOURCE_ID}"
curl -sf -X POST "http://${HOST}/api/cef-interactive/focus" \
  -H 'Content-Type: application/json' \
  -d "{\"sourceId\":\"${SOURCE_ID}\"}" | jq .

echo "POST mouse click (center)"
curl -sf -X POST "http://${HOST}/api/cef-interactive/mouse" \
  -H 'Content-Type: application/json' \
  -d '{"type":"mousedown","x":0.5,"y":0.5,"coordsNormalized":true}' | jq .
curl -sf -X POST "http://${HOST}/api/cef-interactive/mouse" \
  -H 'Content-Type: application/json' \
  -d '{"type":"mouseup","x":0.5,"y":0.5,"coordsNormalized":true}' | jq .

echo "POST keyboard Enter"
curl -sf -X POST "http://${HOST}/api/cef-interactive/keyboard" \
  -H 'Content-Type: application/json' \
  -d '{"type":"keydown","keysym":65293}' | jq .
curl -sf -X POST "http://${HOST}/api/cef-interactive/keyboard" \
  -H 'Content-Type: application/json' \
  -d '{"type":"keyup","keysym":65293}' | jq .

echo "Done."
