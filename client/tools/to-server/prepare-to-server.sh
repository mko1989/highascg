#!/usr/bin/env bash
# Stage WO-52 server handoff into repo-root to_server/ (gitignored).
#
# Usage (from highascg-client repo root):
#   npm run to-server:prepare
#   bash client/tools/to-server/prepare-to-server.sh [--no-build]
#
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLIENT_ROOT="$(cd "${HERE}/../../.." && pwd)"
TO_SERVER="${CLIENT_ROOT}/to_server"
PATCHES_SRC="${HERE}/server-patches"
SKIP_BUILD=0

while [[ $# -gt 0 ]]; do
	case "$1" in
	--no-build) SKIP_BUILD=1 ;;
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

cd "$CLIENT_ROOT"

if [[ "$SKIP_BUILD" -eq 0 ]]; then
	echo "==> Vite build (dist-web/)"
	npm run build:client
fi

[[ -f "${CLIENT_ROOT}/dist-web/index.html" ]] || {
	echo "Missing dist-web/index.html — run npm run build:client" >&2
	exit 1
}

echo "==> Sync dist-web/ → to_server/dist-web/"
rm -rf "${TO_SERVER}/dist-web"
mkdir -p "${TO_SERVER}"
rsync -a --delete "${CLIENT_ROOT}/dist-web/" "${TO_SERVER}/dist-web/"

STAMP="$(date -u +%Y-%m-%dT%H%M:%SZ)"
cat >"${TO_SERVER}/dist-web/build-stamp.json" <<EOF
{
  "builtAt": "${STAMP}",
  "clientPackage": "$(node -p "require('./package.json').version" 2>/dev/null || echo unknown)",
  "wo": "52-server-hosted-ui"
}
EOF

echo "==> Copy server patches → to_server/server/"
rm -rf "${TO_SERVER}/server"
mkdir -p "${TO_SERVER}/server"
rsync -a "${PATCHES_SRC}/" "${TO_SERVER}/server/"

cp "${HERE}/apply-to-server.sh" "${TO_SERVER}/apply-to-server.sh"
cp "${HERE}/README.md" "${TO_SERVER}/README.md"
cp "${HERE}/WO52_SERVER_HANDOFF.md" "${TO_SERVER}/WO52_SERVER_HANDOFF.md"
cp "${HERE}/AGENT_SERVER_CLIENT_MERGE.md" "${TO_SERVER}/AGENT_SERVER_CLIENT_MERGE.md"
cp "${HERE}/RESTORE_AFTER_BAD_DEPLOY.md" "${TO_SERVER}/RESTORE_AFTER_BAD_DEPLOY.md"
cp "${HERE}/MANIFEST.txt" "${TO_SERVER}/MANIFEST.txt"
chmod +x "${TO_SERVER}/apply-to-server.sh"

echo ""
echo "Ready: ${TO_SERVER}/"
echo "  dist-web/     — production UI bundle"
echo "  server/       — patched files (mirror server repo paths)"
echo "  apply-to-server.sh — copy into highascg-server checkout"
echo ""
echo "Next: SERVER_ROOT=/path/to/highascg-server bash to_server/apply-to-server.sh"
