#!/usr/bin/env bash
# Tar the repo and upload the tarball to the server /tmp only (no extract, no remote deploy).
# Reuses the same archive layout and env as scripts/dev-push.sh.
#
# Config: `.env.deploy` in repo root, or export:
#   DEPLOY_HOST        (default: 192.168.0.2)
#   DEPLOY_USER        (default: casparcg)
#   DEPLOY_REMOTE_TMP  (default: /tmp/highascg-deploy-USER.tgz)
#   DEPLOY_USE_SFTP    (default: 0) set to 1 for sftp put
#   DEPLOY_USE_SCP     (default: 0) set to 1 for scp
#   (default upload: ssh stream `cat >` remote path — same as dev-push.sh)
#   DEPLOY_SSH_PASSWORD optional, via sshpass
#   DEPLOY_SSH_CONTROL optional ControlMaster socket path
#
# `highascg.config.json` is excluded from the tarball (same as dev-push.sh).

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
DEPLOY_REMOTE_TMP="${DEPLOY_REMOTE_TMP:-/tmp/highascg-deploy-${DEPLOY_USER}.tgz}"
DEPLOY_USE_SCP="${DEPLOY_USE_SCP:-0}"
DEPLOY_USE_SFTP="${DEPLOY_USE_SFTP:-0}"
DEPLOY_SSH_PASSWORD="${DEPLOY_SSH_PASSWORD:-}"
REMOTE="${DEPLOY_USER}@${DEPLOY_HOST}"

TMP="$(mktemp /tmp/highascg-tar-to-tmp.XXXXXX.tgz)"
CTRL_SOCK="${DEPLOY_SSH_CONTROL:-${TMPDIR:-/tmp}/highascg-tar-to-tmp-$$.sock}"
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

SSH_BASE=(ssh)
SCP_BASE=(scp)
SFTP_BASE=(sftp)
if [[ -n "$DEPLOY_SSH_PASSWORD" ]]; then
	if ! command -v sshpass >/dev/null 2>&1; then
		echo "deploy-tar-to-tmp failed: DEPLOY_SSH_PASSWORD is set but sshpass is not installed." >&2
		exit 1
	fi
	SSH_BASE=(sshpass -p "$DEPLOY_SSH_PASSWORD" ssh)
	SCP_BASE=(sshpass -p "$DEPLOY_SSH_PASSWORD" scp)
	SFTP_BASE=(sshpass -p "$DEPLOY_SSH_PASSWORD" sftp)
fi

echo "→ ssh: check ${REMOTE} (opens connection reuse for upload)"
set +e
ssh_probe_out=$("${SSH_BASE[@]}" "${SSH_OPTS[@]}" "$REMOTE" "true" 2>&1)
ssh_probe_rc=$?
set -euo pipefail
if [[ "$ssh_probe_rc" -ne 0 ]]; then
	echo "$ssh_probe_out" >&2
	echo "deploy-tar-to-tmp failed: SSH cannot run commands as ${DEPLOY_USER}." >&2
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

TGZ_Q=$(printf '%q' "$DEPLOY_REMOTE_TMP")

if [[ "$DEPLOY_USE_SFTP" == "1" ]]; then
	echo "→ sftp put → ${REMOTE}:${DEPLOY_REMOTE_TMP}"
	"${SFTP_BASE[@]}" "${SSH_OPTS[@]}" "$REMOTE" <<EOF
put ${TMP} ${DEPLOY_REMOTE_TMP}
bye
EOF
elif [[ "$DEPLOY_USE_SCP" == "1" ]]; then
	echo "→ scp → ${REMOTE}:${DEPLOY_REMOTE_TMP}"
	"${SCP_BASE[@]}" "${SSH_OPTS[@]}" "$TMP" "${REMOTE}:${DEPLOY_REMOTE_TMP}"
else
	echo "→ ssh stream → ${REMOTE}:${DEPLOY_REMOTE_TMP}"
	"${SSH_BASE[@]}" "${SSH_OPTS[@]}" "$REMOTE" "cat > ${TGZ_Q}" <"$TMP"
fi

echo "→ done: tarball on server at ${DEPLOY_REMOTE_TMP}"
echo "   extract manually, e.g.: tar -xzf ${DEPLOY_REMOTE_TMP} -C /path/to/target"
