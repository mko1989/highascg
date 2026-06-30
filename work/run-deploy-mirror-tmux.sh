#!/usr/bin/env bash
# Full project mirror rsync to a playout host that cannot reach GitHub.
#
# Runs push-backup-box.sh DEPLOY_MODE=mirror inside a detached tmux session.
#
# Usage:
#   bash work/run-deploy-mirror-tmux.sh
#   bash work/run-deploy-mirror-tmux.sh --attach
#   bash work/run-deploy-mirror-tmux.sh --attach-only
#   DEPLOY_HOST=192.168.0.25 bash work/run-deploy-mirror-tmux.sh --attach
#
# Env:
#   DEPLOY_HOST=192.168.0.25   (default)
#   DEPLOY_USER=casparcg
#   DEPLOY_PATH=/home/casparcg/highascg
#   DEPLOY_SKIP_BUILD=1        skip client build before rsync
#   TMUX_SESSION=highascg-sync tmux session name
#
# After sync completes on the remote:
#   ssh casparcg@192.168.0.25 'cd ~/highascg && sudo bash work/bootstrap-remote-after-sync.sh'
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SESSION="${TMUX_SESSION:-highascg-sync}"
DEPLOY_HOST="${DEPLOY_HOST:-192.168.0.25}"
DEPLOY_USER="${DEPLOY_USER:-casparcg}"
ATTACH=false
ATTACH_ONLY=false
LOG=""

usage() {
	sed -n '2,20p' "$0" | tail -n +2
	exit "${1:-0}"
}

while [[ $# -gt 0 ]]; do
	case "$1" in
		-h | --help) usage 0 ;;
		--attach) ATTACH=true ;;
		--attach-only) ATTACH_ONLY=true ;;
		*)
			echo "Unknown option: $1" >&2
			usage 1
			;;
	esac
	shift
done

command -v tmux >/dev/null || {
	echo "Install tmux: sudo apt-get install -y tmux" >&2
	exit 1
}

if "$ATTACH_ONLY"; then
	exec tmux attach -t "$SESSION"
fi

if tmux has-session -t "$SESSION" 2>/dev/null; then
	echo "tmux session already running: $SESSION" >&2
	echo "  tmux attach -t $SESSION" >&2
	echo "  tmux kill-session -t $SESSION   # to restart" >&2
	exit 1
fi

mkdir -p "${REPO}/work"
LOG="${REPO}/work/deploy-mirror-$(date +%Y%m%d-%H%M%S).log"

RUNNER="$(mktemp)"
trap 'rm -f "$RUNNER"' EXIT
cat >"$RUNNER" <<RUNEOF
#!/usr/bin/env bash
set -euo pipefail
REPO=${REPO}
LOG=${LOG}
export DEPLOY_MODE=mirror
export DEPLOY_HOST=${DEPLOY_HOST}
export DEPLOY_USER=${DEPLOY_USER}
export DEPLOY_PATH=${DEPLOY_PATH:-/home/casparcg/highascg}
export DEPLOY_SKIP_BUILD=${DEPLOY_SKIP_BUILD:-0}
export DEPLOY_MIRROR_DELETE=${DEPLOY_MIRROR_DELETE:-1}

exec > >(tee -a "\$LOG") 2>&1

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "HighAsCG mirror deploy"
echo "  started:  \$(date -Is)"
echo "  host:     \$(hostname)"
echo "  target:   \${DEPLOY_USER}@\${DEPLOY_HOST}:\${DEPLOY_PATH}"
echo "  log:      \${LOG}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo

cd "\$REPO"

echo "==> Stage offline bootstrap assets (scanner deb, etc.)"
bash "\$REPO/work/stage-offline-bootstrap-assets.sh"

echo "==> Build client (unless DEPLOY_SKIP_BUILD=1)"
bash "\$REPO/scripts/deploy/push-backup-box.sh"

echo
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Mirror deploy finished: \$(date -Is)"
echo "  log: \${LOG}"
echo
echo "On remote (\${DEPLOY_HOST}):"
echo "  cd ~/highascg && sudo bash work/bootstrap-remote-after-sync.sh"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
read -r -p "Press Enter to close this tmux window… "
RUNEOF
chmod 0755 "$RUNNER"

tmux new-session -d -s "$SESSION" -n mirror "bash '$RUNNER'"

echo "Started tmux session: $SESSION"
echo "  target: ${DEPLOY_USER}@${DEPLOY_HOST}"
echo "  log:    $LOG"
echo "  attach: tmux attach -t $SESSION"
echo
echo "After rsync completes, on the remote box:"
echo "  ssh ${DEPLOY_USER}@${DEPLOY_HOST} 'cd ~/highascg && sudo bash work/bootstrap-remote-after-sync.sh'"

if "$ATTACH"; then
	exec tmux attach -t "$SESSION"
fi
