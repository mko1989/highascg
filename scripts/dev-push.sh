#!/usr/bin/env bash
# Dev deploy: tar the repo → upload to /tmp on the server → ssh and extract into DEPLOY_PATH.
# Does not run npm on the server (you install deps there yourself).
#
# The deploy user must be able to run remote commands (same as `ssh user@host true`).
# If you see "This account is currently not available", /etc/passwd for that user likely has
# shell /usr/sbin/nologin or /bin/false — give a real shell for deploy, e.g.:
#   sudo chsh -s /bin/bash casparcg
# (SFTP-only / internal-sftp accounts cannot run this script's extract step unless you change the workflow.)
#
# Upload default: stream the tarball over `ssh` (`cat > remote`), same transport as the extract step.
# SFTP is optional (DEPLOY_USE_SFTP=1). SFTP can fail with:
#   "Received message too long … Ensure the remote shell produces no output for non-interactive sessions"
# when the server misbehaves or something prints before the SFTP binary protocol (banner, broken
# subsystem, proxy). Fix on the server: guard ~/.bashrc / use internal-sftp / quiet profiles.
# SSH connection sharing (ControlMaster) is enabled so you are prompted for your password once
# for upload + the following ssh commands.
# Set DEPLOY_USE_SCP=1 to use `scp` (OpenSSH 9+ may still use SFTP under the hood; try stream default first).
#
# Config: `.env.deploy` in repo root, or export:
#   DEPLOY_HOST        (default: 192.168.0.2)
#   DEPLOY_USER        (default: casparcg)
#   DEPLOY_PATH        (default: /opt/highascg)
#   DEPLOY_REMOTE_TMP  (default: /tmp/highascg-deploy-USER.tgz)
#   DEPLOY_USE_SFTP    (default: 0) set to 1 to upload with interactive sftp (here-doc put)
#   DEPLOY_USE_SCP     (default: 0) set to 1 to upload with scp instead of ssh stream
#   DEPLOY_REMOTE_SUDO (default: 0) set to 1 to run mkdir/find/tar/rm under DEPLOY_PATH via sudo
#                        (needed when DEPLOY_PATH is under /opt and not writable by DEPLOY_USER).
#                        Uses ssh -t for extract/verify so an interactive sudo password works; for
#                        passwordless deploy use sudoers NOPASSWD for the deploy user.
#   DEPLOY_SSH_PASSWORD optional SSH password used via `sshpass` to avoid repeated SSH prompts
#                       (requires `sshpass` installed on the machine running deploy).
#   DEPLOY_SUDO_PASSWORD optional sudo password used on the remote host when DEPLOY_REMOTE_SUDO=1
#                        (sent to `sudo -S`; avoids remote sudo prompts).
#   DEPLOY_SSH_CONTROL optional path for SSH multiplex socket (default: /tmp/highascg-deploy-$$.sock)
#
# `highascg.config.json` is excluded so the server copy is not overwritten.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ -f .env.deploy ]]; then
	set -a
	# shellcheck source=/dev/null
	source .env.deploy
	set +a
fi

DEPLOY_HOST="${DEPLOY_HOST:-192.168.0.2}"
DEPLOY_USER="${DEPLOY_USER:-casparcg}"
DEPLOY_PATH="${DEPLOY_PATH:-/opt/highascg}"
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
if [[ "$DEPLOY_REMOTE_SUDO" == "1" ]]; then
	SSH_TTY=(-t)
fi

SSH_BASE=(ssh)
SCP_BASE=(scp)
SFTP_BASE=(sftp)
if [[ -n "$DEPLOY_SSH_PASSWORD" ]]; then
	if ! command -v sshpass >/dev/null 2>&1; then
		echo "deploy failed: DEPLOY_SSH_PASSWORD is set but sshpass is not installed." >&2
		echo "Install sshpass or unset DEPLOY_SSH_PASSWORD to use interactive prompts." >&2
		exit 1
	fi
	SSH_BASE=(sshpass -p "$DEPLOY_SSH_PASSWORD" ssh)
	SCP_BASE=(sshpass -p "$DEPLOY_SSH_PASSWORD" scp)
	SFTP_BASE=(sshpass -p "$DEPLOY_SSH_PASSWORD" sftp)
fi

echo "→ ssh: check ${REMOTE} can run remote commands (password if needed; opens connection reuse for later steps)"
set +e
ssh_probe_out=$("${SSH_BASE[@]}" "${SSH_OPTS[@]}" "$REMOTE" "true" 2>&1)
ssh_probe_rc=$?
set -euo pipefail
if [[ "$ssh_probe_rc" -ne 0 ]]; then
	echo "$ssh_probe_out" >&2
	echo "" >&2
	echo "deploy failed: SSH cannot run commands as ${DEPLOY_USER}." >&2
	if [[ "$ssh_probe_out" == *"not available"* ]] || [[ "$ssh_probe_out" == *"nologin"* ]]; then
		echo "  This user probably has shell /usr/sbin/nologin or /bin/false." >&2
		echo "  On the server (as root): chsh -s /bin/bash ${DEPLOY_USER}" >&2
	fi
	echo "  DEPLOY_USE_SCP / SFTP do not fix this — extract also needs a normal shell." >&2
	exit 1
fi

export COPYFILE_DISABLE=1

echo "→ tar → $TMP"
tar czf "$TMP" \
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
	--exclude='config/*.json' \
	.

PATH_Q=$(printf '%q' "$DEPLOY_PATH")
TGZ_Q=$(printf '%q' "$DEPLOY_REMOTE_TMP")
INDEX_Q=$(printf '%q' "${DEPLOY_PATH}/index.js")

# Wipe app tree before unpack, but keep server-local files: live config, project state, previs and existing node_modules
# (tarball excludes node_modules — without this preserve, every deploy would delete deps and force npm install).
REMOTE_INNER="set -euo pipefail; mkdir -p ${PATH_Q}; find ${PATH_Q} -mindepth 1 -maxdepth 1 ! -name 'highascg.config.json' ! -name '.highascg-state.json' ! -name '.module-state.json' ! -name '.highascg-previs' ! -name 'config' ! -name 'node_modules' -exec rm -rf {} +; env -u TAR_OPTIONS tar -m -xzf ${TGZ_Q} -C ${PATH_Q}; rm -f ${TGZ_Q}; chown -R ${DEPLOY_USER}:${DEPLOY_USER} ${PATH_Q}"
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
	echo "→ sftp put → ${REMOTE}:${DEPLOY_REMOTE_TMP} (password prompt in this terminal if needed)"
	"${SFTP_BASE[@]}" "${SSH_OPTS[@]}" "$REMOTE" <<EOF
put ${TMP} ${DEPLOY_REMOTE_TMP}
bye
EOF
elif [[ "$DEPLOY_USE_SCP" == "1" ]]; then
	echo "→ scp → ${REMOTE}:${DEPLOY_REMOTE_TMP} (password prompt in this terminal if needed)"
	"${SCP_BASE[@]}" "${SSH_OPTS[@]}" "$TMP" "${REMOTE}:${DEPLOY_REMOTE_TMP}"
else
	echo "→ ssh stream → ${REMOTE}:${DEPLOY_REMOTE_TMP} (password prompt in this terminal if needed)"
	"${SSH_BASE[@]}" "${SSH_OPTS[@]}" "$REMOTE" "cat > ${TGZ_Q}" <"$TMP"
fi

echo "→ ssh: extract into ${DEPLOY_PATH} (keep existing highascg.config.json), remove tarball"
if [[ "$DEPLOY_REMOTE_SUDO" == "1" ]]; then
	echo "   (remote: sudo — enter sudo password on the server if prompted)" >&2
fi
# Strip direct children except live config, then unpack (GNU tar on server).
"${SSH_BASE[@]}" "${SSH_TTY[@]}" "${SSH_OPTS[@]}" "$REMOTE" "$REMOTE_EXTRACT_CMD"

if ! "${SSH_BASE[@]}" "${SSH_TTY[@]}" "${SSH_OPTS[@]}" "$REMOTE" "$REMOTE_VERIFY_CMD"; then
	echo "ERROR: ${DEPLOY_PATH}/index.js missing after extract."
	exit 1
fi

echo "→ done: ${REMOTE}:${DEPLOY_PATH} — run npm install (or npm ci) only when package.json / lockfile changed."
