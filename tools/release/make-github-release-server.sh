#!/usr/bin/env bash
# Server (backend + dist-web UI) GitHub prerelease — no ISO.
#
# Usage (repo root):
#   npm run release:github-server
#   npm run release:github-server:dry
#   ./tools/release/make-github-release-server.sh [--dry-run] [--replace] [--tag NAME] [--no-bump-package]
#                                                  [--latest] [--no-starter-zips]
#
# --latest            publish as a full release marked Latest (default: prerelease)
# --no-starter-zips   skip the HIGHASCGEXF / HIGHASCGDAT starter layout zips (default: attach both,
#                     rebuilt from the repo so the release never ships a stale snapshot)
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
STARTER_ZIPS=1
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
	--latest) export RELEASE_LIB_LATEST=1 ;;
	--no-starter-zips) STARTER_ZIPS=0 ;;
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

| Asset | Where it goes |
|-------|---------------|
| \`${ARCHIVE_BASENAME}.tar.gz\` | \`mkdir -p <mount>/drop-update && tar -xzf … -C <mount>/drop-update\` |
| \`HIGHASCGEXF-starter-layout.zip\` | Unzip at the **root of the \`HIGHASCGEXF\`** partition (operator stick) |
| \`HIGHASCGDAT-starter-layout.zip\` | Unzip at the **root of the \`HIGHASCGDAT\`** bridge volume |

Stick prep (Ventoy + a reserved exFAT partition at the end): [\`docs/STICK_QUICK_START.md\`](docs/STICK_QUICK_START.md)

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

# WO-467: operators need the stick layout zips from the same place as the server drop. Rebuilt
# here rather than copied from docs/guides/stick/ — that checked-in pair is a snapshot and lags.
ASSETS=("$ARCHIVE_PATH")
if [[ "$STARTER_ZIPS" -eq 1 ]]; then
	echo "==> Starter layout zips (rebuilt from the repo)"
	bash "${REPO_ROOT}/tools/eggs/live-usb/pack-exfat-starter-zip.sh" >/dev/null
	bash "${REPO_ROOT}/tools/eggs/live-usb/pack-bridge-starter-zip.sh" >/dev/null
	for z in HIGHASCGEXF-starter-layout.zip HIGHASCGDAT-starter-layout.zip; do
		if [[ -f "${REPO_ROOT}/dist/${z}" ]]; then
			release_lib_check_asset_size "$z" "${REPO_ROOT}/dist/${z}"
			ASSETS+=("${REPO_ROOT}/dist/${z}")
			echo "    ${z} ($(du -h "${REPO_ROOT}/dist/${z}" | cut -f1))"
		else
			echo "ERROR: ${z} missing after pack — refusing to publish a release without it" >&2
			exit 1
		fi
	done
fi

release_lib_ensure_release_tag "$REPO_ROOT" "$TAG" "$REPLACE_RELEASE"
release_lib_create_prerelease "$REPO_ROOT" "$TAG" "Server ${STAMP}" "$NOTES" "${ASSETS[@]}"
echo "Local tarball: $ARCHIVE_PATH"
