#!/usr/bin/env bash
# WO-745 — end to end for the game source: the test core (godot/retro/tests/test_core.c) in the operator's window
# (godot/retro, RetroHost) → its picture in the shm ring → a real X key press reaches the core (button A) → the ring
# is listed as a Live-tab source by GET /api/shm/sources' lister (WO-744). Own Xvfb display; nothing of the box's
# kiosk, server or Caspar is touched.
#   tools/e2e/retro-source.sh          exit 0 = pass      (needs: godot/retro/install.sh once, xdotool, cc)
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
WORK=$(mktemp -d "${TMPDIR:-/tmp}/wo745.XXXXXX")
RING="wo745-$$"
PIDS=()
cleanup() {
	for p in "${PIDS[@]}"; do kill "$p" 2>/dev/null || true; done
	wait 2>/dev/null || true
	rm -f "/dev/shm/highascg-$RING" # a killed window cannot unlink it itself
	rm -rf "$WORK"
}
trap cleanup EXIT
fail() { echo "FAIL: $*"; tail -20 "$WORK/retro.out" 2>/dev/null; exit 1; }
expect_px() { grep -qx "$2 $3" <<<"$1" || fail "pixel $2: wanted $3, got: $(grep "^$2 " <<<"$1")"; }

INC="$ROOT/godot/extensions/hshm/build/template_debug/retro_include"
[[ -f $INC/libretro.h && -f $ROOT/godot/retro/.godot/extension_list.cfg ]] || fail "run godot/retro/install.sh first"
cc -shared -fPIC -O2 -I"$INC" "$ROOT/godot/retro/tests/test_core.c" -o "$WORK/test_libretro.so"
c++ -std=c++17 -O2 "$ROOT/caspar/modules/shm/tests/hshm_pattern.cpp" -o "$WORK/hshm_pattern" -lrt
printf '\x40game' >"$WORK/game.bin" # the core paints its right half (seed, seed, 255) from the first byte

DISP=":$((200 + $$ % 300))"
Xvfb "$DISP" -screen 0 1280x720x24 -nolisten tcp >/dev/null 2>&1 &
PIDS+=($!)
sleep 1
(DISPLAY="$DISP" exec "${GODOT:-$HOME/.local/opt/godot/godot}" --path "$ROOT/godot/retro" -- \
	--core "$WORK/test_libretro.so" --game "$WORK/game.bin" --ring "$RING") >"$WORK/retro.out" 2>&1 &
PIDS+=($!)

# The core's 160×144 is published ×5 (auto: the smallest whole factor reaching 720 lines) = 800×720, sharp edges.
px=$("$WORK/hshm_pattern" read "$RING" 200 360 600 360 399 360 400 360) || fail "ring: $px"
echo "$px"
grep -q '^800x720 ' <<<"$px" || fail "ring size (auto ×5)"
expect_px "$px" 200,360 "00 ff 00 ff" # green: A not held
expect_px "$px" 600,360 "ff 40 40 ff" # from the game file: the content reached the core
expect_px "$px" 399,360 "00 ff 00 ff" # the last enlarged column of the left half…
expect_px "$px" 400,360 "ff 40 40 ff" # …and the first of the right: nearest, no blend at the edge

WIN=$(DISPLAY="$DISP" xdotool search --name 'HighAsCG Retro' | head -1)
[[ -n $WIN ]] || fail "no window"
echo "window: $(DISPLAY="$DISP" xdotool getwindowname "$WIN")"
DISPLAY="$DISP" xdotool windowfocus --sync "$WIN" keydown x # X = joypad A (RetroArch layout)
sleep 0.5
held=$("$WORK/hshm_pattern" read "$RING" 200 360)
DISPLAY="$DISP" xdotool keyup x
expect_px "$held" 200,360 "00 00 ff ff" # red while held
sleep 0.5
expect_px "$("$WORK/hshm_pattern" read "$RING" 200 360)" 200,360 "00 ff 00 ff"
echo "key X held → button A → red; released → green"

listed=$(cd "$ROOT" && node -e "
const s = require('./src/api/routes-shm-sources').listShmSources().find((x) => x.name === process.argv[1])
console.log(JSON.stringify(s || null))" "$RING")
echo "/api/shm/sources: $listed"
grep -q '"signal":true' <<<"$listed" || fail "not listed as a live source"
echo PASS
