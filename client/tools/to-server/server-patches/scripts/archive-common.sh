#!/usr/bin/env bash
# Shared paths and tar/rsync excludes for src/ (root) + client/ + dist-web/ layout.
# Source from deploy and release scripts (do not execute directly).
# Compatible with macOS /bin/bash 3.2 (no namerefs).
#
# Layout:
#   src/         — Node server (repo root)
#   client/      — Browser UI sources (ES modules) — not shipped on playout when dist-web/ exists
#   dist-web/    — Vite bundle — served on playout :4200 (WO-52)
#   index.js     — Server entry
#
set -euo pipefail

archive_common_repo_root() {
	local script="${BASH_SOURCE[1]:-${BASH_SOURCE[0]}}"
	(cd "$(dirname "$script")/.." && pwd)
}

# Append to caller array (bash 3.2 — no local -n).
_archive_common_array_append() {
	local _var="$1"
	shift
	# shellcheck disable=SC2016
	eval "${_var}"'+=("$@")'
}

# Explicit members for server GitHub tarball (built UI, no client/ sources).
archive_common_server_tar_members() {
	local _out="$1"
	_archive_common_array_append "$_out" \
		index.js package.json package-lock.json src config template scripts tools/runtime
	if [[ "${RELEASE_SERVER_ONLY:-0}" != "1" ]]; then
		_archive_common_array_append "$_out" dist-web
	fi
}

# Runtime / workstation bulk excluded from release and deploy archives.
archive_common_bulk_tar_excludes() {
	local _ex="$1"
	_archive_common_array_append "$_ex" \
		--exclude="./media" \
		--exclude="./_media" \
		--exclude="./data" \
		--exclude="./refs" \
		--exclude="./bin" \
		--exclude="./lib" \
		--exclude="./cef-cache" \
		--exclude="./log" \
		--exclude="./core" \
		--exclude="./dist" \
		--exclude="./CasparCG_Enhanced-main" \
		--exclude="./examples" \
		--exclude="./samples" \
		--exclude="./scratch" \
		--exclude="./.reference" \
		--exclude="./.cursor" \
		--exclude="./.cursor-server" \
		--exclude="./*.log" \
		--exclude="./server.log" \
		--exclude="./health.json" \
		--exclude="./libndi.so.6" \
		--exclude="./casparcg.config" \
		--exclude="./highascg.config.json" \
		--exclude="./highascg.config.json.bak" \
		--exclude="./autosave.json" \
		--exclude="./*.pyc" \
		--exclude="./__pycache__"
}

# Deploy tarball excludes (dev-push, deploy-tar-to-tmp).
archive_common_deploy_tar_excludes() {
	local _ex="$1"
	_archive_common_array_append "$_ex" \
		--exclude=node_modules \
		--exclude=.git \
		--exclude=work \
		--exclude=.env \
		--exclude=.env.local \
		--exclude='*.log' \
		--exclude=highascg.config.json \
		--exclude=.highascg-state.json \
		--exclude=.module-state.json \
		--exclude=.highascg-previs \
		--exclude='config/*.json'
	archive_common_bulk_tar_excludes "$_ex"
}

# Server tarball: never ship client/ sources; dist-web/ included unless RELEASE_SERVER_ONLY=1 (WO-52).
archive_common_server_tar_excludes() {
	local _ex="$1"
	_archive_common_array_append "$_ex" \
		--exclude=./client \
		--exclude=./dist/launcher
	if [[ "${RELEASE_SERVER_ONLY:-0}" == "1" ]]; then
		_archive_common_array_append "$_ex" --exclude=./dist-web
	fi
}

# Omit client/ dev tree when shipping a built dist-web/ (monolith / legacy).
archive_common_exclude_client_sources() {
	local _ex="$1"
	_archive_common_array_append "$_ex" --exclude=./client
}

# Run Vite when DEPLOY_BUILD_CLIENT=1 or RELEASE_BUILD_CLIENT=1 (default 0).
# WO-52: prefer syncing dist-web/ from highascg-client via client-scripts/sync-dist-web-from-client.sh
archive_common_build_client_if_requested() {
	local root="$1"
	if [[ "${DEPLOY_BUILD_CLIENT:-0}" != "1" && "${RELEASE_BUILD_CLIENT:-0}" != "1" ]]; then
		return 0
	fi
	if [[ ! -f "${root}/package.json" ]]; then
		echo "archive-common: no package.json under $root" >&2
		return 1
	fi
	echo "==> Vite production build (dist-web/)"
	(cd "$root" && npm run build:client)
}

# Deploy default: server + dist-web/ (WO-52). Set DEPLOY_SERVER_ONLY=1 for API-only emergency deploy.
archive_common_apply_deploy_packaging_rules() {
	local root="$1"
	local _ex="$2"
	if [[ "${DEPLOY_SERVER_ONLY:-0}" == "1" ]]; then
		RELEASE_SERVER_ONLY=1 archive_common_server_tar_excludes "$_ex"
		return 0
	fi
	archive_common_apply_client_packaging_rules "$root" "$_ex"
}

# After build: exclude client/ unless ARCHIVE_INCLUDE_CLIENT_SOURCES=1.
archive_common_apply_client_packaging_rules() {
	local root="$1"
	local _ex="$2"
	if [[ "${ARCHIVE_INCLUDE_CLIENT_SOURCES:-0}" == "1" ]]; then
		return 0
	fi
	if [[ -f "${root}/dist-web/index.html" ]]; then
		archive_common_exclude_client_sources "$_ex"
	fi
}

# Print size hints for server tarball (why it is large).
archive_common_print_size_hints() {
	local archive_path="${1:-}"
	echo "    Server tarball size is usually dominated by:"
	echo "      • node_modules/ (runtime deps; use --zip-exclude-node-modules + npm ci on target)"
	echo "      • tools/runtime/ (exfat-sync-cli, staged Caspar helpers)"
	echo "      • src/ (orchestrator + APIs at repo root)"
	if [[ "${RELEASE_SERVER_ONLY:-0}" == "1" ]]; then
		echo "    UI omitted (RELEASE_SERVER_ONLY=1) — use highascg-client dist-web or WO-52 full server tar."
	else
		echo "      • dist-web/ (operator UI — also npm run release:github-client for UI-only hotfix)"
	fi
	if [[ -n "$archive_path" && -f "$archive_path" ]]; then
		echo "    This archive: $(du -h "$archive_path" | cut -f1)  $archive_path"
	fi
}
