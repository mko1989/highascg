#!/usr/bin/env bash
# Apply a HighAsCG server drop (WO-66): rsync source → dest, optional npm ci, retain or consume drop.
#
# Usage:
#   highascg-apply-server-drop.sh --source <dir> --dest <dir> [options]
#
# Options:
#   --drop-update-root <dir>   exFAT drop-update/ parent (for applied/ + .applied-stamp); default: parent of --source when under drop-update/
#   --retain-drop              Leave source in place (live USB stick — required every cold boot)
#   --consume-drop             Move source to drop-update/applied/<UTC>/ after success
#   --auto-retain              Detect retain vs consume (default when neither flag set)
#   --user <name>              Service user (default: casparcg)
#   --excludes <file>          rsync --exclude-from (default: /etc/highascg/server-update-rsync-excludes.txt)
#   --legacy-src               Source is legacy update/server/ — always consume after apply
#   --dry-run
#   --archive-copy             In retain mode, cp -a snapshot to applied/<UTC>/ (audit only)
#   --print-retain-mode        Print retain|consume and exit (for tests / diagnostics)
#
# Env: HIGHASCG_SERVER_UPDATE_DRY_RUN=1, HIGHASCG_SERVER_UPDATE_NPM_CI=1, HIGHASCG_SERVER_UPDATE_RETAIN_DROP=0|1
#
set -euo pipefail

LOG_TAG="${HIGHASCG_APPLY_LOG_TAG:-highascg-apply-server-drop}"

log() {
	echo "[${LOG_TAG}] $*" >&2
}

MARKER_RETAIN=/etc/highascg/server-update-retain-drop
MARKER_CONSUME=/etc/highascg/server-update-consume-drop

drop_on_operator_stick_exfat() {
	local path="${1:-}"
	[[ -n "$path" ]] || return 1
	local mp label
	mp="$(findmnt -T "$path" -no TARGET 2>/dev/null || true)"
	[[ -n "$mp" ]] || return 1
	label="$(findmnt -no LABEL "$mp" 2>/dev/null || true)"
	[[ "$label" == "HIGHASCGEXF" ]]
}

should_retain_drop() {
	local drop_root="${1:-}"
	if drop_on_operator_stick_exfat "$drop_root"; then
		return 0
	fi
	if [[ "${HIGHASCG_SERVER_UPDATE_RETAIN_DROP:-}" == "1" ]]; then
		return 0
	fi
	if [[ "${HIGHASCG_SERVER_UPDATE_RETAIN_DROP:-}" == "0" ]]; then
		return 1
	fi
	if [[ -f "$MARKER_CONSUME" ]]; then
		return 1
	fi
	if [[ -f "$MARKER_RETAIN" ]]; then
		return 0
	fi
	if [[ -d /run/live ]]; then
		return 0
	fi
	local fstype
	fstype="$(findmnt -no FSTYPE / 2>/dev/null || true)"
	case "$fstype" in
		overlay | aufs | overlayfs) return 0 ;;
	esac
	return 1
}

read_build_stamp() {
	local root="$1"
	if [[ -f "${root}/BUILD_STAMP" ]]; then
		tr -d '[:space:]' <"${root}/BUILD_STAMP"
		return 0
	fi
	if [[ -f "${root}/package.json" ]] && command -v node >/dev/null 2>&1; then
		node -e "try{const p=require(process.argv[1]);process.stdout.write(String(p.version||''))}catch(e){}" "${root}/package.json" 2>/dev/null || true
		return 0
	fi
	return 1
}

validate_drop() {
	local src="$1"
	local ok=1
	local f
	for f in package.json index.js; do
		if [[ ! -f "${src}/${f}" ]]; then
			log "validation failed: missing ${f}"
			ok=0
		fi
	done
	if [[ ! -d "${src}/src" ]]; then
		log "validation failed: missing src/"
		ok=0
	fi
	if [[ ! -f "${src}/dist-web/index.html" ]]; then
		log "validation failed: missing dist-web/index.html (WO-52 unified playout UI)"
		ok=0
	fi
	if [[ ! -d "${src}/tools/runtime" ]]; then
		log "validation failed: missing tools/runtime/"
		ok=0
	fi
	[[ "$ok" -eq 1 ]]
}

write_drop_readme() {
	local drop_root="$1"
	local retain="$2"
	mkdir -p "$drop_root"
	if [[ "$retain" -eq 1 ]]; then
		cat >"${drop_root}/README.txt" <<'EOF'
Drop server updates here (contents of highascg-server_*.tar.gz from GitHub releases).

Required: package.json, index.js, src/, dist-web/, tools/runtime/ at the top of this folder.

Live USB stick (retain mode):
  - On every boot, files are rsync'd into /home/casparcg/highascg/
  - LEAVE the drop here — do not move to applied/ manually
  - The stick is the durable copy; RAM/overlay does not keep ~/highascg across reboots
  - Optional history copies may appear under drop-update/applied/ (audit only)

Persistent install (consume mode):
  - After a successful apply the drop may move to drop-update/applied/<UTC>/
  - ~/highascg/ survives reboot on internal disk

Operator UI: http://<playout-ip>:4200/
EOF
	else
		cat >"${drop_root}/README.txt" <<'EOF'
Drop server updates here (contents of highascg-server_*.tar.gz from GitHub releases).

Required: package.json at the top of this folder (along with index.js, src/, dist-web/, tools/runtime/, …).

On next boot the system will:
  - stop highascg.service
  - rsync this folder → /home/casparcg/highascg/
  - run npm ci when package-lock.json is included
  - move this folder to drop-update/applied/<timestamp>/ (persistent installs)
  - start highascg.service

Live USB sticks keep the drop here instead — see docs/EXFAT_SERVER_UPDATE.md.
EOF
	fi
}

stamp_unchanged_skip() {
	local src="$1" dest="$2"
	local src_stamp dest_stamp
	src_stamp="$(read_build_stamp "$src" 2>/dev/null || true)"
	dest_stamp="$(read_build_stamp "$dest" 2>/dev/null || true)"
	[[ -n "$src_stamp" && -n "$dest_stamp" && "$src_stamp" == "$dest_stamp" && -f "${dest}/dist-web/index.html" && -x "${dest}/bin/casparcg" ]]
}

apply_server_drop() {
	local src="$1" dest="$2" drop_root="$3" retain="$4" legacy="$5" user_name="$6" excludes="$7" dry_run="$8" archive_copy="$9"

	local grp
	grp="$(id -gn "$user_name")"

	if ! validate_drop "$src"; then
		log "refusing to apply invalid drop at ${src}/"
		return 1
	fi

	local src_stamp
	src_stamp="$(read_build_stamp "$src" 2>/dev/null || date -u +%Y%m%dT%H%M%SZ)"

	if [[ "$retain" -eq 1 ]] && stamp_unchanged_skip "$src" "$dest"; then
		log "stamp unchanged (${src_stamp}) — skip rsync (retain mode)"
		if [[ "$dry_run" -eq 0 ]]; then
			echo "${src_stamp}" >"${drop_root}/.applied-stamp"
			date -u +%Y-%m-%dT%H:%M:%SZ >"${drop_root}/.applied-at" 2>/dev/null || true
			chown "${user_name}:${grp}" "${drop_root}/.applied-stamp" "${drop_root}/.applied-at" 2>/dev/null || true
		fi
		return 0
	fi

	if [[ "$dry_run" -eq 1 ]]; then
		log "DRY RUN: would rsync ${src}/ → ${dest}/ (retain=${retain})"
		return 0
	fi

	local staging_parent="${HIGHASCG_UPDATE_STAGING:-/var/cache/highascg/update-staging}"
	mkdir -p "$staging_parent"
	local staging="${staging_parent}/${src_stamp}"
	rm -rf "$staging"
	local xtra=()
	[[ -f "$excludes" ]] && xtra+=(--exclude-from="$excludes")
	log "rsync ${src}/ → ${staging}/"
	rsync "${xtra[@]}" -rlptgoD --delete "${src%/}/" "${staging%/}/"
	log "merge ${staging}/ → ${dest}/ (no --delete — preserves bin/, lib/, …)"
	mkdir -p "$dest"
	rsync "${xtra[@]}" -rlptgoD "${staging%/}/" "${dest%/}/"
	rm -rf "$staging"
	chown -R "${user_name}:${grp}" "${dest%/}" || true

	if [[ ! -x "${dest}/bin/casparcg" ]]; then
		log "WARN: ${dest}/bin/casparcg missing — restore from ISO/install (not in server drops)"
	fi

	echo "${src_stamp}" >"${dest}/BUILD_STAMP"
	echo "${src_stamp}" >"${dest}/.highascg-build-stamp"
	chown "${user_name}:${grp}" "${dest}/BUILD_STAMP" "${dest}/.highascg-build-stamp" 2>/dev/null || true

	if [[ "${HIGHASCG_SERVER_UPDATE_NPM_CI:-1}" == "1" ]] && [[ -f "${dest}/package-lock.json" ]]; then
		if command -v npm >/dev/null 2>&1; then
			log "npm ci (package-lock from update)"
			sudo -u "$user_name" env HOME="$(getent passwd "$user_name" | cut -d: -f6)" \
				npm ci --omit=dev --prefix "$dest" 2>&1 | while read -r line; do log "npm: $line"; done || {
				log "npm ci failed (continuing)"
			}
		else
			log "npm not installed — skip npm ci"
		fi
	fi

	local utc_stamp
	utc_stamp="$(date -u +%Y%m%dT%H%M%SZ)"

	if [[ "$legacy" -eq 1 ]]; then
		retain=0
	fi

	if [[ "$retain" -eq 1 ]]; then
		echo "${src_stamp}" >"${drop_root}/.applied-stamp"
		date -u +%Y-%m-%dT%H:%M:%SZ >"${drop_root}/.applied-at" 2>/dev/null || true
		chown "${user_name}:${grp}" "${drop_root}/.applied-stamp" "${drop_root}/.applied-at" 2>/dev/null || true
		if [[ "$archive_copy" -eq 1 ]]; then
			mkdir -p "${drop_root}/applied"
			local audit="${drop_root}/applied/${utc_stamp}"
			log "audit copy → ${audit}"
			cp -a "$src" "$audit"
			chown -R "${user_name}:${grp}" "$audit" 2>/dev/null || true
		fi
		write_drop_readme "$drop_root" 1
		chown "${user_name}:${grp}" "${drop_root}/README.txt" 2>/dev/null || true
		log "retain mode: drop left at ${src}/ (stamp ${src_stamp})"
	else
		mkdir -p "${drop_root}/applied"
		local applied="${drop_root}/applied/${utc_stamp}"
		log "consume mode: archiving drop → ${applied}"
		mkdir -p "$applied"
		if [[ "${src%/}" == "${drop_root%/}" ]]; then
			local item base
			shopt -s dotglob nullglob
			for item in "${src}"/*; do
				base="$(basename "$item")"
				[[ "$base" == "applied" ]] && continue
				mv "$item" "${applied}/"
			done
			shopt -u dotglob nullglob
		else
			mv "$src" "$applied"
		fi
		mkdir -p "${drop_root}"
		write_drop_readme "$drop_root" 0
		chown -R "${user_name}:${grp}" "${drop_root}" "${applied}" 2>/dev/null || true
	fi

	return 0
}

main() {
	local src="" dest="" drop_root="" mode="auto" user_name="${HIGHASCG_SERVICE_USER:-casparcg}"
	local excludes="/etc/highascg/server-update-rsync-excludes.txt"
	local legacy=0 dry_run=0 archive_copy=0

	if [[ "${1:-}" == "--print-retain-mode" ]]; then
		if should_retain_drop; then
			echo retain
		else
			echo consume
		fi
		exit 0
	fi

	while [[ $# -gt 0 ]]; do
		case "$1" in
		--source)
			src="${2:?}"
			shift 2
			;;
		--dest)
			dest="${2:?}"
			shift 2
			;;
		--drop-update-root)
			drop_root="${2:?}"
			shift 2
			;;
		--retain-drop) mode=retain; shift ;;
		--consume-drop) mode=consume; shift ;;
		--auto-retain) mode=auto; shift ;;
		--user)
			user_name="${2:?}"
			shift 2
			;;
		--excludes)
			excludes="${2:?}"
			shift 2
			;;
		--legacy-src) legacy=1; shift ;;
		--dry-run) dry_run=1; shift ;;
		--archive-copy) archive_copy=1; shift ;;
		-h | --help)
			sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'
			exit 0
			;;
		*)
			log "unknown option: $1"
			exit 2
			;;
		esac
	done

	[[ -n "$src" && -n "$dest" ]] || {
		log "--source and --dest required"
		exit 2
	}
	[[ -d "$src" ]] || {
		log "source not a directory: $src"
		exit 1
	}

	if [[ -z "$drop_root" ]]; then
		if [[ "$(basename "$src")" == "drop-update" ]]; then
			drop_root="$src"
		elif [[ "$(basename "$src")" == "server" && "$(basename "$(dirname "$src")")" == "update" ]]; then
			drop_root="$(dirname "$(dirname "$src")")/drop-update"
		else
			drop_root="$(dirname "$src")"
		fi
	fi

	if [[ "${HIGHASCG_SERVER_UPDATE_DRY_RUN:-}" == "1" ]]; then
		dry_run=1
	fi

	local retain=0
	case "$mode" in
	retain) retain=1 ;;
	consume) retain=0 ;;
	auto)
		if should_retain_drop "$drop_root"; then
			retain=1
		else
			retain=0
		fi
		;;
	esac

	if [[ "$legacy" -eq 1 ]]; then
		retain=0
	fi

	log "apply ${src}/ → ${dest}/ (mode=$([[ $retain -eq 1 ]] && echo retain || echo consume))"

	apply_server_drop "$src" "$dest" "$drop_root" "$retain" "$legacy" "$user_name" "$excludes" "$dry_run" "$archive_copy"
}

main "$@"
