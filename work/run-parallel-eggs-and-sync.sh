#!/usr/bin/env bash
# Start eggs clone+flash (sda) and mirror deploy (.25) in separate tmux sessions.
#
# Usage:
#   bash work/run-parallel-eggs-and-sync.sh
#   bash work/run-parallel-eggs-and-sync.sh --attach eggs    # attach eggs session
#   bash work/run-parallel-eggs-and-sync.sh --attach sync    # attach sync session
#
# Env:
#   USB_DEVICE=/dev/sda
#   DEPLOY_HOST=192.168.0.25
#   HIGHASCG_NVIDIA_DRIVER=595
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
USB="${USB_DEVICE:-/dev/sda}"
DEPLOY_HOST="${DEPLOY_HOST:-192.168.0.25}"
EGGS_SESSION="${TMUX_SESSION:-highascg-eggs}"
SYNC_SESSION="${TMUX_SYNC_SESSION:-highascg-sync}"

usage() {
	sed -n '2,12p' "$0" | tail -n +2
	exit "${1:-0}"
}

ATTACH=""
while [[ $# -gt 0 ]]; do
	case "$1" in
		-h | --help) usage 0 ;;
		--attach)
			ATTACH="${2:-}"
			shift
			;;
		*)
			echo "Unknown option: $1" >&2
			usage 1
			;;
	esac
	shift
done

if [[ -n "$ATTACH" ]]; then
	case "$ATTACH" in
		eggs) exec tmux attach -t "$EGGS_SESSION" ;;
		sync) exec tmux attach -t "$SYNC_SESSION" ;;
		*)
			echo "Use --attach eggs|sync" >&2
			exit 1
			;;
	esac
fi

echo "Starting parallel jobs:"
echo "  [eggs]  USB_DEVICE=${USB}  session=${EGGS_SESSION}"
echo "  [sync]  DEPLOY_HOST=${DEPLOY_HOST}  session=${SYNC_SESSION}"
echo

USB_DEVICE="$USB" TMUX_SESSION="$EGGS_SESSION" bash "${REPO}/work/run-eggs-clone-flash-tmux.sh"
DEPLOY_HOST="$DEPLOY_HOST" TMUX_SESSION="$SYNC_SESSION" bash "${REPO}/work/run-deploy-mirror-tmux.sh"

echo
echo "Both sessions started."
echo "  eggs: tmux attach -t ${EGGS_SESSION}   (sudo password in that pane)"
echo "  sync: tmux attach -t ${SYNC_SESSION}"
echo
echo "When sync finishes on ${DEPLOY_HOST}:"
echo "  ssh casparcg@${DEPLOY_HOST} 'cd ~/highascg && sudo bash work/bootstrap-remote-after-sync.sh'"
