#!/usr/bin/env bash
# Shared helpers for split GitHub releases (server / client).
set -euo pipefail

RELEASE_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../../scripts/archive-common.sh
source "${RELEASE_LIB_DIR}/../../scripts/lib/archive-common.sh"

release_lib_repo_root() {
	(cd "${RELEASE_LIB_DIR}/../.." && pwd)
}

release_lib_need_cmd() {
	command -v "$1" >/dev/null 2>&1 || {
		echo "Missing command: $1" >&2
		exit 1
	}
}

release_lib_check_gh() {
	release_lib_need_cmd gh
	gh auth status >/dev/null 2>&1 || {
		echo "gh not authenticated. Run: gh auth login" >&2
		exit 1
	}
}

release_lib_stamp() {
	date -u +%Y-%m-%dT%H%M%SZ
}

release_lib_stamp_tag() {
	# 2026-05-19T134531Z → 2026-05-19_134531Z
	echo "${1/T/_}"
}

MAX_GITHUB_ASSET=$((2 * 1024 * 1024 * 1024 - 100 * 1024 * 1024))

release_lib_check_asset_size() {
	local label="$1" path="$2"
	[[ -f "$path" ]] || return 0
	local s
	s=$(stat -c %s "$path")
	if ((s > MAX_GITHUB_ASSET)); then
		echo "ERROR: $label exceeds GitHub ~2 GiB asset limit: $path ($s bytes)" >&2
		exit 1
	fi
}

release_lib_ensure_release_tag() {
	local repo_root="$1" tag="$2" replace="$3"
	if (cd "$repo_root" && gh release view "$tag" >/dev/null 2>&1); then
		if [[ "$replace" -eq 1 ]]; then
			(cd "$repo_root" &&
				gh release delete "$tag" --yes --cleanup-tag 2>/dev/null || gh release delete "$tag" --yes) || true
		else
			echo "Release tag $tag already exists. Use --replace or pass --tag <new>." >&2
			exit 1
		fi
	fi
}

# WO-467: RELEASE_LIB_LATEST=1 publishes a full release marked Latest instead of a prerelease.
# Default stays --prerelease so existing callers are unchanged.
release_lib_create_prerelease() {
	local repo_root="$1" tag="$2" title="$3" notes_file="$4"
	shift 4
	local -a kind=(--prerelease)
	[[ "${RELEASE_LIB_LATEST:-0}" == "1" ]] && kind=(--latest)
	(cd "$repo_root" &&
		gh release create "$tag" \
			"${kind[@]}" \
			--title "$title" \
			--notes-file "$notes_file" \
			"$@")
	local base_url owner_repo
	base_url="$(cd "$repo_root" && gh repo view --json url -q .url)"
	owner_repo="$(cd "$repo_root" && gh repo view --json nameWithOwner -q .nameWithOwner)"
	echo ""
	echo "Release: ${base_url}/releases/tag/${tag}  (${owner_repo})"
}

# Temporary package.json version bump for server tarballs (WO-66 T2.2).
_RELEASE_LIB_PKG_BACKUP=""

release_lib_bump_package_json() {
	local repo_root="$1" stamp="$2"
	local pkg="${repo_root}/package.json"
	[[ -f "$pkg" ]] || {
		echo "release_lib_bump_package_json: missing ${pkg}" >&2
		return 1
	}
	release_lib_need_cmd node
	_RELEASE_LIB_PKG_BACKUP="$(mktemp)"
	cp "$pkg" "$_RELEASE_LIB_PKG_BACKUP"
	STAMP="$stamp" PKG="$pkg" node <<'NODE'
const fs = require('fs')
const pkg = process.env.PKG
const stamp = process.env.STAMP
const j = JSON.parse(fs.readFileSync(pkg, 'utf8'))
j.version = stamp
fs.writeFileSync(pkg, `${JSON.stringify(j, null, '\t')}\n`)
NODE
}

release_lib_restore_package_json() {
	local repo_root="${1:-}"
	if [[ -z "$_RELEASE_LIB_PKG_BACKUP" || ! -f "$_RELEASE_LIB_PKG_BACKUP" ]]; then
		return 0
	fi
	local pkg
	if [[ -n "$repo_root" ]]; then
		pkg="${repo_root}/package.json"
	else
		pkg="$(dirname "$_RELEASE_LIB_PKG_BACKUP")/package.json"
	fi
	mv -f "$_RELEASE_LIB_PKG_BACKUP" "$pkg"
	_RELEASE_LIB_PKG_BACKUP=""
}
