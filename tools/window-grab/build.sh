#!/usr/bin/env bash
# WO-1012 — build the window → shm ring grabber (window_grab.cpp) into tools/window-grab/build/window_grab.
# Needs: g++, libx11-dev, libxext-dev, libxcomposite-dev (all present on the box 09.11).
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$here/build"
g++ -O2 -std=c++17 -Wall -Wextra -o "$here/build/window_grab.tmp" "$here/window_grab.cpp" -lX11 -lXext -lXcomposite -lrt
mv -f "$here/build/window_grab.tmp" "$here/build/window_grab"
echo "built $here/build/window_grab"
