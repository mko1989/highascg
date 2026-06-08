#!/usr/bin/env bash
# Apply a server-only drop from exFAT: /home/casparcg/exfat/drop-update/
#
# Operators unpack highascg-server_*.tar.gz (or copy src/, index.js, tools/, …) into
# drop-update/ on the stick. On boot (before highascg.service):
#   1. stop highascg.service
#   2. rsync update/server/ → ~/highascg/
#   3. optional npm ci when package-lock.json was in the drop
#   4. archive the drop to update/applied/<UTC>/
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
DROP_UPDATE="${EXFAT_ROOT}/drop-update"
LEGACY_UPDATE="${EXFAT_ROOT}/update/server"
DST="/home/casparcg/highascg"
EXCLUDES="/etc/highascg/server-update-rsync-excludes.txt"
LOCK=/run/highascg/server-update.lock
SERVICE=highascg.service

log() {
	echo "[highascg-exfat-server-update] $*" >&2
}

# Prefer drop-update/; accept legacy update/server/ on old sticks.
resolve_drop_src() {
	if [[ -f "${DROP_UPDATE}/package.json" ]]; then
		echo "$DROP_UPDATE"
		return 0
	fi
	if [[ -f "${LEGACY_UPDATE}/package.json" ]]; then
		log "using legacy ${LEGACY_UPDATE}/ — move future drops to ${DROP_UPDATE}/"
		echo "$LEGACY_UPDATE"
		return 0
	fi
	return 1
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

	if ! SRC="$(resolve_drop_src)"; then
		log "no pending update (${DROP_UPDATE}/package.json missing)."
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

		local stamp applied
		stamp="$(date -u +%Y%m%dT%H%M%SZ)"
		applied="${DROP_UPDATE}/applied/${stamp}"
		mkdir -p "${DROP_UPDATE}/applied"
		log "archiving drop → ${applied}"
		mv "$SRC" "$applied"
		mkdir -p "$DROP_UPDATE"
		cat >"${DROP_UPDATE}/README.txt" <<'EOF'
Drop server updates here (contents of highascg-server_*.tar.gz from GitHub releases).

Required: package.json at the top of this folder (along with index.js, src/, tools/runtime/, …).

On next boot the live system will:
  - stop highascg.service
  - copy files into /home/casparcg/highascg (client/ and dist-web/ are not touched)
  - run npm ci when package-lock.json is included
  - move this folder to drop-update/applied/<timestamp>/
  - start highascg.service

UI/simulation runs from the Electron launcher on Mac/Windows — not from this stick.
EOF
		chown "${USER_NAME}:${grp}" "${DROP_UPDATE}/README.txt" 2>/dev/null || true

		start_service
		log "server update applied."
	) 200>"$LOCK"

	exit 0
}

main "$@"
