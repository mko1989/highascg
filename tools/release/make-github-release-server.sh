#!/usr/bin/env bash
# Server (backend + dist-web UI) GitHub prerelease — no ISO.
#
# Usage (repo root):
#   npm run release:github-server
#   npm run release:github-server:dry
#   ./tools/release/make-github-release-server.sh [--dry-run] [--replace] [--tag NAME] [--no-bump-package]
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=release-lib.sh
source "${SCRIPT_DIR}/release-lib.sh"

REPO_ROOT="$(release_lib_repo_root)"
DRY_RUN=0
TAG=""
REPLACE_RELEASE=0
OUT_DIR=""
ZIP_EXCLUDE_NODE_MODULES=0
BUMP_PACKAGE=1
BUILD_STAMP_FILE=""
NOTES=""

usage() {
	sed -n '2,/^set -euo/p' "$0" | head -n -1 | sed 's/^# \{0,1\}//'
	exit "${1:-0}"
}

cleanup_release() {
	rm -f "${BUILD_STAMP_FILE:-}"
	release_lib_restore_package_json "$REPO_ROOT"
	[[ -n "${NOTES:-}" ]] && rm -f "$NOTES"
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
	--zip-exclude-node-modules) ZIP_EXCLUDE_NODE_MODULES=1 ;;
	--no-bump-package) BUMP_PACKAGE=0 ;;
	*)
		echo "Unknown option: $1" >&2
		usage 1
		;;
	esac
	shift || true
done

STAMP="$(release_lib_stamp)"
BUILD_STAMP_FILE="${REPO_ROOT}/BUILD_STAMP"
trap cleanup_release EXIT
if [[ -z "${TAG}" ]]; then
	TAG="$(release_lib_stamp_tag "$STAMP")"
	TAG="${TAG%Z}"
fi

DIST="${OUT_DIR:-${REPO_ROOT}/dist}"
ARCHIVE_BASENAME="highascg-server_${STAMP}"
ARCHIVE_PATH="${DIST}/${ARCHIVE_BASENAME}.tar.gz"
mkdir -p "$DIST"

if [[ "$DRY_RUN" -eq 0 ]]; then
	release_lib_need_cmd tar
	release_lib_check_gh
fi

build_server_archive() {
	local -a paths=()
	archive_common_server_tar_members paths

	if [[ "$BUMP_PACKAGE" -eq 1 ]]; then
		if [[ "$DRY_RUN" -eq 1 ]]; then
			echo "[dry-run] would set package.json version → ${STAMP}"
		else
			release_lib_bump_package_json "$REPO_ROOT" "$STAMP"
			echo "==> package.json version → ${STAMP} (restored after tarball)"
		fi
	fi

	echo "$STAMP" >"${REPO_ROOT}/BUILD_STAMP"
	paths+=(BUILD_STAMP)
	if [[ "$ZIP_EXCLUDE_NODE_MODULES" -eq 0 ]] && [[ -d "${REPO_ROOT}/node_modules" ]]; then
		paths+=(node_modules)
	fi
	local -a missing=()
	local p
	for p in "${paths[@]}"; do
		[[ -e "${REPO_ROOT}/${p}" ]] || missing+=("$p")
	done
	if ((${#missing[@]})); then
		echo "Missing paths for server release: ${missing[*]}" >&2
		exit 1
	fi

	local -a tar_args=(-C "$REPO_ROOT" -czf "$ARCHIVE_PATH")
	archive_common_server_tar_excludes tar_args
	archive_common_bulk_tar_excludes tar_args
	[[ "$ZIP_EXCLUDE_NODE_MODULES" -eq 1 ]] && tar_args+=(--exclude="./node_modules")
	tar_args+=("${paths[@]}")

	if [[ "$DRY_RUN" -eq 1 ]]; then
		echo "[dry-run] would create $ARCHIVE_PATH"
		echo "[dry-run] would write BUILD_STAMP=$STAMP"
		echo "[dry-run] paths: ${paths[*]} nm_excl=$ZIP_EXCLUDE_NODE_MODULES bump_pkg=$BUMP_PACKAGE"
		return 0
	fi
	rm -f "$ARCHIVE_PATH"
	echo "==> BUILD_STAMP ${STAMP}"
	echo "==> Server tarball → $ARCHIVE_PATH"
	tar "${tar_args[@]}"
	archive_common_print_size_hints "$ARCHIVE_PATH"
}

build_server_archive

NM_NOTE="Includes **node_modules**."
[[ "$ZIP_EXCLUDE_NODE_MODULES" -eq 1 ]] && NM_NOTE="**node_modules** omitted — run \`npm ci\` after extract."

NOTES="$(mktemp)"

cat >"$NOTES" <<EOF
## HighAsCG server (${STAMP})

Unified playout stack for sticks (**\`drop-update/\`** on \`HIGHASCGEXF\`): API + operator UI (\`dist-web/\` built from in-repo \`client/\`).

| Asset | Extract |
|-------|---------|
| \`${ARCHIVE_BASENAME}.tar.gz\` | \`mkdir -p <mount>/drop-update && tar -xzf … -C <mount>/drop-update\` |

${NM_NOTE}

**Version:** \`BUILD_STAMP\` and \`package.json\` \`version\` = \`${STAMP}\`.

**Start:** \`node index.js\` — **\`http://<playout-ip>:4200/\`** (API + UI). \`HIGHASCG_HEADLESS=true\` is API-only debug.

Optional [**highascg-client**](https://github.com/mko1989/highascg-client) Electron app: simulator, multiserver, modules — opens browser to playout; **not** the UI source tree.

See [\`docs/ARCHITECTURE.md\`](docs/ARCHITECTURE.md) · [\`docs/DEV_RELEASE_GITHUB.md\`](docs/DEV_RELEASE_GITHUB.md)
EOF

if [[ "$DRY_RUN" -eq 1 ]]; then
	echo "Tag: $TAG"
	echo "Archive: $ARCHIVE_PATH"
	cat "$NOTES"
	exit 0
fi

release_lib_check_asset_size "server tarball" "$ARCHIVE_PATH"
release_lib_ensure_release_tag "$REPO_ROOT" "$TAG" "$REPLACE_RELEASE"
release_lib_create_prerelease "$REPO_ROOT" "$TAG" "Server ${STAMP}" "$NOTES" "$ARCHIVE_PATH"
echo "Local tarball: $ARCHIVE_PATH"
