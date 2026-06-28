#!/usr/bin/env bash
# Push HighAsCG to the backup playout box (no GitHub on target).
#
# Modes:
#   DEPLOY_MODE=code    (default) App sources + dist-web + node_modules overlay.
#                       Does NOT touch bin/, lib/, media/, or machine config on target.
#   DEPLOY_MODE=mirror  Full tree rsync including media/, bin/, lib/, projects/, template/.
#                       Use to clone leader playout for hot-backup testing without Syncthing.
#
# Usage:
#   bash scripts/deploy/push-backup-box.sh
#   DEPLOY_MODE=mirror bash scripts/deploy/push-backup-box.sh
#
# Optional env:
#   DEPLOY_HOST=192.168.0.25
#   DEPLOY_USER=casparcg
#   DEPLOY_PATH=/home/casparcg/highascg
#   DEPLOY_SKIP_BUILD=1
#   DEPLOY_DRY_RUN=1          (code: tarball only; mirror: print rsync command)
#   DEPLOY_MIRROR_DELETE=1    (mirror: rsync --delete, default 1)
#   DEPLOY_SSH_PASSWORD=...   (requires sshpass)
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck source=../lib/archive-common.sh
source "${ROOT}/scripts/lib/archive-common.sh"
cd "$ROOT"

DEPLOY_MODE="${DEPLOY_MODE:-code}"
DEPLOY_HOST="${DEPLOY_HOST:-192.168.0.25}"
DEPLOY_USER="${DEPLOY_USER:-casparcg}"
DEPLOY_PATH="${DEPLOY_PATH:-/home/casparcg/highascg}"
DEPLOY_REMOTE_TMP="${DEPLOY_REMOTE_TMP:-/tmp/highascg-backup-box.tgz}"
DEPLOY_SSH_PASSWORD="${DEPLOY_SSH_PASSWORD:-}"
REMOTE="${DEPLOY_USER}@${DEPLOY_HOST}"

SSH_OPTS=(
	-o BatchMode=no
	-o ServerAliveInterval=30
	-o ServerAliveCountMax=6
	-o StrictHostKeyChecking=accept-new
)

SSH_BASE=(ssh)
SCP_BASE=(scp)
RSYNC_SSH="ssh ${SSH_OPTS[*]}"
if [[ -n "$DEPLOY_SSH_PASSWORD" ]]; then
	command -v sshpass >/dev/null 2>&1 || {
		echo "ERROR: DEPLOY_SSH_PASSWORD set but sshpass not installed." >&2
		exit 1
	}
	SSH_BASE=(sshpass -p "$DEPLOY_SSH_PASSWORD" ssh)
	SCP_BASE=(sshpass -p "$DEPLOY_SSH_PASSWORD" scp)
	RSYNC_SSH="sshpass -p ${DEPLOY_SSH_PASSWORD} ssh ${SSH_OPTS[*]}"
fi

export COPYFILE_DISABLE=1

if [[ "${DEPLOY_SKIP_BUILD:-0}" != "1" ]]; then
	DEPLOY_BUILD_CLIENT=1 archive_common_build_client_if_requested "$ROOT"
fi

PATH_Q=$(printf '%q' "$DEPLOY_PATH")
DROPIN_DIR_Q=$(printf '%q' "/etc/systemd/system/highascg.service.d")
DROPIN_Q=$(printf '%q' "/etc/systemd/system/highascg.service.d/30-replication.conf")

push_replication_json() {
	echo "→ scp replication.json (hot-backup defaults)"
	"${SCP_BASE[@]}" "${SSH_OPTS[@]}" "${ROOT}/config/replication.json" "${REMOTE}:${DEPLOY_PATH}/config/replication.json"
}

try_systemd_dropin() {
	echo "→ systemd Syncthing HOME drop-in (optional)"
	if "${SSH_BASE[@]}" "${SSH_OPTS[@]}" "$REMOTE" "sudo -n true" 2>/dev/null; then
		"${SSH_BASE[@]}" "${SSH_OPTS[@]}" "$REMOTE" "sudo mkdir -p ${DROPIN_DIR_Q} && sudo tee ${DROPIN_Q} >/dev/null" \
			<"${ROOT}/scripts/setup/highascg.service.d-replication.conf.example"
		"${SSH_BASE[@]}" "${SSH_OPTS[@]}" "$REMOTE" "sudo systemctl daemon-reload && sudo systemctl restart highascg || true"
	else
		echo "   (skip — on backup box if Syncthing API 403 under systemd:)"
		echo "   sudo cp ${DEPLOY_PATH}/scripts/setup/highascg.service.d-replication.conf.example \\"
		echo "     /etc/systemd/system/highascg.service.d/30-replication.conf"
		echo "   sudo systemctl daemon-reload && sudo systemctl restart highascg"
	fi
}

finish_message() {
	echo ""
	echo "Done (${DEPLOY_MODE}). Backup box: ${REMOTE}:${DEPLOY_PATH}"
	echo "Verify: curl -s http://${DEPLOY_HOST}:4200/api/replication/ping | python3 -m json.tool"
	echo "Leader: Become leader · Backup: Follower → Scan → Connect"
	echo "Note: code push never removes bin/, lib/, or media/ on the target."
}

mirror_push() {
	local -a rsync_args=(
		-avh
		--info=progress2
		--human-readable
	)
	if [[ "${DEPLOY_MIRROR_DELETE:-1}" == "1" ]]; then
		rsync_args+=(--delete)
	fi

	local -a excludes=(
		--exclude='.git/'
		--exclude='cef-cache/'
		--exclude='log/'
		--exclude='media/.replication-active/'
		--exclude='.cursor/'
		--exclude='.cursor-server/'
		--exclude='.DS_Store'
		--exclude='*.log'
		--exclude='.env'
		--exclude='.env.*'
		--exclude='.highascg-state.json'
		--exclude='.highascg-state.json.tmp'
		--exclude='.module-state.json'
		--exclude='.module-state.json.tmp'
		--exclude='config/replication.json'
		--exclude='config/device_graph.json'
		--exclude='config/screen_destinations.json'
	)
	if [[ -n "${DEPLOY_RSYNC_EXCLUDE:-}" ]]; then
		IFS=',' read -ra _extra <<<"$DEPLOY_RSYNC_EXCLUDE"
		for x in "${_extra[@]}"; do
			x="${x#"${x%%[![:space:]]*}"}"
			x="${x%"${x##*[![:space:]]}"}"
			[[ -n "$x" ]] && excludes+=(--exclude="$x")
		done
	fi

	echo "→ rsync mirror (media, bin, lib, projects, template, config…) → ${REMOTE}:${DEPLOY_PATH}/"
	echo "   Skips media/.replication-active/ (Syncthing staging — not for manual clone)."
	echo "   This can take a while for large media/. replication.json applied after rsync."

	if [[ "${DEPLOY_DRY_RUN:-0}" == "1" ]]; then
		echo "DRY RUN: rsync ${rsync_args[*]} ${excludes[*]} ${ROOT}/ ${REMOTE}:${DEPLOY_PATH}/"
		exit 0
	fi

	"${SSH_BASE[@]}" "${SSH_OPTS[@]}" "$REMOTE" "mkdir -p ${PATH_Q}"

	rsync "${rsync_args[@]}" \
		-e "$RSYNC_SSH" \
		"${excludes[@]}" \
		"${ROOT}/" "${REMOTE}:${DEPLOY_PATH}/"

	"${SSH_BASE[@]}" "${SSH_OPTS[@]}" "$REMOTE" "test -f ${PATH_Q}/index.js && test -d ${PATH_Q}/bin"
	push_replication_json
	try_systemd_dropin
	finish_message
}

code_push() {
	local TMP
	TMP="$(mktemp /tmp/highascg-backup-box.XXXXXX.tgz)"
	trap 'rm -f "$TMP"' EXIT

	local -a excludes=()
	archive_common_bulk_tar_excludes excludes
	excludes+=(
		--exclude=.git
		--exclude=node_modules/.cache
		--exclude=work/deprecated
		--exclude=.env
		--exclude=.env.*
		--exclude=highascg.config.json
		--exclude=.highascg-state.json
		--exclude=.module-state.json
		--exclude=.highascg-previs
		--exclude='config/*.json'
		--exclude='config/casparcg.config'
		--exclude='config/casparcg.config.*'
		--exclude='config/.highascg-state.json'
	)

	echo "→ tar (overlay code + node_modules; skips media/bin/lib on source and target) → $TMP"
	tar czf "$TMP" "${excludes[@]}" .
	echo "   archive: $(du -h "$TMP" | cut -f1)"

	if [[ "${DEPLOY_DRY_RUN:-0}" == "1" ]]; then
		echo "DRY RUN: tarball at $TMP (not removed on exit)"
		trap - EXIT
		echo "Upload: scp $TMP ${REMOTE}:${DEPLOY_REMOTE_TMP}"
		exit 0
	fi

	TGZ_Q=$(printf '%q' "$DEPLOY_REMOTE_TMP")
	echo "→ scp → ${REMOTE}:${DEPLOY_REMOTE_TMP}"
	"${SCP_BASE[@]}" "${SSH_OPTS[@]}" "$TMP" "${REMOTE}:${DEPLOY_REMOTE_TMP}"

	# Overlay extract only — never delete bin/, lib/, media/, etc. on the target.
	REMOTE_INNER=$(cat <<EOF
set -euo pipefail
mkdir -p ${PATH_Q}
env -u TAR_OPTIONS tar -m -xzf ${TGZ_Q} -C ${PATH_Q}
rm -f ${TGZ_Q}
chown -R ${DEPLOY_USER}:${DEPLOY_USER} ${PATH_Q}
test -f ${PATH_Q}/index.js
EOF
)

	echo "→ ssh overlay extract → ${DEPLOY_PATH} (bin/lib/media preserved)"
	"${SSH_BASE[@]}" "${SSH_OPTS[@]}" "$REMOTE" "$REMOTE_INNER"

	push_replication_json
	try_systemd_dropin
	finish_message

	trap - EXIT
	rm -f "$TMP"
}

case "$DEPLOY_MODE" in
	code) code_push ;;
	mirror) mirror_push ;;
	*)
		echo "ERROR: DEPLOY_MODE must be 'code' or 'mirror' (got: $DEPLOY_MODE)" >&2
		exit 1
		;;
esac
