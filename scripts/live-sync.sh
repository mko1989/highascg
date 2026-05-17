#!/usr/bin/env bash
# Bidirectional rsync between this repo and the live HighAsCG tree over SSH.
# Reuses .env.deploy (same vars as scripts/dev-push.sh): DEPLOY_HOST, DEPLOY_USER, DEPLOY_PATH.
#
# Usage (from repo root on your Mac):
#   bash scripts/live-sync.sh deploy
#   bash scripts/live-sync.sh deploy --fresh-config   # rm server highascg.config.json + config/ then push
#   bash scripts/live-sync.sh pull
#   bash scripts/live-sync.sh pull --delete           # mirror server (removes Mac-only extra files)
#
# Includes: src/, web/, templates/, docs/, work/ (tracked + untracked), tools/, etc.
# Excludes: node_modules, large vendor clones, local env — see scripts/live-rsync-excludes.txt
#
# Same Node env: commit .nvmrc; on each machine after lockfile change: npm ci
#
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
DEPLOY_PATH="${DEPLOY_PATH:-/home/casparcg/highascg}"
REMOTE="${DEPLOY_USER}@${DEPLOY_HOST}"

EXCLUDES="$ROOT/scripts/live-rsync-excludes.txt"
if [[ ! -f "$EXCLUDES" ]]; then
	echo "missing $EXCLUDES" >&2
	exit 1
fi

MODE="${1:-}"
FRESH=0
DELETE_PULL=0
shift || true
for arg in "$@"; do
	case "$arg" in
		--fresh-config) FRESH=1 ;;
		--delete) DELETE_PULL=1 ;;
		*) echo "unknown option: $arg" >&2; exit 1 ;;
	esac
done

SSH=(ssh -o BatchMode=no)

# Protect machine-local files from --delete on the far side when they are not in the repo payload.
# Each rule must be one argv (path after "protect "); splitting broke rsync 3.4.x: "unexpected end of filter rule: protect"
PROTECT=(
	'--filter=protect .env'
	'--filter=protect .env.local'
	'--filter=protect go2rtc.yaml'
)

case "$MODE" in
	deploy)
		echo "→ deploy: $ROOT/ → ${REMOTE}:${DEPLOY_PATH}/"
		if [[ "$FRESH" == 1 ]]; then
			echo "→ --fresh-config: remove server highascg.config.json + config/ (replaced from repo)"
			"${SSH[@]}" "$REMOTE" "set -euo pipefail; cd $(printf '%q' "$DEPLOY_PATH"); rm -f highascg.config.json; rm -rf config"
		else
			PROTECT+=('--filter=protect highascg.config.json')
		fi
		rsync -avz --human-readable --stats -e "ssh -o BatchMode=no" --delete \
			"${PROTECT[@]}" \
			--exclude-from="$EXCLUDES" \
			"$ROOT/" "${REMOTE}:${DEPLOY_PATH}/"
		echo "→ deploy done. On server: cd $(printf '%q' "$DEPLOY_PATH") && npm ci   # if package-lock changed"
		;;
	pull)
		echo "← pull: ${REMOTE}:${DEPLOY_PATH}/ → $ROOT/"
		EXTRA=()
		if [[ "$DELETE_PULL" == 1 ]]; then
			echo "   (--delete: extra files only on Mac under this tree may be removed)"
			EXTRA+=(--delete)
		fi
		rsync -avz --human-readable --stats -e "ssh -o BatchMode=no" \
			"${EXTRA[@]}" \
			"${PROTECT[@]}" \
			--exclude-from="$EXCLUDES" \
			"${REMOTE}:${DEPLOY_PATH}/" "$ROOT/"
		echo "← pull done. Here: npm ci   # if package-lock changed"
		;;
	*)
		echo "usage: $0 deploy [--fresh-config] | pull [--delete]" >&2
		exit 1
		;;
esac
