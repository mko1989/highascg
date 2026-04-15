#!/usr/bin/env bash
# Dev deploy: pack HighAsCG, upload with scp, extract on the server (avoids scp -r of node_modules).
# highascg.config.json is excluded so production settings on the server are not overwritten by the tarball.
#
# Config: export env vars, or put them in .env.deploy (same dir as this script's parent: repo root).
#   DEPLOY_HOST     target (default: 192.168.0.2)
#   DEPLOY_USER     SSH user (default: casparcg)
#   DEPLOY_PATH     remote directory (default: /opt/highascg)
#
# Usage: from repo root — npm run deploy:dev   or   ./scripts/dev-push.sh
# After extract, restart the app on the server yourself if needed (e.g. systemctl is not reliable over ssh here).
#
# Quick single file (after an edit), from repo root:
#   scp web/lib/webrtc-client.js casparcg@192.168.0.2:/opt/highascg/web/lib/webrtc-client.js
#   scp src/api/routes-streaming.js casparcg@192.168.0.2:/opt/highascg/src/api/routes-streaming.js

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
REMOTE="${DEPLOY_USER}@${DEPLOY_HOST}"

# macOS OpenSSH sets DSCP (CS1) on bulk transfers; many LAN/Wi‑Fi paths mishandle it and
# scp/rsync then stalls at a fixed byte offset. Clearing QoS fixes that without needing Tailscale.
SSH_BASE_OPTS=(
	-o ServerAliveInterval=30
	-o ServerAliveCountMax=6
	-o TCPKeepAlive=yes
	-o IPQoS=none
)

TMP="$(mktemp /tmp/highascg-dev.XXXXXX.tgz)"
trap 'rm -f "$TMP"' EXIT

# macOS tar uses copyfile(3) and embeds xattrs (com.apple.provenance, etc.). That spams Linux
# extract with LIBARCHIVE.* warnings and can error with "Could not pack extended attributes"
# when the temp archive path does not support storing those metadata records.
export COPYFILE_DISABLE=1

echo "→ tar (exclude node_modules, .git, work, env, live server config) → $TMP"
tar czf "$TMP" \
	--exclude=node_modules \
	--exclude=.git \
	--exclude=work \
	--exclude=.env \
	--exclude=.env.local \
	--exclude='*.log' \
	--exclude=highascg.config.json \
	.

# rsync over ssh is more resilient than scp for large blobs; tarball is already gzip — no -z.
echo "→ upload → ${REMOTE}:/tmp/highascg-dev.tgz"
if command -v rsync >/dev/null 2>&1; then
	rsync -av --progress --partial --inplace \
		-e "ssh ${SSH_BASE_OPTS[*]}" \
		"$TMP" "${REMOTE}:/tmp/highascg-dev.tgz"
else
	scp "${SSH_BASE_OPTS[@]}" \
		"$TMP" "${REMOTE}:/tmp/highascg-dev.tgz"
fi

echo "→ ssh: mkdir -p ${DEPLOY_PATH} && tar xzf … -C ${DEPLOY_PATH}"
ssh "${SSH_BASE_OPTS[@]}" \
	"$REMOTE" "set -e; mkdir -p '${DEPLOY_PATH}'; tar xzf /tmp/highascg-dev.tgz -C '${DEPLOY_PATH}'; rm -f /tmp/highascg-dev.tgz"

echo "→ done: ${REMOTE}:${DEPLOY_PATH}"
