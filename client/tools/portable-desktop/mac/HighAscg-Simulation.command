#!/bin/bash
# Double-click after: chmod +x tools/portable-desktop/mac/HighAscg-Simulation.command
cd "$(dirname "$0")/../../.."
if [[ ! -f package.json ]]; then
  echo "[HighAsCG sim] Run from sim/highascg — package.json missing in $PWD"
  osascript -e 'display dialog "Open this from sim/highascg on HIGHASCGEXF (package.json missing)."'
  exit 1
fi
exec node tools/portable-desktop/launch-sim-from-exfat.cjs "$@"
