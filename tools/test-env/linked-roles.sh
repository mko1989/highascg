#!/usr/bin/env bash
# WO-979 — server-linking role-split test environment: one server plays out (MEDIA), the other does camera tracking,
# previs and the lighting / PSN output (TRACKING), linked node <-> node (RULES.md "Linked servers").
#
#   tools/test-env/linked-roles.sh up       two node-only sandbox servers on this box, linked, media = master; left up
#   tools/test-env/linked-roles.sh status   duties / peers / master / exchange / air of both
#   tools/test-env/linked-roles.sh down     stop them (exact PIDs) and delete their scratch roots
#   tools/test-env/linked-roles.sh run      the full scenario once on fresh sandboxes (run-cluster-e2e --scenario=duties)
#   tools/test-env/linked-roles.sh live <peer-host[:port]> [--self=media|tracking] [--look=<id>]
#                                           the same scenario on THIS box's live server + a real second box (it links
#                                           them while it runs and unlinks after; not on air — see the WO runbook)
#
# Sandboxes run `--no-caspar` (a simulated Caspar), HIGHASCG_SANDBOX=1, their own roots / keys / ports; the tracking one
# gets tools/test-env/fake-detect-sidecar.js as its "camera". PSN goes to 239.255.97.9 out of 127.0.0.1 only.
# Never touches the live :4200 server (except `live`, which needs --yes inside and the owner's go).
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$HERE/../.." && pwd)
STATE=${HIGHASCG_LINKED_ROLES_DIR:-${TMPDIR:-/tmp}/highascg-linked-roles-$(id -u)}

die() { echo "linked-roles: $*" >&2; exit 1; }

holder_pid() { [ -f "$STATE/env.json" ] && node -e 'console.log(require(process.argv[1]).holder)' "$STATE/env.json"; }

cmd_up() {
	local p
	p=$(holder_pid)
	if [ -n "$p" ] && kill -0 "$p" 2>/dev/null; then die "already up (holder pid $p) — status or down"; fi
	rm -rf "$STATE"
	mkdir -p "$STATE"
	# setsid + closed fd 3: the holder must not inherit a caller's flock (memory flock-children-inherit-lock-fd)
	setsid node "$REPO/tools/test-env/linked-roles.js" hold "$STATE" >"$STATE/holder.log" 2>&1 3>&- &
	for _ in $(seq 1 120); do
		[ -f "$STATE/env.json" ] && break
		grep -q 'up failed\|^linked-roles: down' "$STATE/holder.log" 2>/dev/null && { cat "$STATE/holder.log"; die "up failed"; }
		sleep 0.5
	done
	[ -f "$STATE/env.json" ] || { cat "$STATE/holder.log"; die "not up within 60 s"; }
	grep '^linked-roles: up' "$STATE/holder.log"
	node "$REPO/tools/test-env/linked-roles.js" status "$STATE"
}

cmd_down() {
	local p
	p=$(holder_pid)
	if [ -z "$p" ]; then echo "linked-roles: not up"; rm -rf "$STATE"; return 0; fi
	[ "$p" -gt 1 ] || die "bad holder pid '$p'"
	kill -TERM "$p" 2>/dev/null
	for _ in $(seq 1 40); do kill -0 "$p" 2>/dev/null || break; sleep 0.25; done
	kill -0 "$p" 2>/dev/null && die "holder $p still running"
	for role in media tracking; do
		local sp
		sp=$(node -e 'try{console.log(require(process.argv[1])[process.argv[2]].pid)}catch{}' "$STATE/env.json" "$role" 2>/dev/null)
		[ -n "$sp" ] && [ "$sp" -gt 1 ] && kill -0 "$sp" 2>/dev/null && kill -TERM "$sp"
	done
	rm -rf "$STATE"
	echo "linked-roles: down"
}

case "${1:-}" in
	up) cmd_up ;;
	down) cmd_down ;;
	status) node "$REPO/tools/test-env/linked-roles.js" status "$STATE" ;;
	run) shift; exec node "$REPO/tools/e2e/run-cluster-e2e.js" --scenario=duties "$@" ;;
	live)
		shift
		[ -n "${1:-}" ] || die "live <peer-host[:port]> [--self=media|tracking] [--look=<id>]"
		peer=$1; shift
		exec node "$REPO/tools/e2e/run-cluster-e2e.js" --scenario=duties --live --peer="$peer" --yes "$@" ;;
	*) sed -n '2,15p' "$0"; exit 2 ;;
esac
