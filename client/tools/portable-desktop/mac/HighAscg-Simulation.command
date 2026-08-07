#!/bin/bash
# Double-click after: chmod +x client/tools/portable-desktop/mac/HighAscg-Simulation.command
# This file sits at client/tools/portable-desktop/mac/ — the repo root is four levels up.
# Safe to run from any working directory (paths derive from the script location).
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "${SCRIPT_DIR}/../../../.."
if [[ ! -f package.json ]]; then
  echo "[HighAsCG sim] Expected package.json at the HighAsCG repo root — missing in $PWD"
  osascript -e 'display dialog "Open this from the HighAsCG repo (e.g. sim/highascg on HIGHASCGEXF) — package.json missing."'
  exit 1
fi
exec node "${SCRIPT_DIR}/../launch-sim-from-exfat.cjs" "$@"
