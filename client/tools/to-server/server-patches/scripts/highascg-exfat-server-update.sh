#!/usr/bin/env bash
# Apply a server drop from exFAT (WO-52): primary drop-update/, legacy update/server/.
#
# Operators unpack highascg-server_*.tar.gz into drop-update/ on the stick.
# On boot (before highascg.service):
#   1. stop highascg.service
#   2. rsync drop → ~/highascg/ (includes dist-web/)
#   3. optional npm ci when package-lock.json was in the drop
#   4. archive the drop to drop-update/applied/<UTC>/
#   5. start highascg.service
#
# Disable: /etc/highascg/disable-exfat-server-update
# Dry run: HIGHASCG_SERVER_UPDATE_DRY_RUN=1
# npm ci after lockfile change: HIGHASCG_SERVER_UPDATE_NPM_CI=1 (default when package-lock present)
#
set -euo pipefail

USER_NAME="${HIGHASCG_SERVICE_USER:-casparcg}"
DISABLE="/etc/highascg/disable-exfat-server-update"
EXFAT_ROOT="/home/casparcg/exfat"
DROP_PRIMARY="${EXFAT_ROOT}/drop-update"
DROP_LEGACY="${EXFAT_ROOT}/update/server"
DST="/home/casparcg/highascg"
EXCLUDES="/etc/highascg/server-update-rsync-excludes.txt"
LOCK=/run/highascg/server-update.lock
SERVICE=highascg.service

log() {
	echo "[highascg-exfat-server-update] $*" >&2
}

resolve_drop_src() {
	if [[ -f "${DROP_PRIMARY}/package.json" ]]; then
		echo "$DROP_PRIMARY"
		return 0
	fi
	if [[ -f "${DROP_LEGACY}/package.json" ]]; then
		log "using legacy path ${DROP_LEGACY} (prefer drop-update/ on new sticks)"
		echo "$DROP_LEGACY"
		return 0
	fi
	echo ""
}

stop_service() {
	if systemctl is-active --quiet "$SERVICE" 2>/dev/null; then
		log "stopping $SERVICE"
		systemctl stop "$SERVICE"
	else
		log "$SERVICE not active (skip stop)"
	fi
}

start_service() {
	if [[ -f "${DST}/package.json" ]]; then
		log "starting $SERVICE"
		systemctl start "$SERVICE" 2>/dev/null || true
	else
		log "no ${DST}/package.json — not starting $SERVICE"
	fi
}

write_drop_readme() {
	local src_dir="$1"
	local grp="$2"
	mkdir -p "$src_dir"
	cat >"${src_dir}/README.txt" <<'EOF'
Drop server updates here (contents of highascg-server_*.tar.gz from GitHub releases).

Required: package.json at the top of this folder (along with index.js, src/, dist-web/, …).

On next boot the live system will:
  - stop highascg.service
  - copy files into /home/casparcg/highascg (includes dist-web/ operator UI)
  - run npm ci when package-lock.json is included
  - move this folder to drop-update/applied/<timestamp>/
  - start highascg.service

Operator UI: http://<playout-host>:4200/ (no Electron required on LAN).
EOF
	chown "${USER_NAME}:${grp}" "${src_dir}/README.txt" 2>/dev/null || true
}

main() {
	[[ "$(id -u)" -eq 0 ]] || {
		log "must run as root"
		exit 1
	}

	if [[ -f "$DISABLE" ]]; then
		log "disabled ($DISABLE)."
		exit 0
	fi

	if ! mountpoint -q "$EXFAT_ROOT" 2>/dev/null; then
		log "exFAT not mounted at $EXFAT_ROOT."
		exit 0
	fi

	local SRC
	SRC="$(resolve_drop_src)"
	if [[ -z "$SRC" ]]; then
		log "no pending update (drop-update/package.json and update/server/package.json missing)."
		exit 0
	fi

	getent passwd "$USER_NAME" >/dev/null || {
		log "no such user $USER_NAME."
		exit 1
	}

	command -v rsync >/dev/null 2>&1 || {
		log "missing rsync."
		exit 1
	}

	local grp
	grp="$(id -gn "$USER_NAME")"

	(
		flock -n 200 || {
			log "lock busy — exiting."
			exit 0
		}

		if [[ "${HIGHASCG_SERVER_UPDATE_DRY_RUN:-}" == "1" ]]; then
			log "DRY RUN: would apply ${SRC}/ → ${DST}/"
			exit 0
		fi

		if [[ ! -f "${SRC}/dist-web/index.html" ]]; then
			log "warning: drop has no dist-web/index.html — UI will not update (API-only drop?)"
		fi

		stop_service

		local xtra=()
		[[ -f "$EXCLUDES" ]] && xtra+=(--exclude-from="$EXCLUDES")
		log "rsync ${SRC}/ → ${DST}/"
		rsync "${xtra[@]}" -rlptgoD --delete "${SRC%/}/" "${DST%/}/"
		chown -R "${USER_NAME}:${grp}" "${DST%/}" || true

		if [[ "${HIGHASCG_SERVER_UPDATE_NPM_CI:-1}" == "1" ]] && [[ -f "${DST}/package-lock.json" ]]; then
			if command -v npm >/dev/null 2>&1; then
				log "npm ci (package-lock from update)"
				sudo -u "$USER_NAME" env HOME="$(getent passwd "$USER_NAME" | cut -d: -f6)" \
					npm ci --omit=dev --prefix "$DST" 2>&1 | while read -r line; do log "npm: $line"; done || {
					log "npm ci failed (continuing)"
				}
			else
				log "npm not installed — skip npm ci"
			fi
		fi

		local stamp applied applied_root
		stamp="$(date -u +%Y%m%dT%H%M%SZ)"
		if [[ "$SRC" == "$DROP_PRIMARY" ]]; then
			applied_root="${DROP_PRIMARY}/applied"
		else
			applied_root="${EXFAT_ROOT}/update/applied"
		fi
		applied="${applied_root}/${stamp}"
		mkdir -p "$applied_root"
		log "archiving drop → ${applied}"
		mv "$SRC" "$applied"
		if [[ "$SRC" == "$DROP_PRIMARY" ]]; then
			mkdir -p "$DROP_PRIMARY"
			write_drop_readme "$DROP_PRIMARY" "$grp"
		else
			mkdir -p "$DROP_LEGACY"
			write_drop_readme "$DROP_LEGACY" "$grp"
		fi

		start_service
		log "server update applied from ${SRC}."
	) 200>"$LOCK"

	exit 0
}

main "$@"
