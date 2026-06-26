#!/usr/bin/env bash
# DANGER: Full server tree deploy — wipes most of DEPLOY_PATH before extract.
# Prefer: bash client-scripts/dev-push.sh  (dist-web/ only)
#
# Requires explicit opt-in:
#   DEPLOY_FULL_SERVER=1 bash client-scripts/dev-push-full-server.sh
#
set -euo pipefail

if [[ "${DEPLOY_FULL_SERVER:-}" != "1" ]]; then
	echo "ERROR: This script replaces the entire server tree on the remote host." >&2
	echo "For UI-only updates use: bash client-scripts/dev-push.sh" >&2
	echo "To run full server deploy anyway: DEPLOY_FULL_SERVER=1 $0" >&2
	exit 1
fi

echo "WARNING: full server deploy — remote tree will be wiped (except config/, node_modules/, state files)" >&2
read -r -p "Type YES to continue: " ack
[[ "$ack" == "YES" ]] || {
	echo "Aborted."
	exit 1
}

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=archive-common.sh
source "${ROOT}/scripts/archive-common.sh"
cd "$ROOT"

if [[ -f .env.deploy ]]; then
	set -a
	# shellcheck source=/dev/null
	source .env.deploy
	set +a
fi

DEPLOY_HOST="${DEPLOY_HOST:-192.168.0.2}"
DEPLOY_USER="${DEPLOY_USER:-casparcg}"
DEPLOY_PATH="${DEPLOY_PATH:-/home/casparcg/highascg}"
DEPLOY_REMOTE_TMP="${DEPLOY_REMOTE_TMP:-/tmp/highascg-deploy-${DEPLOY_USER}.tgz}"
DEPLOY_USE_SCP="${DEPLOY_USE_SCP:-0}"
DEPLOY_USE_SFTP="${DEPLOY_USE_SFTP:-0}"
DEPLOY_REMOTE_SUDO="${DEPLOY_REMOTE_SUDO:-0}"
DEPLOY_SSH_PASSWORD="${DEPLOY_SSH_PASSWORD:-}"
DEPLOY_SUDO_PASSWORD="${DEPLOY_SUDO_PASSWORD:-}"
REMOTE="${DEPLOY_USER}@${DEPLOY_HOST}"

TMP="$(mktemp /tmp/highascg-dev.XXXXXX.tgz)"
CTRL_SOCK="${DEPLOY_SSH_CONTROL:-${TMPDIR:-/tmp}/highascg-deploy-$$.sock}"
trap 'rm -f "$TMP" "$CTRL_SOCK" 2>/dev/null' EXIT

SSH_OPTS=(
	-o BatchMode=no
	-o ControlMaster=auto
	-o ControlPath="$CTRL_SOCK"
	-o ControlPersist=300
	-o ServerAliveInterval=30
	-o ServerAliveCountMax=6
	-o TCPKeepAlive=yes
	-o IPQoS=none
)

SSH_TTY=()
[[ "$DEPLOY_REMOTE_SUDO" == "1" ]] && SSH_TTY=(-t)

SSH_BASE=(ssh)
SCP_BASE=(scp)
SFTP_BASE=(sftp)
if [[ -n "$DEPLOY_SSH_PASSWORD" ]]; then
	command -v sshpass >/dev/null 2>&1 || exit 1
	SSH_BASE=(sshpass -p "$DEPLOY_SSH_PASSWORD" ssh)
	SCP_BASE=(sshpass -p "$DEPLOY_SSH_PASSWORD" scp)
	SFTP_BASE=(sshpass -p "$DEPLOY_SSH_PASSWORD" sftp)
fi

export COPYFILE_DISABLE=1

if [[ "${DEPLOY_BUILD_CLIENT:-0}" == "1" ]]; then
	archive_common_build_client_if_requested "$ROOT"
fi

local_excludes=()
archive_common_deploy_tar_excludes local_excludes
archive_common_apply_deploy_packaging_rules "$ROOT" local_excludes

echo "→ tar → $TMP (FULL server deploy)"
tar czf "$TMP" "${local_excludes[@]}" .

PATH_Q=$(printf '%q' "$DEPLOY_PATH")
TGZ_Q=$(printf '%q' "$DEPLOY_REMOTE_TMP")
INDEX_Q=$(printf '%q' "${DEPLOY_PATH}/index.js")

if [[ "${DEPLOY_SERVER_ONLY:-0}" == "1" ]]; then
	HEADLESS_ENV='ENV_F='"${PATH_Q}"'/.env; touch "$ENV_F"; if grep -q "^HIGHASCG_HEADLESS=" "$ENV_F" 2>/dev/null; then sed -i "s/^HIGHASCG_HEADLESS=.*/HIGHASCG_HEADLESS=true/" "$ENV_F"; else echo "HIGHASCG_HEADLESS=true" >> "$ENV_F"; fi'
else
	HEADLESS_ENV='ENV_F='"${PATH_Q}"'/.env; touch "$ENV_F"; sed -i "/^HIGHASCG_HEADLESS=/d" "$ENV_F"'
fi

REMOTE_INNER="set -euo pipefail; mkdir -p ${PATH_Q}; find ${PATH_Q} -mindepth 1 -maxdepth 1 ! -name 'highascg.config.json' ! -name '.highascg-state.json' ! -name '.module-state.json' ! -name '.highascg-previs' ! -name 'config' ! -name 'node_modules' ! -name '.env' -exec rm -rf {} +; env -u TAR_OPTIONS tar -m -xzf ${TGZ_Q} -C ${PATH_Q}; rm -f ${TGZ_Q}; ${HEADLESS_ENV}; chown -R ${DEPLOY_USER}:${DEPLOY_USER} ${PATH_Q}"

if [[ "$DEPLOY_REMOTE_SUDO" == "1" ]]; then
	if [[ -n "$DEPLOY_SUDO_PASSWORD" ]]; then
		SUDO_PW_SQ=${DEPLOY_SUDO_PASSWORD//\'/\'\"\'\"\'}
		REMOTE_EXTRACT_CMD="printf '%s\n' '${SUDO_PW_SQ}' | sudo -S -p '' bash -c $(printf '%q' "$REMOTE_INNER")"
		REMOTE_VERIFY_CMD="printf '%s\n' '${SUDO_PW_SQ}' | sudo -S -p '' test -f ${INDEX_Q}"
	else
		REMOTE_EXTRACT_CMD="sudo bash -c $(printf '%q' "$REMOTE_INNER")"
		REMOTE_VERIFY_CMD="sudo test -f ${INDEX_Q}"
	fi
else
	REMOTE_EXTRACT_CMD="$REMOTE_INNER"
	REMOTE_VERIFY_CMD="test -f ${INDEX_Q}"
fi

if [[ "$DEPLOY_USE_SFTP" == "1" ]]; then
	"${SFTP_BASE[@]}" "${SSH_OPTS[@]}" "$REMOTE" <<EOF
put ${TMP} ${DEPLOY_REMOTE_TMP}
bye
EOF
elif [[ "$DEPLOY_USE_SCP" == "1" ]]; then
	"${SCP_BASE[@]}" "${SSH_OPTS[@]}" "$TMP" "${REMOTE}:${DEPLOY_REMOTE_TMP}"
else
	"${SSH_BASE[@]}" "${SSH_OPTS[@]}" "$REMOTE" "cat > ${TGZ_Q}" <"$TMP"
fi

"${SSH_BASE[@]}" "${SSH_TTY[@]}" "${SSH_OPTS[@]}" "$REMOTE" "$REMOTE_EXTRACT_CMD"
"${SSH_BASE[@]}" "${SSH_TTY[@]}" "${SSH_OPTS[@]}" "$REMOTE" "$REMOTE_VERIFY_CMD" || {
	echo "ERROR: ${DEPLOY_PATH}/index.js missing after extract." >&2
	exit 1
}

echo "→ done: full server deploy to ${REMOTE}:${DEPLOY_PATH}"
