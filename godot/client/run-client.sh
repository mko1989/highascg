#!/usr/bin/env bash
# WO-599 — run the Godot operator client (dev). Server: --server=… or HIGHASCG_SERVER (default http://127.0.0.1:4200).
#   godot/client/run-client.sh                      # windowed, local server
#   godot/client/run-client.sh --fullscreen --screen=1
#   GODOT=/opt/godot/godot godot/client/run-client.sh --server=http://box:4200
#   godot/client/run-client.sh --test               # headless unit tests (exit code = failures)
#   godot/client/run-client.sh --check              # headless boot: fails on any script/parse error
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -z "${GODOT:-}" ]]; then
	for c in /opt/godot/godot /Applications/Godot.app/Contents/MacOS/Godot "$(command -v godot 2>/dev/null || true)"; do
		if [[ -n "$c" && -x "$c" ]]; then GODOT="$c"; break; fi
	done
fi
[[ -n "${GODOT:-}" ]] || { echo "Godot not found — set GODOT=/path/to/godot" >&2; exit 1; }
# GDExtensions load from .godot/extension_list.cfg (no editor import; see WO-596).
if [[ -f "$HERE/addons/hshm/hshm.gdextension" ]]; then
	mkdir -p "$HERE/.godot"
	echo "res://addons/hshm/hshm.gdextension" > "$HERE/.godot/extension_list.cfg"
fi
if [[ -f "$HERE/addons/hshm_sink/bin/libhshm_sink.linux.template_debug.x86_64.so" ]]; then  # WO-863: Visuals → Send
	mkdir -p "$HERE/.godot"
	grep -qs "res://addons/hshm_sink/hshm_sink.gdextension" "$HERE/.godot/extension_list.cfg" ||
		echo "res://addons/hshm_sink/hshm_sink.gdextension" >> "$HERE/.godot/extension_list.cfg"
fi
# --test / --check get their own user:// (WO-753): on a kiosk box they otherwise share the kiosk's, truncating its live
# godot.log under it and saving their ui.cfg over the kiosk's.
if [[ "${1:-}" == "--test" || "${1:-}" == "--check" ]]; then
	XDG_DATA_HOME="$(mktemp -d "${TMPDIR:-/tmp}/highascg-client-${1#--}-XXXXXX")"
	export XDG_DATA_HOME
	trap 'rm -rf "$XDG_DATA_HOME"' EXIT
	# WO-902: …and no server. A --check booted the Live tab against the box's own server and posted its 4-second
	# headless tiling as the shared compose layout (plus a project autosave). HIGHASCG_TEST_SERVER opts in on purpose.
	export HIGHASCG_SERVER="${HIGHASCG_TEST_SERVER:-http://127.0.0.1:9}"
fi
if [[ "${1:-}" == "--test" ]]; then
	"$GODOT" --headless --path "$HERE" --script res://tests/run_tests.gd && exit 0 || exit $?
fi
# --check: boot the real app headless for a few seconds (all autoloads + every UI scene script compile and
# _ready runs); exit 1 on any script/parse error. The unit runner (--test) never loads the UI scripts.
if [[ "${1:-}" == "--check" ]]; then
	# A parse error in the main script means --quit-after never runs → bound the boot, then judge the log.
	out="$(timeout 45 "$GODOT" --headless --path "$HERE" -- --quit-after=4 --tab=1 2>&1)" && rc=0 || rc=$?
	errs="$(grep -E 'SCRIPT ERROR|Parse Error|Compile Error' <<<"$out" || true)"
	if [[ $rc -eq 124 ]]; then errs="${errs:+$errs$'\n'}[check] boot did not quit within 45 s"; fi
	if [[ -n "$errs" ]]; then echo "$errs" >&2; echo "[check] FAILED" >&2; exit 1; fi
	echo "[check] boot OK (no script errors)"; exit 0
fi
# WO-934: the session autostart (--autostart) shows nothing before the node answers and no GUI before the start-up
# question is answered. It waits for GET /api/system/operator-screen (HIGHASCG_AUTOSTART_WAIT_S, default 600 s; the
# node can start minutes after the session on a stick boot), runs a launcher-only client (--boot-launcher: the
# prompts, no GUI) while a question is pending, and starts no client at all when this boot runs headless.
if [[ " $* " == *" --autostart "* ]]; then
	srv="${HIGHASCG_SERVER:-http://127.0.0.1:4200}"
	boot_state() { # pending | headless | gui; "" while the node does not answer
		{ curl -s -m 3 "$srv/api/system/operator-screen" || true; } | node -e 'let b = ""
process.stdin.on("data", (d) => (b += d)).on("end", () => {
	try {
		const x = JSON.parse(b).boot || {}
		console.log(x.pending ? "pending" : x.headless ? "headless" : "gui")
	} catch {}
})' 2>/dev/null || true
	}
	stamp() { date '+%F %T'; }
	deadline=$((SECONDS + ${HIGHASCG_AUTOSTART_WAIT_S:-600}))
	state="$(boot_state)"
	[[ -n "$state" ]] || echo "[run-client] $(stamp) waiting for the node at $srv"
	while [[ -z "$state" ]] && ((SECONDS < deadline)); do
		sleep 2
		state="$(boot_state)"
	done
	echo "[run-client] $(stamp) start-up: ${state:-no answer from the node, starting the GUI anyway}"
	if [[ "$state" == pending ]]; then
		"$GODOT" --path "$HERE" --resolution 64x64 -- --boot-launcher || true
		state="$(boot_state)"
		echo "[run-client] $(stamp) start-up answered: ${state:-no answer from the node}"
	fi
	if [[ "$state" == headless ]]; then
		echo "[run-client] $(stamp) this boot runs headless — the operator GUI is not started"
		exit 0
	fi
fi
# WO-880: a crash relaunches the client (show safety: the Visuals resume Send by themselves). Only a crash signal
# (SIGILL/ABRT/BUS/FPE/SEGV → 132/134/135/136/139) — a quit, an error exit or a kill (TERM/INT/KILL) ends it — and at
# most 5 times in 5 min. HIGHASCG_CLIENT_NO_RELAUNCH=1 = the old single run.
[[ -n "${HIGHASCG_CLIENT_NO_RELAUNCH:-}" ]] && exec "$GODOT" --path "$HERE" -- "$@"
crashes=()
while :; do
	"$GODOT" --path "$HERE" -- "$@" && rc=0 || rc=$?
	case $rc in 132 | 134 | 135 | 136 | 139) ;; *) exit "$rc" ;; esac
	now=$(date +%s)
	recent=()
	for t in "${crashes[@]}"; do ((now - t < 300)) && recent+=("$t"); done
	crashes=("${recent[@]}" "$now")
	if ((${#crashes[@]} > 5)); then
		echo "[run-client] $(date '+%F %T') crashed (exit $rc) 6 times in 5 min — not relaunching" >&2
		exit "$rc"
	fi
	echo "[run-client] $(date '+%F %T') crashed (exit $rc) — relaunching in 2 s" >&2
	sleep 2
done
