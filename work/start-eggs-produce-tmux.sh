#!/usr/bin/env bash
# Wait for sudo credentials, then run eggs prepare + produce in tmux.
# NEVER deletes under /home/eggs/ — see work/EGGS_PRODUCE_SAFETY.md
#
# Usage:
#   bash work/start-eggs-produce-tmux.sh
#   sudo -v    # in any terminal (once)
#   tmux attach -t highascg-eggs-produce
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SESSION="${TMUX_SESSION:-highascg-eggs-produce}"
DRIVER="${HIGHASCG_NVIDIA_DRIVER:-595}"
LOG="${REPO}/work/eggs-build-$(date +%Y%m%d-%H%M%S).log"

command -v tmux >/dev/null || {
	echo "Install tmux: sudo apt-get install -y tmux" >&2
	exit 1
}

if tmux has-session -t "$SESSION" 2>/dev/null; then
	echo "Tmux session '$SESSION' already running."
	echo "  attach: tmux attach -t $SESSION"
	exit 0
fi

RUNNER="$(mktemp /tmp/hacg-eggs-produce.XXXXXX.sh)"
chmod +x "$RUNNER"
cat >"$RUNNER" <<EOF
#!/usr/bin/env bash
set -euo pipefail
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
export HIGHASCG_NVIDIA_DRIVER="${DRIVER}"
cd "${REPO}"

echo "==> Waiting for sudo (run: sudo -v)"
until sudo -n true 2>/dev/null; do
	sleep 5
done

echo "==> Sudo OK — starting prepare + produce at \$(date -Is)"
echo "==> Log: ${LOG}"
echo "==> NEVER rm /home/eggs — interrupt => reboot before retry"

sudo HIGHASCG_NVIDIA_DRIVER="${DRIVER}" bash work/run-eggs-prepare-safe.sh --produce 2>&1 | tee -a "${LOG}"

echo
echo "==> FINISHED \$(date -Is)"
echo "Press Enter to close this pane."
read -r
EOF

tmux new-session -d -s "$SESSION" "bash $RUNNER"
rm -f "$RUNNER"

echo "Started tmux session: $SESSION"
echo "  1) Run once:  sudo -v"
echo "  2) Watch:     tmux attach -t $SESSION"
echo "  3) Log file:  $LOG"
echo
echo "Existing ISOs under /home/eggs/ are kept — produce overwrites staging only."
