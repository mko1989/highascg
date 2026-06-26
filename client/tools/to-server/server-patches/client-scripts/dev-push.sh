#!/usr/bin/env bash
# Push operator UI only (dist-web/) to playout — does NOT touch server src/, scripts/, etc.
#
# Usage (server repo root, after sync-dist-web-from-client.sh or to-server:apply):
#   bash client-scripts/dev-push.sh
#
# Or from highascg-client monorepo:
#   npm run deploy:client
#
# Config: .env.deploy in server repo root (DEPLOY_HOST, DEPLOY_USER, DEPLOY_PATH, …)
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ -f "${ROOT}/.env.deploy" ]]; then
	set -a
	# shellcheck source=/dev/null
	source "${ROOT}/.env.deploy"
	set +a
fi

DEPLOY_HOST="${DEPLOY_HOST:-192.168.0.2}"
DEPLOY_USER="${DEPLOY_USER:-casparcg}"
DEPLOY_PATH="${DEPLOY_PATH:-/home/casparcg/highascg}"
DEPLOY_REMOTE_SUDO="${DEPLOY_REMOTE_SUDO:-0}"
DEPLOY_SSH_PASSWORD="${DEPLOY_SSH_PASSWORD:-}"
DEPLOY_SUDO_PASSWORD="${DEPLOY_SUDO_PASSWORD:-}"
REMOTE="${DEPLOY_USER}@${DEPLOY_HOST}"
DIST_WEB="${ROOT}/dist-web"

# Optional: build from sibling client repo before push
if [[ "${DEPLOY_BUILD_CLIENT:-0}" == "1" ]]; then
	CLIENT_ROOT="${HIGHASCG_CLIENT_ROOT:-$(cd "${ROOT}/.." && pwd)}"
	if [[ -f "${CLIENT_ROOT}/package.json" ]] && [[ -f "${CLIENT_ROOT}/vite.config.js" ]]; then
		echo "==> npm run build:client in ${CLIENT_ROOT}"
		(cd "$CLIENT_ROOT" && npm run build:client)
		if [[ "$CLIENT_ROOT" != "$ROOT" ]]; then
			rsync -a --delete "${CLIENT_ROOT}/dist-web/" "${DIST_WEB}/"
		fi
	fi
fi

[[ -f "${DIST_WEB}/index.html" ]] || {
	echo "ERROR: ${DIST_WEB}/index.html missing." >&2
	echo "  npm run to-server:prepare   (client repo)" >&2
	echo "  bash client-scripts/sync-dist-web-from-client.sh --build" >&2
	exit 1
}

SSH_BASE=(ssh)
RSYNC_RSH=(ssh)
if [[ -n "$DEPLOY_SSH_PASSWORD" ]]; then
	command -v sshpass >/dev/null 2>&1 || {
		echo "DEPLOY_SSH_PASSWORD set but sshpass not installed" >&2
		exit 1
	}
	SSH_BASE=(sshpass -p "$DEPLOY_SSH_PASSWORD" ssh)
	RSYNC_RSH=(sshpass -p "$DEPLOY_SSH_PASSWORD" ssh)
fi

SSH_OPTS=(-o BatchMode=no -o ServerAliveInterval=30)

echo "→ UI-only deploy: ${DIST_WEB}/ → ${REMOTE}:${DEPLOY_PATH}/dist-web/"
echo "   (server src/, config/, node_modules/ are NOT modified)"

"${SSH_BASE[@]}" "${SSH_OPTS[@]}" "$REMOTE" "mkdir -p $(printf '%q' "${DEPLOY_PATH}/dist-web")"

RSYNC_SSH="ssh"
if [[ -n "$DEPLOY_SSH_PASSWORD" ]]; then
	RSYNC_SSH="sshpass -p ${DEPLOY_SSH_PASSWORD} ssh"
fi

rsync -avz --delete -e "$RSYNC_SSH" "${DIST_WEB}/" "${REMOTE}:${DEPLOY_PATH}/dist-web/"

# Clear headless flag so UI is served (WO-52)
ENV_CMD="ENV_F=${DEPLOY_PATH}/.env; touch \"\$ENV_F\"; sed -i '/^HIGHASCG_HEADLESS=/d' \"\$ENV_F\""
if [[ "$DEPLOY_REMOTE_SUDO" == "1" ]]; then
	if [[ -n "$DEPLOY_SUDO_PASSWORD" ]]; then
		PW_SQ=${DEPLOY_SUDO_PASSWORD//\'/\'\"\'\"\'}
		"${SSH_BASE[@]}" "${SSH_OPTS[@]}" -t "$REMOTE" "printf '%s\n' '${PW_SQ}' | sudo -S -p '' bash -c $(printf '%q' "$ENV_CMD")"
	else
		"${SSH_BASE[@]}" "${SSH_OPTS[@]}" -t "$REMOTE" "sudo bash -c $(printf '%q' "$ENV_CMD")"
	fi
else
	"${SSH_BASE[@]}" "${SSH_OPTS[@]}" "$REMOTE" "$ENV_CMD"
fi

echo "→ done. Restart on server: sudo systemctl restart highascg"
echo "   UI: http://${DEPLOY_HOST}:4200/"
