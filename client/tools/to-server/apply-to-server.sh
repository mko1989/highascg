#!/usr/bin/env bash
# Apply to_server/ handoff into a highascg-server checkout.
#
# Usage:
#   SERVER_ROOT=/path/to/highascg-server bash to_server/apply-to-server.sh
#   bash to_server/apply-to-server.sh /path/to/highascg-server
#
set -euo pipefail

TO_SERVER="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_ROOT="${1:-${SERVER_ROOT:-}}"

if [[ -z "$SERVER_ROOT" ]]; then
	# Default sibling checkout used in this monorepo layout
	CAND="${TO_SERVER}/../not-needed"
	if [[ -f "${CAND}/index.js" ]]; then
		SERVER_ROOT="$CAND"
	else
		echo "Set SERVER_ROOT or pass server checkout path as first argument." >&2
		exit 1
	fi
fi

SERVER_ROOT="$(cd "$SERVER_ROOT" && pwd)"

[[ -f "${SERVER_ROOT}/index.js" ]] || {
	echo "Not a server root (missing index.js): $SERVER_ROOT" >&2
	exit 1
}

echo "==> Apply dist-web/ → ${SERVER_ROOT}/dist-web/"
rsync -a --delete "${TO_SERVER}/dist-web/" "${SERVER_ROOT}/dist-web/"

echo "==> Apply server patches → ${SERVER_ROOT}/"
if [[ -d "${TO_SERVER}/server" ]]; then
	rsync -a "${TO_SERVER}/server/" "${SERVER_ROOT}/"
fi

echo ""
echo "Applied WO-52 server handoff to: ${SERVER_ROOT}"
echo "On playout: remove /etc/systemd/system/highascg.service.d/10-headless.conf if present,"
echo "  then: sudo systemctl daemon-reload && sudo systemctl restart highascg"
echo "Open UI: http://<playout-ip>:4200/"
