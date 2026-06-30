#!/usr/bin/env bash
# Shared paths and tar/rsync excludes for unified repo layout.
# Source from deploy and release scripts (do not execute directly).
#
# Layout:
#   src/         — Node server (repo root)
#   client/      — Canonical browser UI sources (ES modules) — not shipped on playout when dist-web/ exists
#   dist-web/    — Vite bundle from client/ — served on playout :4200
#   index.js     — Server entry
#
set -euo pipefail

archive_common_repo_root() {
	local script="${BASH_SOURCE[1]:-${BASH_SOURCE[0]}}"
	(cd "$(dirname "$script")/.." && pwd)
}

# Explicit members for server GitHub tarball (built UI, no client/ sources).
archive_common_server_tar_members() {
	local -n _out=$1
	_out=(
		index.js
		package.json
		package-lock.json
		src
		config
		template
		scripts
		tools/runtime
	)
	if [[ "${RELEASE_SERVER_ONLY:-0}" != "1" ]]; then
		_out+=(dist-web)
	fi
}

# Runtime / workstation bulk excluded from release and deploy archives.
archive_common_bulk_tar_excludes() {
	local -n _ex=$1
	_ex+=(
		--exclude="./media"
		--exclude="./_media"
		--exclude="./data"
		--exclude="./refs"
		--exclude="./bin"
		--exclude="./lib"
		--exclude="./cef-cache"
		--exclude="./log"
		--exclude="./core"
		--exclude="./dist"
		--exclude="./CasparCG_Enhanced-main"
		--exclude="./examples"
		--exclude="./samples"
		--exclude="./scratch"
		--exclude="./.reference"
		--exclude="./.cursor"
		--exclude="./.cursor-server"
		--exclude="./*.log"
		--exclude="./server.log"
		--exclude="./health.json"
		--exclude="./libndi.so.6"
		--exclude="./casparcg.config"
		--exclude="./highascg.config.json"
		--exclude="./highascg.config.json.bak"
		--exclude="./autosave.json"
		--exclude="./*.pyc"
		--exclude="./__pycache__"
	)
}

# Deploy tarball excludes (dev-push, deploy-tar-to-tmp).
archive_common_deploy_tar_excludes() {
	local -n _ex=$1
	_ex+=(
		--exclude=node_modules
		--exclude=.git
		--exclude=work
		--exclude=.env
		--exclude=.env.local
		--exclude='*.log'
		--exclude=highascg.config.json
		--exclude=.highascg-state.json
		--exclude=.module-state.json
		--exclude=.highascg-previs
		--exclude='config/*.json'
	)
	archive_common_bulk_tar_excludes "$1"
}

# Server tarball: never ship client/ sources; dist-web/ included unless RELEASE_SERVER_ONLY=1.
archive_common_server_tar_excludes() {
	local -n _ex=$1
	_ex+=(
		--exclude=./client
		--exclude=./dist/launcher
		--exclude=./audio_testing
		--exclude=./for_client
		--exclude=./From_client
	)
	if [[ "${RELEASE_SERVER_ONLY:-0}" == "1" ]]; then
		_ex+=(--exclude=./dist-web)
	fi
}

# Omit client/ dev tree when shipping a built dist-web/.
archive_common_exclude_client_sources() {
	local -n _ex=$1
	_ex+=(--exclude=./client)
}

# Run Vite when DEPLOY_BUILD_CLIENT=1 or RELEASE_BUILD_CLIENT=1 (default 0).
archive_common_build_client_if_requested() {
	local root="$1"
	if [[ "${DEPLOY_BUILD_CLIENT:-0}" != "1" && "${RELEASE_BUILD_CLIENT:-0}" != "1" ]]; then
		return 0
	fi
	if [[ ! -f "${root}/package.json" ]]; then
		echo "archive-common: no package.json under $root" >&2
		return 1
	fi
	echo "==> Vite production build (client/ → dist-web/)"
	(cd "$root" && npm run build:client)
}

# Deploy default: server + dist-web/. Set DEPLOY_SERVER_ONLY=1 for API-only emergency deploy.
archive_common_apply_deploy_packaging_rules() {
	local root="$1"
	local -n _ex=$2
	if [[ "${DEPLOY_SERVER_ONLY:-0}" == "1" ]]; then
		RELEASE_SERVER_ONLY=1 archive_common_server_tar_excludes "$2"
		return 0
	fi
	archive_common_apply_client_packaging_rules "$root" "$2"
}

# After build: exclude client/ unless ARCHIVE_INCLUDE_CLIENT_SOURCES=1.
archive_common_apply_client_packaging_rules() {
	local root="$1"
	local -n _ex=$2
	if [[ "${ARCHIVE_INCLUDE_CLIENT_SOURCES:-0}" == "1" ]]; then
		return 0
	fi
	if [[ -f "${root}/dist-web/index.html" ]]; then
		archive_common_exclude_client_sources "$2"
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
		echo "    UI omitted (RELEASE_SERVER_ONLY=1) — run npm run build:client on playout or redeploy with dist-web/."
	else
		echo "      • dist-web/ (operator UI built from in-repo client/)"
	fi
	if [[ -n "$archive_path" && -f "$archive_path" ]]; then
		echo "    This archive: $(du -h "$archive_path" | cut -f1)  $archive_path"
	fi
}
