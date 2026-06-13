#!/usr/bin/env bash
# Shared paths and tar/rsync excludes for src/ (root) + client/ + dist-web/ layout.
# Source from deploy and release scripts (do not execute directly).
#
# Layout:
#   src/         — Node server (repo root)
#   client/      — Browser UI sources (ES modules)
#   dist-web/    — Vite bundle (Electron launcher / release:github-client — not on playout server)
#   index.js     — Server entry
#
set -euo pipefail

archive_common_repo_root() {
	local script="${BASH_SOURCE[1]:-${BASH_SOURCE[0]}}"
	(cd "$(dirname "$script")/.." && pwd)
}

# Explicit members for server-only GitHub tarball (no client/ sources).
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
	archive_common_bulk_tar_excludes _ex
}

# Server-only tarball: never ship browser UI (WO-47 / PLAN_SERVER_CLIENT_SPLIT).
archive_common_server_tar_excludes() {
	local -n _ex=$1
	_ex+=(
		--exclude=./client
		--exclude=./dist-web
		--exclude=./dist/launcher
		--exclude=./audio_testing
		--exclude=./for_client
		--exclude=./From_client
	)
}

# Omit client/ dev tree when shipping a built dist-web/ (monolith / legacy).
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
	echo "==> build:client skipped (client is a separate repo)"
}

# Deploy default: API-only tree (matches playout ISO / headless service).
archive_common_apply_deploy_packaging_rules() {
	local root="$1"
	local -n _ex=$2
	if [[ "${DEPLOY_SERVER_ONLY:-1}" == "1" ]]; then
		archive_common_server_tar_excludes _ex
		return 0
	fi
	archive_common_apply_client_packaging_rules "$root" _ex
}

# After build: exclude client/ unless ARCHIVE_INCLUDE_CLIENT_SOURCES=1.
archive_common_apply_client_packaging_rules() {
	local root="$1"
	local -n _ex=$2
	if [[ "${ARCHIVE_INCLUDE_CLIENT_SOURCES:-0}" == "1" ]]; then
		return 0
	fi
	if [[ -f "${root}/dist-web/index.html" ]]; then
		archive_common_exclude_client_sources _ex
	fi
}

# Print size hints for server tarball (why it is large).
archive_common_print_size_hints() {
	local archive_path="${1:-}"
	echo "    Server tarball size is usually dominated by:"
	echo "      • node_modules/ (runtime deps; use --zip-exclude-node-modules + npm ci on target)"
	echo "      • tools/runtime/ (exfat-sync-cli, staged Caspar helpers)"
	echo "      • src/ (orchestrator + APIs at repo root)"
	echo "    UI is a separate asset: npm run release:github-client → dist-web/"
	if [[ -n "$archive_path" && -f "$archive_path" ]]; then
		echo "    This archive: $(du -h "$archive_path" | cut -f1)  $archive_path"
	fi
}
