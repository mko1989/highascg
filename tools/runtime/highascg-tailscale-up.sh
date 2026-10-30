#!/usr/bin/env bash
# Privileged Tailscale login / bring-up for HighAsCG (WO-91).
# Reads hostname + acceptRoutes from config/tailscale.json — no caller-controlled args.
#
#   sudo /usr/local/lib/highascg/highascg-tailscale-up.sh
set -euo pipefail

CONFIG="${HIGHASCG_TAILSCALE_CONFIG:-/home/casparcg/highascg/config/tailscale.json}"
if [[ ! -f "$CONFIG" && -f /etc/highascg/tailscale.json ]]; then
	CONFIG=/etc/highascg/tailscale.json
fi

HOSTNAME=""
ACCEPT_ROUTES=0
if [[ -f "$CONFIG" ]] && command -v python3 >/dev/null 2>&1; then
	# WO-842 (sweep 5 Ops): one value per LINE. `print(hostname, accept)` + `read -r HOSTNAME ACCEPT_ROUTES` collapsed the
	# blank hostname (the default) so " 0" became HOSTNAME=0 -> `tailscale up --hostname 0`, and a hostname with a
	# space split in two.
	mapfile -t _cfg < <(python3 - "$CONFIG" <<'PY'
import json, sys
path = sys.argv[1]
try:
    with open(path, encoding="utf-8") as f:
        cfg = json.load(f)
except Exception:
    cfg = {}
hostname = str(cfg.get("hostname") or "").strip()
hostname = hostname.splitlines()[0].strip() if hostname else ""
accept = "1" if cfg.get("acceptRoutes") is True else "0"
print(hostname)
print(accept)
PY
)
	HOSTNAME="${_cfg[0]:-}"
	ACCEPT_ROUTES="${_cfg[1]:-0}"
fi

ARGS=(up)
if [[ -n "$HOSTNAME" ]]; then
	ARGS+=(--hostname "$HOSTNAME")
fi
if [[ "$ACCEPT_ROUTES" == "1" ]]; then
	ARGS+=(--accept-routes)
fi

for bin in /usr/bin/tailscale /snap/bin/tailscale; do
	if [[ -x "$bin" ]]; then
		exec "$bin" "${ARGS[@]}"
	fi
done

echo "tailscale CLI not found" >&2
exit 1
