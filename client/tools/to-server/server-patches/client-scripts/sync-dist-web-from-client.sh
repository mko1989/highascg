#!/usr/bin/env bash
# Sync Vite dist-web/ from highascg-client into this server checkout.
#
# Usage (server repo root):
#   bash client-scripts/sync-dist-web-from-client.sh
#   HIGHASCG_CLIENT_ROOT=/path/to/highascg-client bash client-scripts/sync-dist-web-from-client.sh
#   bash client-scripts/sync-dist-web-from-client.sh --build
#
set -euo pipefail

SERVER_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DO_BUILD=0

while [[ $# -gt 0 ]]; do
	case "$1" in
	--build) DO_BUILD=1 ;;
	-h | --help)
		sed -n '2,8p' "$0" | sed 's/^# \{0,1\}//'
		exit 0
		;;
	*)
		echo "Unknown option: $1" >&2
		exit 1
		;;
	esac
	shift || true
done

resolve_client_root() {
	if [[ -n "${HIGHASCG_CLIENT_ROOT:-}" ]]; then
		echo "$(cd "$HIGHASCG_CLIENT_ROOT" && pwd)"
		return 0
	fi
	local sibling="${SERVER_ROOT}/../highascg-client"
	if [[ -f "${sibling}/package.json" ]] && [[ -f "${sibling}/vite.config.js" ]]; then
		echo "$(cd "$sibling" && pwd)"
		return 0
	fi
	# Monorepo: client at repo root, server in not-needed/
	local mono="${SERVER_ROOT}/.."
	if [[ -f "${mono}/package.json" ]] && [[ -f "${mono}/vite.config.js" ]]; then
		echo "$(cd "$mono" && pwd)"
		return 0
	fi
	echo ""
}

CLIENT_ROOT="$(resolve_client_root)"
[[ -n "$CLIENT_ROOT" ]] || {
	echo "Could not find highascg-client. Set HIGHASCG_CLIENT_ROOT." >&2
	exit 1
}

echo "Client root: ${CLIENT_ROOT}"
echo "Server root: ${SERVER_ROOT}"

if [[ "$DO_BUILD" -eq 1 ]]; then
	echo "==> npm run build:client"
	(cd "$CLIENT_ROOT" && npm run build:client)
fi

[[ -f "${CLIENT_ROOT}/dist-web/index.html" ]] || {
	echo "Missing ${CLIENT_ROOT}/dist-web/index.html — run with --build or npm run build:client in client repo." >&2
	exit 1
}

echo "==> rsync dist-web/ → ${SERVER_ROOT}/dist-web/"
mkdir -p "${SERVER_ROOT}/dist-web"
rsync -a --delete "${CLIENT_ROOT}/dist-web/" "${SERVER_ROOT}/dist-web/"

if [[ -f "${CLIENT_ROOT}/to_server/dist-web/build-stamp.json" ]]; then
	rsync -a "${CLIENT_ROOT}/to_server/dist-web/build-stamp.json" "${SERVER_ROOT}/dist-web/build-stamp.json" 2>/dev/null || true
fi

echo "Done. Verify: test -f ${SERVER_ROOT}/dist-web/index.html"
