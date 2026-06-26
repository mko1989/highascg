#!/usr/bin/env bash
# Client (Vite dist-web) GitHub prerelease — static UI only, no server / ISO.
#
# Usage (repo root):
#   npm run release:github-client
#   npm run release:github-client:dry
#   ./client/tools/release/make-github-release-client.sh [--dry-run] [--replace] [--tag NAME] [--no-build]
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./release-lib.sh
source "${SCRIPT_DIR}/release-lib.sh"

REPO_ROOT="$(release_lib_repo_root)"
DRY_RUN=0
TAG=""
REPLACE_RELEASE=0
OUT_DIR=""
SKIP_BUILD=0

usage() {
	sed -n '2,/^set -euo/p' "$0" | head -n -1 | sed 's/^# \{0,1\}//'
	exit "${1:-0}"
}

while [[ $# -gt 0 ]]; do
	case "$1" in
	-h | --help) usage 0 ;;
	--dry-run) DRY_RUN=1 ;;
	--no-build) SKIP_BUILD=1 ;;
	--tag)
		TAG="${2:?}"
		shift
		;;
	--replace) REPLACE_RELEASE=1 ;;
	--out-dir)
		OUT_DIR="${2:?}"
		shift
		;;
	*)
		echo "Unknown option: $1" >&2
		usage 1
		;;
	esac
	shift || true
done

STAMP="$(release_lib_stamp)"
if [[ -z "${TAG}" ]]; then
	TAG="$(release_lib_stamp_tag "$STAMP")"
	TAG="${TAG%Z}"
fi

DIST="${OUT_DIR:-${REPO_ROOT}/dist}"
DIST_WEB="${REPO_ROOT}/dist-web"
ARCHIVE_BASENAME="highascg-client_${STAMP}"
ARCHIVE_PATH="${DIST}/${ARCHIVE_BASENAME}.tar.gz"
mkdir -p "$DIST"

if [[ "$DRY_RUN" -eq 0 ]]; then
	release_lib_need_cmd tar
	release_lib_check_gh
fi

build_client_dist() {
	if [[ "$SKIP_BUILD" -eq 1 ]]; then
		echo "==> Skipping Vite build (--no-build)"
		return 0
	fi
	if [[ "$DRY_RUN" -eq 1 ]]; then
		echo "[dry-run] would run: npm run build:client"
		return 0
	fi
	echo "==> Vite production build (dist-web/)"
	(cd "$REPO_ROOT" && npm run build:client)
}

build_client_archive() {
	if [[ "$DRY_RUN" -eq 1 ]]; then
		echo "[dry-run] would pack dist-web/ → $ARCHIVE_PATH"
		return 0
	fi
	if [[ ! -f "${DIST_WEB}/index.html" ]]; then
		echo "Missing ${DIST_WEB}/index.html — run build first or drop --no-build." >&2
		exit 1
	fi
	rm -f "$ARCHIVE_PATH"
	echo "==> Frontend tarball → $ARCHIVE_PATH"
	tar -C "$REPO_ROOT" -czf "$ARCHIVE_PATH" dist-web
	echo "==> Ready: $(du -h "$ARCHIVE_PATH" | cut -f1)  $ARCHIVE_PATH"
}

build_client_dist
build_client_archive

NOTES="$(mktemp)"
trap 'rm -f "$NOTES"' EXIT

cat >"$NOTES" <<EOF
## HighAsCG client (${STAMP})

Vite production bundle (\`dist-web/\`) for the **Electron launcher** or legacy extract under \`sim/highascg/\`.

| Asset | Use |
|-------|-----|
| \`${ARCHIVE_BASENAME}.tar.gz\` | **Recommended:** \`npm run launcher:prepare\` uses this tree; or extract beside launcher |

Production playout runs **API only** (\`HIGHASCG_HEADLESS=true\`). Open UI with \`npm run launcher\` and set playout API host/port.

Requires matching **server** tarball on \`update/server/\` or embedded on ISO.

[\`client/tools/electron-launcher/README.md\`](client/tools/electron-launcher/README.md) · server/API sources: [\`not-needed/\`](../not-needed/)
EOF

if [[ "$DRY_RUN" -eq 1 ]]; then
	echo "Tag: $TAG"
	echo "Archive: $ARCHIVE_PATH"
	cat "$NOTES"
	exit 0
fi

release_lib_check_asset_size "client tarball" "$ARCHIVE_PATH"
release_lib_ensure_release_tag "$REPO_ROOT" "$TAG" "$REPLACE_RELEASE"
release_lib_create_prerelease "$REPO_ROOT" "$TAG" "Frontend ${STAMP}" "$NOTES" "$ARCHIVE_PATH"
echo "Local tarball: $ARCHIVE_PATH"
