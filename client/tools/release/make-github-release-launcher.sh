#!/usr/bin/env bash
# Multi-platform Electron launcher GitHub prerelease (+ optional dist-web tarball).
#
# Usage (repo root):
#   npm run release:github-launcher
#   ./client/tools/release/make-github-release-launcher.sh [--dry-run] [--replace] [--tag NAME] [--client-tarball-too]
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
INCLUDE_CLIENT_TARBALL=0

usage() {
	sed -n '2,/^set -euo/p' "$0" | head -n -1 | sed 's/^# \{0,1\}//'
	exit "${1:-0}"
}

while [[ $# -gt 0 ]]; do
	case "$1" in
	-h | --help) usage 0 ;;
	--dry-run) DRY_RUN=1 ;;
	--tag)
		TAG="${2:?}"
		shift
		;;
	--replace) REPLACE_RELEASE=1 ;;
	--out-dir)
		OUT_DIR="${2:?}"
		shift
		;;
	--client-tarball-too) INCLUDE_CLIENT_TARBALL=1 ;;
	*)
		echo "Unknown option: $1" >&2
		usage 1
		;;
	esac
	shift || true
done

STAMP="$(release_lib_stamp)"
if [[ -z "${TAG}" ]]; then
	TAG="launcher_$(release_lib_stamp_tag "$STAMP")"
	TAG="${TAG%Z}"
fi

DIST="${OUT_DIR:-${REPO_ROOT}/dist}"
PACK_OUT="${DIST}/launcher-pack"
mkdir -p "$DIST"

if [[ "$DRY_RUN" -eq 0 ]]; then
	release_lib_need_cmd zip
	release_lib_check_gh
fi

if [[ "$DRY_RUN" -eq 1 ]]; then
	echo "[dry-run] would run build-launcher-packages.sh"
else
	bash "${SCRIPT_DIR}/build-launcher-packages.sh" "$PACK_OUT"
fi

ASSETS=()
if [[ "$DRY_RUN" -eq 1 ]]; then
	echo "[dry-run] would zip each folder in $PACK_OUT"
else
	shopt -s nullglob
	for appdir in "$PACK_OUT"/*; do
		[[ -d "$appdir" ]] || continue
		base="$(basename "$appdir")"
		zip_path="${DIST}/${base}_${STAMP}.zip"
		rm -f "$zip_path"
		echo "==> Zip → $zip_path"
		(cd "$(dirname "$appdir")" && zip -qr "$zip_path" "$(basename "$appdir")")
		ASSETS+=("$zip_path")
	done
	shopt -u nullglob
	if [[ ${#ASSETS[@]} -eq 0 ]]; then
		echo "No launcher packages produced under $PACK_OUT" >&2
		exit 1
	fi
fi

ARCHIVE_PATH=""
if [[ "$INCLUDE_CLIENT_TARBALL" -eq 1 ]]; then
	ARCHIVE_BASENAME="highascg-client_${STAMP}"
	ARCHIVE_PATH="${DIST}/${ARCHIVE_BASENAME}.tar.gz"
	if [[ "$DRY_RUN" -eq 1 ]]; then
		echo "[dry-run] would pack dist-web → $ARCHIVE_PATH"
	else
		release_lib_need_cmd tar
		DIST_WEB="${REPO_ROOT}/dist-web"
		[[ -f "${DIST_WEB}/index.html" ]] || {
			echo "Missing dist-web — build runs via launcher:prepare" >&2
			exit 1
		}
		tar -C "$REPO_ROOT" -czf "$ARCHIVE_PATH" dist-web
		ASSETS+=("$ARCHIVE_PATH")
	fi
fi

NOTES="$(mktemp)"
trap 'rm -f "$NOTES"' EXIT

{
	echo "## HighAsCG Electron launcher (${STAMP})"
	echo ""
	echo "Multi-platform **bundled launcher** (prep kit + embedded \`dist-web/\` UI)."
	echo ""
	echo "| Asset | Platform |"
	echo "|-------|----------|"
	for z in "${ASSETS[@]:-}"; do
		[[ -n "$z" ]] || continue
		bn="$(basename "$z")"
		if [[ "$bn" == highascg-client_* ]]; then
			echo "| \`${bn}\` | dist-web only (optional) |"
		else
			echo "| \`${bn}\` | ${bn#HighAsCG-Launcher-} |"
		fi
	done
	echo ""
	echo "Connect to playout API (default :4200). Embedded UI on port **4350**."
	echo ""
	echo "[Launcher README](client/tools/electron-launcher/README.md)"
} >"$NOTES"

if [[ "$DRY_RUN" -eq 1 ]]; then
	echo "Tag: $TAG"
	cat "$NOTES"
	exit 0
fi

for a in "${ASSETS[@]}"; do
	release_lib_check_asset_size "$(basename "$a")" "$a"
done

release_lib_ensure_release_tag "$REPO_ROOT" "$TAG" "$REPLACE_RELEASE"
release_lib_create_prerelease "$REPO_ROOT" "$TAG" "Launcher ${STAMP}" "$NOTES" "${ASSETS[@]}"
echo "Packages in: $PACK_OUT"
