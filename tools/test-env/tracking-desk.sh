#!/usr/bin/env bash
# WO-978 — tracking → lighting desk test environment (puppet marker → PSN → MagicQ).
#
#   tools/test-env/tracking-desk.sh up     [--display :99|:0] [--pattern circle|figure8|line|walk|hold] [--iface <ip>]
#   tools/test-env/tracking-desk.sh status [--sniff]
#   tools/test-env/tracking-desk.sh down
#
# up:   saves MagicQ's console files, installs the "PSN Test" console state (Tracker rx PSN/SpotMe, PSN function
#       Normal PSN 1, tracker 1 "Puppet", Z scale -1, IP of the NIC the GeNetix is on), starts MagicQ on the display
#       (default :99, a private Xvfb started here), turns the ACTIVE project's PSN output on through the autosave path
#       (fixtures.output: protocol psn, iface = the NIC MagicQ joined the PSN group on, axes y_up) and starts the test
#       puppet (GET / POST /api/tracking/puppet).
# down: puppet off, project output back exactly as it was, MagicQ quit, its console files restored, the Xvfb this
#       script started stopped (never nxnode). Help page: godot/client/help/tracking-desk-test.md.
#
# MagicQ PC only accepts PSN when unlocked — on this box by the ChamSys GeNetix GN10 on eno2 (10.0.0.121); MagicQ's
# own IP must be on that NIC (10.0.0.13), and multicast loopback reaches it only when HighAsCG sends PSN out of the
# same NIC — hence iface = the interface of MagicQ's group join.
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$HERE/../.." && pwd)
API=${HIGHASCG_API:-http://127.0.0.1:4200}
MQ_DIR=/opt/magicq
SHOW=$HOME/Documents/MagicQ/show
TEMPLATE=$HOME/.highascg/test-env/magicq-psn-test
STATE=$HOME/.highascg/run/tracking-desk
CONSOLE_FILES=(status.dat laststatus.dat lastshow.shw)

die() { echo "tracking-desk: $*" >&2; exit 1; }
say() { echo "tracking-desk: $*"; }
mq_pids() { pgrep -x mqqt; }
puppet() { curl -s -m 5 -X POST "$API/api/tracking/puppet" -H 'content-type: application/json' -d "$1"; }

# The NIC address MagicQ joined 236.10.10.10 on (hex 0A0A0AEC in /proc/net/igmp), else empty.
psn_join_ip() {
	local dev
	dev=$(awk '/^[0-9]+\t/ {d=$2} /0A0A0AEC/ {print d; exit}' /proc/net/igmp)
	[ -n "$dev" ] && ip -4 -o addr show dev "$dev" | awk '{split($4,a,"/"); print a[1]; exit}'
}

cmd_up() {
	local display=:99 pattern=circle iface=""
	while [ $# -gt 0 ]; do
		case "$1" in
			--display) display=$2; shift 2 ;;
			--pattern) pattern=$2; shift 2 ;;
			--iface) iface=$2; shift 2 ;;
			*) die "unknown option $1" ;;
		esac
	done
	[ -x "$MQ_DIR/runmagicq.sh" ] || die "MagicQ PC is not installed in $MQ_DIR"
	for f in "${CONSOLE_FILES[@]}"; do [ -f "$TEMPLATE/$f" ] || die "missing $TEMPLATE/$f (the PSN Test console state, see the help page)"; done
	[ -f "$SHOW/PSN Test.shw" ] || die "missing \"$SHOW/PSN Test.shw\""
	curl -sf -m 5 "$API/api/tracking/puppet" >/dev/null || die "HighAsCG $API/api/tracking/puppet does not answer (node down or Tracking plugin off)"
	if mq_pids >/dev/null; then
		[ -f "$STATE/env" ] && die "already up — run status or down"
		die "MagicQ is already running (pid $(mq_pids | tr '\n' ' ')) — quit it first"
	fi
	mkdir -p "$STATE/magicq-backup"
	# 1. MagicQ's console files: back up every top-level file it may rewrite, then install the test state
	if [ ! -f "$STATE/env" ]; then
		find "$SHOW" -maxdepth 1 -type f \( -name '*.dat' -o -name '*.sbk' -o -name '*.xhw' -o -name 'lastshow.shw' \) \
			-exec cp -p {} "$STATE/magicq-backup/" \;
		(cd "$SHOW" && find . -maxdepth 1 -type f | sort) > "$STATE/files-before"
		: > "$STATE/env"
	fi
	for f in "${CONSOLE_FILES[@]}"; do cp "$TEMPLATE/$f" "$SHOW/$f"; done
	# 2. the display
	if [ "$display" = ":99" ] && [ ! -e /tmp/.X11-unix/X99 ]; then
		setsid -f Xvfb :99 -screen 0 1920x1080x24 -nolisten tcp >/dev/null 2>&1 3>&-
		for _ in $(seq 1 20); do [ -e /tmp/.X11-unix/X99 ] && break; sleep 0.25; done
		echo "xvfb=$(tr -d ' ' </tmp/.X99-lock)" >> "$STATE/env"
	fi
	echo "display=$display" >> "$STATE/env"
	# 3. MagicQ, answering its "Continue last show" question on a private display
	(cd "$MQ_DIR" && DISPLAY=$display QT_QPA_PLATFORM=xcb setsid -f ./runmagicq.sh >"$STATE/magicq.log" 2>&1 3>&-)
	say "MagicQ starting on $display"
	local win="" geo
	for _ in $(seq 1 40); do
		win=$(DISPLAY=$display xdotool search --onlyvisible --name '^SELECT$' 2>/dev/null | head -1)
		[ -n "$win" ] && break
		sleep 0.5
	done
	if [ -n "$win" ] && [ "$display" = ":99" ]; then
		geo=$(DISPLAY=$display xdotool getwindowgeometry "$win" | awk '/Position/ {split($2,p,","); print p[1], p[2]}')
		# shellcheck disable=SC2086  # "x y" → $1 $2
		set -- $geo
		DISPLAY=$display xdotool mousemove $(( $1 + 557 )) $(( $2 + 95 )) click 1
		say "answered \"Continue last show\" (PSN Test)"
	elif [ -n "$win" ]; then
		say "on $display: click \"Continue last show\" in MagicQ's SELECT window"
	fi
	# 4. which NIC MagicQ listens for PSN on → HighAsCG's PSN interface
	local joined=""
	for _ in $(seq 1 60); do joined=$(psn_join_ip); [ -n "$joined" ] && break; sleep 0.5; done
	if [ -z "$iface" ]; then
		iface=$joined
		[ -n "$iface" ] || { iface=10.0.0.13; say "MagicQ did not join the PSN group (locked? no GeNetix?) — using $iface"; }
	fi
	[ -n "$joined" ] && say "MagicQ joined 236.10.10.10 on $joined"
	node "$REPO/tools/test-env/tracking-desk-project.js" on --state "$STATE/project.json" --iface "$iface" --axes y_up || die "project output not switched on (see above); run down"
	# 5. the puppet
	puppet "{\"enabled\":true,\"pattern\":\"$pattern\"}" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const o=JSON.parse(s);console.log(o.error?`tracking-desk: puppet REFUSED: ${o.error}`:`tracking-desk: puppet ON — marker ${o.id} "${o.name}" ${o.pattern} ${o.speed} m/s, off by itself in ${Math.round(o.ends_in_s/60)} min`)})'
	say "watch: node tools/test-env/psn-sniff.js · MagicQ View → Trackers · down: tools/test-env/tracking-desk.sh down"
}

cmd_status() {
	curl -s -m 5 "$API/api/tracking/puppet" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const o=JSON.parse(s);const p=o.position||{};console.log(`puppet: ${o.enabled?"ON":"off"} ${o.pattern} id ${o.id} at (${p.x}, ${p.y}, ${p.z})${o.enabled?`, ${o.ends_in_s} s left`:o.stopped?` (stopped: ${o.stopped})`:""}`)}catch{console.log("puppet: no answer")}})'
	node "$REPO/tools/test-env/tracking-desk-project.js" status
	local mq join
	mq=$(mq_pids | tr '\n' ' ')
	join=$(psn_join_ip)
	echo "magicq: ${mq:-not running} · PSN group join: ${join:-none}"
	echo "xvfb :99: $([ -e /tmp/.X99-lock ] && tr -d ' ' </tmp/.X99-lock || echo none) · env state: $([ -f "$STATE/env" ] && echo up || echo none)"
	[ "${1:-}" = "--sniff" ] && node "$REPO/tools/test-env/psn-sniff.js" --secs 3
	return 0
}

cmd_down() {
	puppet '{"enabled":false}' >/dev/null && say "puppet off"
	node "$REPO/tools/test-env/tracking-desk-project.js" off --state "$STATE/project.json"
	local p
	if [ -f "$STATE/env" ] && mq_pids >/dev/null; then  # only the MagicQ this script started (up refuses a running one)
		for p in $(mq_pids); do kill -TERM "$p" 2>/dev/null; done
		for _ in $(seq 1 20); do mq_pids >/dev/null || break; sleep 0.5; done
		for p in $(mq_pids); do kill -KILL "$p" 2>/dev/null; done
		say "MagicQ quit"
	fi
	if [ -d "$STATE/magicq-backup" ]; then
		local n=0 f
		for f in "$STATE"/magicq-backup/*; do
			[ -f "$f" ] || continue
			cmp -s "$f" "$SHOW/$(basename "$f")" || { cp -p "$f" "$SHOW/"; n=$((n + 1)); }
		done
		for f in "${CONSOLE_FILES[@]}"; do [ -f "$STATE/magicq-backup/$f" ] || rm -f "$SHOW/$f"; done
		say "MagicQ console files restored ($n changed)"
		if [ -f "$STATE/files-before" ]; then
			(cd "$SHOW" && find . -maxdepth 1 -type f | sort) | comm -13 "$STATE/files-before" - | grep -v 'PSN Test' |
				sed 's/^/tracking-desk: new file left in the MagicQ show folder: /'
		fi
	fi
	local xpid
	xpid=$(sed -n 's/^xvfb=//p' "$STATE/env" 2>/dev/null)
	if [ -n "$xpid" ] && [ "$xpid" -gt 1 ] && [ "$(cat /proc/"$xpid"/comm 2>/dev/null)" = "Xvfb" ]; then
		kill -TERM "$xpid"
		for _ in $(seq 1 20); do [ -d /proc/"$xpid" ] || break; sleep 0.25; done
		[ -d /proc/"$xpid" ] || rm -f /tmp/.X99-lock /tmp/.X11-unix/X99
		say "Xvfb :99 stopped"
	fi
	rm -rf "$STATE"
	say "down"
}

case "${1:-}" in
	up) shift; cmd_up "$@" ;;
	down) cmd_down ;;
	status) shift; cmd_status "$@" ;;
	*) sed -n '2,8p' "$0" | sed 's/^# \{0,1\}//'; exit 2 ;;
esac
