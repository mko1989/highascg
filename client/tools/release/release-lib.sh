#!/usr/bin/env bash
# Shared helpers for client GitHub releases.
set -euo pipefail

release_lib_repo_root() {
	(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)
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
	echo "${1/T/_}"
}

MAX_GITHUB_ASSET=$((2 * 1024 * 1024 * 1024 - 100 * 1024 * 1024))

release_lib_check_asset_size() {
	local label="$1" path="$2"
	[[ -f "$path" ]] || return 0
	local s
	s=$(stat -c %s "$path" 2>/dev/null || stat -f %z "$path")
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

release_lib_create_prerelease() {
	local repo_root="$1" tag="$2" title="$3" notes_file="$4"
	shift 4
	(cd "$repo_root" &&
		gh release create "$tag" \
			--prerelease \
			--title "$title" \
			--notes-file "$notes_file" \
			"$@")
	local base_url owner_repo
	base_url="$(cd "$repo_root" && gh repo view --json url -q .url)"
	owner_repo="$(cd "$repo_root" && gh repo view --json nameWithOwner -q .nameWithOwner)"
	echo ""
	echo "Release: ${base_url}/releases/tag/${tag}  (${owner_repo})"
}
