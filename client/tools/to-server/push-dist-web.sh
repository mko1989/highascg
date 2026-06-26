#!/usr/bin/env bash
# Push dist-web/ to playout from highascg-client repo (no server checkout required).
#
# Usage:
#   npm run deploy:client
#   bash client/tools/to-server/push-dist-web.sh
#
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLIENT_ROOT="$(cd "${HERE}/../../.." && pwd)"
ENV_FILE="${HIGHASCG_DEPLOY_ENV:-${CLIENT_ROOT}/not-needed/.env.deploy}"

if [[ -f "$ENV_FILE" ]]; then
	set -a
	# shellcheck source=/dev/null
	source "$ENV_FILE"
	set +a
fi

DEPLOY_HOST="${DEPLOY_HOST:-192.168.0.2}"
DEPLOY_USER="${DEPLOY_USER:-casparcg}"
DEPLOY_PATH="${DEPLOY_PATH:-/home/casparcg/highascg}"

[[ -f "${CLIENT_ROOT}/dist-web/index.html" ]] || {
	echo "==> build client"
	(cd "$CLIENT_ROOT" && npm run build:client)
}

export DEPLOY_HOST DEPLOY_USER DEPLOY_PATH
export DEPLOY_BUILD_CLIENT=0

# Reuse server-side UI-only script if server tree present
SERVER_PUSH="${CLIENT_ROOT}/not-needed/client-scripts/dev-push.sh"
if [[ -f "$SERVER_PUSH" ]]; then
	ROOT="${CLIENT_ROOT}/not-needed"
	[[ -d "${ROOT}/dist-web" ]] || mkdir -p "${ROOT}/dist-web"
	rsync -a --delete "${CLIENT_ROOT}/dist-web/" "${ROOT}/dist-web/"
	bash "$SERVER_PUSH"
	exit $?
fi

REMOTE="${DEPLOY_USER}@${DEPLOY_HOST}"
echo "→ rsync dist-web/ → ${REMOTE}:${DEPLOY_PATH}/dist-web/"
rsync -avz --delete -e ssh "${CLIENT_ROOT}/dist-web/" "${REMOTE}:${DEPLOY_PATH}/dist-web/"
echo "→ done. sudo systemctl restart highascg on server"
echo "   http://${DEPLOY_HOST}:4200/"
