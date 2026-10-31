#!/usr/bin/env bash
# WO-906 — the playout X screen switch from a shell (playout outputs on :0.1, the operator GUI alone on :0.0).
#   playout-screen.sh status            the switch, the installed X screens, the conf the config asks for
#   playout-screen.sh on | off          POST /api/system/playout-screen: flag + full apply (X layout through the root
#                                       helper, nodm restart, xrandr per screen, Caspar restart on its screen); a backup
#                                       of casparcg.config / caspar-env / casparServer lands in ~/.highascg/backup/wo906-*
#   playout-screen.sh off --emergency   the server does not answer: remove the X layout (kept as .prev), switch the flag
#                                       off in config/caspar_server.json, restart nodm, then restart the server and
#                                       re-apply once it answers (Caspar's window back on the one screen)
set -euo pipefail

API="${HIGHASCG_API:-http://127.0.0.1:4200}"
HELPER=/usr/local/lib/highascg/highascg-xorg-screens-apply.sh
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

case "${1:-status}" in
status)
	curl -fsS "$API/api/system/playout-screen" | python3 -c '
import json, sys
d = json.load(sys.stdin)
print("switch:", "on" if d.get("enabled") else "off")
for s in d.get("installed") or []:
    print("X screen %s %s origin %s,%s: %s" % (s["n"], s["display"], s["x"], s["y"], ",".join(s["outputs"])))
if not d.get("installed"):
    print("X: one screen")
if d.get("warning"):
    print("warning:", d["warning"])'
	;;
on | off)
	if [ "${2:-}" = "--emergency" ]; then
		[ "$1" = off ] || { echo "--emergency only switches off" >&2; exit 2; }
		sudo -n "$HELPER" off
		python3 - "$REPO/config/caspar_server.json" <<'PY'
import json, sys
p = sys.argv[1]
try:
    d = json.load(open(p))
except FileNotFoundError:
    sys.exit(0)
if d.pop("playout_x_screen", None) is not None:
    json.dump(d, open(p, "w"), indent="\t")
    print("flag removed from", p)
PY
		sudo -n systemctl restart nodm
		pid=$(systemctl show -p MainPID --value highascg)
		[ "${pid:-0}" -gt 1 ] && kill -TERM "$pid"
		for _ in $(seq 1 60); do
			curl -fsS -o /dev/null "$API/api/system/playout-screen" 2>/dev/null && break
			sleep 2
		done
		curl -fsS -X POST -H 'Content-Type: application/json' -d '{"force":true}' "$API/api/caspar-config/apply" >/dev/null &&
			echo "re-applied: one X screen" || echo "server not answering — run an Apply once it is up" >&2
		exit 0
	fi
	enable=false
	[ "$1" = on ] && enable=true
	curl -fsS -X POST -H 'Content-Type: application/json' -d "{\"enable\":$enable}" "$API/api/system/playout-screen" |
		python3 -c 'import json, sys; d = json.load(sys.stdin); a = d.get("apply") or {}; print("ok" if d.get("ok") else "FAILED", "| screens:", [s["display"] for s in d.get("installed") or []] or "one", "| backup:", d.get("backupDir"), "|", a.get("message") or a.get("error") or "")'
	;;
*)
	echo "usage: $0 status | on | off [--emergency]" >&2
	exit 2
	;;
esac
