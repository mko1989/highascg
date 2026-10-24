#!/usr/bin/env bash
# WO-743 — end to end: a Godot SubViewport → libhshm_sink (features/shm_out/viewport_publisher.gd) → shm ring →
# Caspar's shm producer (WO-742, PLAY … SHM NAME) → the channel's WO-594 shm consumer → pixel check. Opaque, half
# transparent (premultiplied) and empty regions must all arrive exactly. Godot and Caspar run on their own Xvfb display,
# scratch project, AMCP port and paths: nothing of the box's own Caspar, kiosk or display is touched.
#   tools/e2e/godot-shm-writer.sh <path/to/casparcg>          exit 0 = pass
#   needs: $GODOT (default ~/.local/opt/godot/godot) and godot/extensions/hshm/bin/libhshm_sink.* (build.sh)
set -euo pipefail

BIN=${1:?usage: godot-shm-writer.sh <path/to/casparcg>}
GODOT=${GODOT:-$HOME/.local/opt/godot/godot}
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
WORK=$(mktemp -d "${TMPDIR:-/tmp}/wo743.XXXXXX")
PORT=${WO743_AMCP_PORT:-5298}
IN="wo743-in-$$"
OUT="wo743-out-$$"
PIDS=()
cleanup() {
	for p in "${PIDS[@]}"; do kill "$p" 2>/dev/null || true; done
	wait 2>/dev/null || true
	rm -f "/dev/shm/highascg-$IN" "/dev/shm/highascg-$OUT"
	rm -rf "$WORK"
}
trap cleanup EXIT
fail() { echo "FAIL: $*"; tail -20 "$WORK/godot.out" "$WORK/caspar.out" 2>/dev/null; exit 1; }
expect_px() { # <reader output> <x,y> <b g r a>
	grep -qx "$2 $3" <<<"$1" || fail "pixel $2: wanted $3, got: $(grep "^$2 " <<<"$1")"
}

LIB=$(ls "$ROOT"/godot/extensions/hshm/bin/libhshm_sink.linux.*.so 2>/dev/null | head -1)
[[ -n $LIB ]] || fail "libhshm_sink not built (godot/extensions/hshm/build.sh)"
c++ -std=c++17 -O2 "$ROOT/caspar/modules/shm/tests/hshm_pattern.cpp" -o "$WORK/hshm_pattern" -lrt

# A scratch Godot project: the sink extension, the publisher and the test scene — never the client project.
P="$WORK/proj"
mkdir -p "$P/addons/hshm_sink/bin" "$P/.godot"
cp "$ROOT/godot/extensions/hshm/src/sink/hshm_sink.gdextension" "$P/addons/hshm_sink/"
cp "$LIB" "$P/addons/hshm_sink/bin/"
echo "res://addons/hshm_sink/hshm_sink.gdextension" >"$P/.godot/extension_list.cfg"
printf 'config_version=5\n[application]\nconfig/name="wo743"\n' >"$P/project.godot"
cp "$ROOT/godot/client/features/shm_out/viewport_publisher.gd" "$ROOT/tools/e2e/godot-shm-writer/main.gd" "$P/"

DISP=$((200 + $$ % 300))
Xvfb ":$DISP" -screen 0 1280x720x24 -nolisten tcp >/dev/null 2>&1 &
PIDS+=($!)
sleep 1
(DISPLAY=":$DISP" exec "$GODOT" --path "$P" --script res://main.gd -- "$IN" 30) >"$WORK/godot.out" 2>&1 &
PIDS+=($!)

# 1. Godot → ring: the writer's own pixels (640×360).
px=$("$WORK/hshm_pattern" read "$IN" 160 180 480 90 480 270) || fail "ring: $px"
echo "$px"
grep -q '^640x360 ' <<<"$px" || fail "ring size"
expect_px "$px" 160,180 "10 80 f0 ff" # opaque orange
expect_px "$px" 480,90 "08 40 78 80"  # the same at alpha 128, premultiplied: 240·128/255 = 0x78
expect_px "$px" 480,270 "00 00 00 00" # empty
echo "ring OK ($(grep -m1 '^renderer' "$WORK/godot.out" || echo 'renderer ?'))"

# 2. ring → Caspar (throwaway instance, 720p): the layer, scaled 2×, through the mixer to the channel output.
mkdir -p "$WORK/caspar/media" "$WORK/caspar/log" "$WORK/caspar/data" "$WORK/caspar/template"
cat >"$WORK/caspar/casparcg.config" <<CFG
<configuration>
    <paths><media-path>media/</media-path><log-path>log/</log-path><data-path>data/</data-path><template-path>template/</template-path></paths>
    <log-level>info</log-level>
    <channels>
        <channel>
            <video-mode>720p5000</video-mode>
            <consumers><shm><name>$OUT</name></shm></consumers>
        </channel>
    </channels>
    <controllers><tcp><port>$PORT</port><protocol>AMCP</protocol></tcp></controllers>
    <html><cache-path>$WORK/caspar/cef-cache</cache-path></html>
</configuration>
CFG
(cd "$WORK/caspar" && DISPLAY=":$DISP" exec "$BIN" "$WORK/caspar/casparcg.config") >"$WORK/caspar.out" 2>&1 &
PIDS+=($!) # Caspar itself (exec): killed by PID on exit
for _ in $(seq 60); do
	(exec 3<>"/dev/tcp/127.0.0.1/$PORT") 2>/dev/null && break
	sleep 0.5
done
exec 3<>"/dev/tcp/127.0.0.1/$PORT"
printf 'PLAY 1-10 SHM NAME %s\r\n' "$IN" >&3
IFS= read -r -t 5 r <&3 || true
exec 3<&- 3>&-
[[ $r == 202* ]] || fail "PLAY → $r"
echo "PLAY 1-10 SHM NAME $IN → ${r%$'\r'}"
sleep 1
px=$("$WORK/hshm_pattern" read "$OUT" 320 360 960 180 960 540) || fail "channel: $px"
echo "$px"
grep -q '^1280x720 ' <<<"$px" || fail "channel size"
expect_px "$px" 320,360 "10 80 f0 ff"
expect_px "$px" 960,180 "08 40 78 80"
expect_px "$px" 960,540 "00 00 00 00"
echo PASS
