#!/usr/bin/env bash
# Dev deploy: tar the unified repo → upload to /tmp on the playout host → ssh and extract.
# Includes dist-web/ (built operator UI) by default. UI sources: client/ in this repo.
#
# Preserves machine-local paths on the target (never in tarball, never deleted by the cleanup): bin/, lib/, cef-cache/,
# media/, config/, data/, .private/, projects/, applied/, log/, node_modules/, .env.
#
# Config: `.env.deploy` in repo root, or export DEPLOY_HOST, DEPLOY_USER, DEPLOY_PATH, …
# See comments in this file for DEPLOY_USE_SFTP, DEPLOY_REMOTE_SUDO, passwords, etc.
#
# Default: full stack (DEPLOY_SERVER_ONLY=0). Set DEPLOY_SERVER_ONLY=1 for API-only emergency.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck source=../lib/archive-common.sh
source "${ROOT}/scripts/lib/archive-common.sh"
cd "$ROOT"

_DEPLOY_HOST_OVERRIDE="${DEPLOY_HOST:-}"
_DEPLOY_USER_OVERRIDE="${DEPLOY_USER:-}"
_DEPLOY_PATH_OVERRIDE="${DEPLOY_PATH:-}"
_DEPLOY_REMOTE_SUDO_OVERRIDE="${DEPLOY_REMOTE_SUDO:-}"

if [[ -f .env.deploy ]]; then
	set -a
	# shellcheck source=/dev/null
	source .env.deploy
	set +a
fi

DEPLOY_HOST="${_DEPLOY_HOST_OVERRIDE:-${DEPLOY_HOST:-192.168.0.2}}"
DEPLOY_USER="${_DEPLOY_USER_OVERRIDE:-${DEPLOY_USER:-casparcg}}"
DEPLOY_PATH="${_DEPLOY_PATH_OVERRIDE:-${DEPLOY_PATH:-/home/casparcg/highascg}}"
DEPLOY_REMOTE_TMP="${DEPLOY_REMOTE_TMP:-/tmp/highascg-deploy-${DEPLOY_USER}.tgz}"
DEPLOY_USE_SCP="${DEPLOY_USE_SCP:-0}"
DEPLOY_USE_SFTP="${DEPLOY_USE_SFTP:-0}"
if [[ -n "${_DEPLOY_REMOTE_SUDO_OVERRIDE}" ]]; then
	DEPLOY_REMOTE_SUDO="${_DEPLOY_REMOTE_SUDO_OVERRIDE}"
else
	DEPLOY_REMOTE_SUDO="${DEPLOY_REMOTE_SUDO:-0}"
fi
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
if [[ "$DEPLOY_REMOTE_SUDO" == "1" ]]; then
	SSH_TTY=(-t)
fi

SSH_BASE=(ssh)
SCP_BASE=(scp)
SFTP_BASE=(sftp)
if [[ -n "$DEPLOY_SSH_PASSWORD" ]]; then
	if ! command -v sshpass >/dev/null 2>&1; then
		echo "deploy failed: DEPLOY_SSH_PASSWORD is set but sshpass is not installed." >&2
		exit 1
	fi
	SSH_BASE=(sshpass -p "$DEPLOY_SSH_PASSWORD" ssh)
	SCP_BASE=(sshpass -p "$DEPLOY_SSH_PASSWORD" scp)
	SFTP_BASE=(sshpass -p "$DEPLOY_SSH_PASSWORD" sftp)
fi

echo "→ ssh: check ${REMOTE}"
set +e
ssh_probe_out=$("${SSH_BASE[@]}" "${SSH_OPTS[@]}" "$REMOTE" "true" 2>&1)
ssh_probe_rc=$?
set -euo pipefail
if [[ "$ssh_probe_rc" -ne 0 ]]; then
	echo "$ssh_probe_out" >&2
	exit 1
fi

export COPYFILE_DISABLE=1

if [[ "${DEPLOY_SERVER_ONLY:-0}" != "1" ]]; then
	archive_common_build_client_if_requested "$ROOT"
	if [[ ! -f "${ROOT}/dist-web/index.html" ]]; then
		echo "WARN: dist-web/index.html missing — run npm run build:client before deploy." >&2
	fi
fi
local_excludes=()
archive_common_deploy_tar_excludes local_excludes
archive_common_apply_deploy_packaging_rules "$ROOT" local_excludes
# WO-842: per-box state never travels (the source's api-token / projects would overlay the target's on extract)
local_excludes+=(--exclude=./.private --exclude=./projects --exclude=./applied)

echo "→ tar → $TMP (server-only=${DEPLOY_SERVER_ONLY:-0})"
tar czf "$TMP" "${local_excludes[@]}" .

# WO-842 (sweep 4k): the remote cleanup used to `rm -rf` EVERY top-level entry that was not on a short keep list, which
# took out data/, .private/api-token, projects/, log/ and applied/ of the target (the tarball never carries them). It now
# removes only the top-level entries this tarball actually ships (an explicit, derived allowlist of what the push manages,
# so stale files inside src/, client/, ... still go) and never one of the machine-local PROTECTED names, even if shipped.
DEPLOY_PATH="${DEPLOY_PATH%/}"
if [[ "$DEPLOY_PATH" != /* || "$(awk -F/ '{n=0; for(i=1;i<=NF;i++) if($i!="") n++; print n}' <<<"$DEPLOY_PATH")" -lt 2 ]]; then
	echo "deploy failed: DEPLOY_PATH must be an absolute path at least two levels deep (got '${DEPLOY_PATH}')." >&2
	exit 1
fi
DEPLOY_PROTECTED=(
	config data .private projects applied log media _media bin lib cef-cache node_modules
	.env .env.local highascg.config.json .highascg-state.json .module-state.json .highascg-previs
)
managed_names=()
while IFS= read -r _name; do
	[[ -z "$_name" || "$_name" == "." ]] && continue
	if [[ ! "$_name" =~ ^[A-Za-z0-9._-]+$ || "$_name" == "." || "$_name" == ".." ]]; then
		echo "WARN: not cleaning odd top-level name in tarball: ${_name}" >&2
		continue
	fi
	for _p in "${DEPLOY_PROTECTED[@]}"; do [[ "$_name" == "$_p" ]] && continue 2; done
	managed_names+=("$_name")
done < <(tar tzf "$TMP" | sed -E 's#^\./##; s#/.*$##' | sort -u)
MANAGED_LIST="${managed_names[*]}"

PATH_Q=$(printf '%q' "$DEPLOY_PATH")
TGZ_Q=$(printf '%q' "$DEPLOY_REMOTE_TMP")
INDEX_Q=$(printf '%q' "${DEPLOY_PATH}/index.js")
PKG_Q=$(printf '%q' "${DEPLOY_PATH}/package.json")

REMOTE_INNER="set -euo pipefail; mkdir -p ${PATH_Q}; for n in ${MANAGED_LIST}; do rm -rf -- ${PATH_Q}/\"\$n\"; done; env -u TAR_OPTIONS tar -m -xzf ${TGZ_Q} -C ${PATH_Q}; rm -f ${TGZ_Q}; if [[ ! -d ${PATH_Q}/node_modules ]]; then (cd ${PATH_Q} && npm ci --omit=dev); fi; ENV_F=${PATH_Q}/.env; touch \"\$ENV_F\"; if grep -q '^HIGHASCG_HEADLESS=true' \"\$ENV_F\" 2>/dev/null; then sed -i '/^HIGHASCG_HEADLESS=true/d' \"\$ENV_F\"; fi; chown -R ${DEPLOY_USER}:${DEPLOY_USER} ${PATH_Q}"
if [[ "$DEPLOY_REMOTE_SUDO" == "1" ]]; then
	if [[ -n "$DEPLOY_SUDO_PASSWORD" ]]; then
		SUDO_PW_SQ=${DEPLOY_SUDO_PASSWORD//\'/\'\"\'\"\'}
		REMOTE_EXTRACT_CMD="printf '%s\n' '${SUDO_PW_SQ}' | sudo -S -p '' bash -c $(printf '%q' "$REMOTE_INNER")"
		REMOTE_VERIFY_CMD="printf '%s\n' '${SUDO_PW_SQ}' | sudo -S -p '' sh -c 'test -f ${INDEX_Q} && test -f ${PKG_Q}'"
	else
		REMOTE_EXTRACT_CMD="sudo bash -c $(printf '%q' "$REMOTE_INNER")"
		REMOTE_VERIFY_CMD="sudo test -f ${INDEX_Q} && sudo test -f ${PKG_Q}"
	fi
else
	REMOTE_EXTRACT_CMD="$REMOTE_INNER"
	REMOTE_VERIFY_CMD="test -f ${INDEX_Q} && test -f ${PKG_Q}"
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

if ! "${SSH_BASE[@]}" "${SSH_TTY[@]}" "${SSH_OPTS[@]}" "$REMOTE" "$REMOTE_VERIFY_CMD"; then
	echo "ERROR: ${DEPLOY_PATH}/index.js or package.json missing after extract."
	exit 1
fi

echo "→ done: ${REMOTE}:${DEPLOY_PATH}. Restart highascg.service if used."
if [[ "${DEPLOY_SERVER_ONLY:-0}" == "1" ]]; then
	echo "   Deployed API-only (DEPLOY_SERVER_ONLY=1). Run npm run build:client on playout for UI."
else
	echo "   Operator UI: http://${DEPLOY_HOST}:4200/ (dist-web/ from in-repo client/)"
fi
