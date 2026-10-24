#!/usr/bin/env bash
# WO-742 — end-to-end check of Caspar's shm PRODUCER (PLAY … SHM NAME <name>) in a throwaway Caspar instance:
# a test writer publishes a ring → PLAY puts it on a layer of a 720p channel → the channel's WO-594 shm consumer
# publishes the mixed frame → a reader checks the pixels: the writer's opaque half arrives as is (stretched to the
# channel), its transparent half stays transparent, a restarted writer with a new size and colour is picked up, and
# PLAY without a NAME is refused. Runs under Xvfb on its own AMCP port, paths and CEF cache: it never touches the
# box's own Caspar, DeckLinks or display.
#   tools/e2e/caspar-shm-producer.sh <path/to/casparcg>      exit 0 = pass
set -euo pipefail

BIN=${1:?usage: caspar-shm-producer.sh <path/to/casparcg>}
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
WORK=$(mktemp -d "${TMPDIR:-/tmp}/wo742.XXXXXX")
PORT=${WO742_AMCP_PORT:-5299}
IN="wo742-in-$$"
OUT="wo742-out-$$"
PIDS=()
cleanup() {
	for p in "${PIDS[@]}"; do kill "$p" 2>/dev/null || true; done
	wait 2>/dev/null || true
	rm -f "/dev/shm/highascg-$IN" "/dev/shm/highascg-$OUT"
	rm -rf "$WORK"
}
trap cleanup EXIT

c++ -std=c++17 -O2 "$ROOT/caspar/modules/shm/tests/hshm_pattern.cpp" -o "$WORK/hshm_pattern" -lrt
mkdir -p "$WORK/media" "$WORK/log" "$WORK/data" "$WORK/template"
cat >"$WORK/casparcg.config" <<EOF
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
    <html><cache-path>$WORK/cef-cache</cache-path></html>
</configuration>
EOF

amcp() { # one command → the first reply line
	exec 3<>"/dev/tcp/127.0.0.1/$PORT"
	printf '%s\r\n' "$1" >&3
	local line
	IFS= read -r -t 5 line <&3 || true
	exec 3<&- 3>&-
	printf '%s\n' "${line%$'\r'}"
}
fail() { echo "FAIL: $*"; tail -20 "$WORK/caspar.out" 2>/dev/null; exit 1; }
expect_px() { # <reader output> <x,y> <b g r a>
	grep -qx "$2 $3" <<<"$1" || fail "pixel $2: wanted $3, got: $(grep "^$2 " <<<"$1")"
}

"$WORK/hshm_pattern" write "$IN" 640 360 25 &
PIDS+=($!)
DISP=$((200 + $$ % 300))
Xvfb ":$DISP" -screen 0 1280x720x24 -nolisten tcp >/dev/null 2>&1 &
PIDS+=($!)
sleep 1
(cd "$WORK" && DISPLAY=":$DISP" exec "$BIN" "$WORK/casparcg.config") >"$WORK/caspar.out" 2>&1 &
PIDS+=($!) # Caspar itself (exec): killed by PID on exit
for _ in $(seq 60); do
	(exec 3<>"/dev/tcp/127.0.0.1/$PORT") 2>/dev/null && break
	sleep 0.5
done
r=$(amcp "PLAY 1-10 SHM NAME $IN")
[[ $r == 202* ]] || fail "PLAY → $r"
echo "PLAY 1-10 SHM NAME $IN → $r"
sleep 1
px=$("$WORK/hshm_pattern" read "$OUT" 320 360 960 360)
echo "$px"
grep -q '^1280x720 ' <<<"$px" || fail "channel size"
expect_px "$px" 320,360 "10 80 f0 ff"
expect_px "$px" 960,360 "00 00 00 00"

kill "${PIDS[0]}" && wait "${PIDS[0]}" 2>/dev/null || true # the writer goes away: the layer holds its last frame
sleep 1
held=$("$WORK/hshm_pattern" read "$OUT" 320 360)
expect_px "$held" 320,360 "10 80 f0 ff"
echo "writer gone → last frame held"

"$WORK/hshm_pattern" write "$IN" 320 180 10 f02010ff & # restarted writer: new inode, new size, blue
PIDS[0]=$!
sleep 2
px=$("$WORK/hshm_pattern" read "$OUT" 320 360 960 360)
expect_px "$px" 320,360 "f0 20 10 ff"
expect_px "$px" 960,360 "00 00 00 00"
echo "writer restarted at 320x180 → picked up: $(grep '^320,360' <<<"$px")"

r=$(amcp "PLAY 1-11 SHM")
[[ $r == 4* ]] || fail "PLAY without NAME should be refused, got: $r"
echo "PLAY 1-11 SHM (no NAME) → $r"
grep -q 'shm_producer\[' "$WORK/caspar.out" || fail "no shm_producer log line"
echo PASS
