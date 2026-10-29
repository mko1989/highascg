#!/usr/bin/env bash
# WO-822: remove the :4443 HTTPS proxy (highascg-https-proxy.service).
#
# The proxy only existed so LAN browsers got a secure context for the WebCodecs live GUI preview (WO-319/325).
# That preview went with the kiosk (WO-646) and the stream encoder (WO-660); the operator web UI is plain
# http://<playout-ip>:4200/ and the Godot client does not need TLS. The proxy's certificate also had stale SANs
# (WO-498 §5) and the process forwarded every LAN client to loopback (WO-811 §1.5 #3), so it is removed, not kept.
#
# Usage (repo root):
#   sudo bash scripts/runtime/remove-highascg-https-proxy.sh                  # disable + stop + mask, remove the unit file
#   sudo REMOVE_CERTS=1 bash scripts/runtime/remove-highascg-https-proxy.sh   # ...and delete config/certs/highascg-{cert,key}.pem
#   DRY_RUN=1 bash scripts/runtime/remove-highascg-https-proxy.sh             # print the plan; no root needed, changes nothing
#
# Idempotent: every step tolerates "already gone", so a second run (or a run on a box that never had the proxy) is a no-op.
set -euo pipefail

UNIT=highascg-https-proxy.service
UNIT_FILE="/etc/systemd/system/${UNIT}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CERT_DIR="${HIGHASCG_CERT_DIR:-${REPO_ROOT}/config/certs}"
DRY_RUN="${DRY_RUN:-0}"

if [[ "$DRY_RUN" != "1" && "$(id -u)" -ne 0 ]]; then
	echo "Run as root: sudo $0   (or DRY_RUN=1 to print the plan)" >&2
	exit 1
fi

# run CMD...: execute, or just print under DRY_RUN
run() {
	if [[ "$DRY_RUN" == "1" ]]; then
		echo "  [dry-run] $*"
	else
		"$@"
	fi
}

known=0
if [[ -f "$UNIT_FILE" ]] || systemctl list-unit-files "$UNIT" 2>/dev/null | grep -q "^${UNIT}"; then
	known=1
fi

if [[ "$known" == "1" ]]; then
	echo "==> stopping and disabling ${UNIT}"
	run systemctl disable --now "$UNIT" || true
	echo "==> removing ${UNIT_FILE}"
	run rm -f "$UNIT_FILE"
	run systemctl daemon-reload || true
	# Masked so a stale copy of the unit template cannot quietly bring :4443 back.
	echo "==> masking ${UNIT}"
	run systemctl mask "$UNIT" || true
else
	echo "==> ${UNIT} not installed (nothing to stop)"
fi

if [[ "${REMOVE_CERTS:-0}" == "1" ]]; then
	echo "==> removing self-signed proxy certificate from ${CERT_DIR}"
	run rm -f "${CERT_DIR}/highascg-cert.pem" "${CERT_DIR}/highascg-key.pem"
	[[ -d "$CERT_DIR" ]] && run rmdir "$CERT_DIR" 2>/dev/null || true
else
	[[ -d "$CERT_DIR" ]] && echo "==> leaving ${CERT_DIR} (REMOVE_CERTS=1 deletes it; it is excluded from sticks, ISOs and releases)"
fi

echo "==> done. Operator UI: http://<playout-ip>:4200/"
echo "    Verify:  ss -ltn | grep 4443   (prints nothing)    systemctl is-enabled ${UNIT}   (masked)"
