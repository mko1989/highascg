#!/usr/bin/env bash
# Clone this running host with penguins-eggs (--clone, HighAsCG exclude.list), then
# dd the ISO to /dev/sda and create exFAT operator data on partition 3 (HIGHASCGEXF).
#
# Runs inside a detached tmux session so you can attach/detach during the long build.
#
# Usage:
#   bash work/run-eggs-clone-flash-tmux.sh              # sudo once here, then detached tmux
#   bash work/run-eggs-clone-flash-tmux.sh --attach     # start and attach (sudo tmux attach)
#   bash work/run-eggs-clone-flash-tmux.sh --attach-only
#
# Env:
#   HIGHASCG_NVIDIA_DRIVER=595   override (default: /etc/highascg/nvidia-iso-driver or 595)
#   USB_DEVICE=/dev/sda          whole disk to flash (default /dev/sda)
#   HIGHASCG_OVERNIGHT=1         skip "Press Enter" prompts at end (unattended)
#   BASENAME=highascg-nvidia-595 ISO basename prefix (default from driver)
#   TMUX_SESSION=highascg-eggs   tmux session name
#
# Requires: sudo, tmux, eggs, enough free space under /home/eggs/
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INNER="${REPO}/work/run-eggs-clone-flash-inner.sh"
SESSION="${TMUX_SESSION:-highascg-eggs}"
USB="${USB_DEVICE:-/dev/sda}"
ATTACH=false
ATTACH_ONLY=false
LOG=""

tmux_has_session() {
	local s="$1"
	tmux has-session -t "$s" 2>/dev/null && return 0
	sudo tmux has-session -t "$s" 2>/dev/null
}

tmux_attach_session() {
	local s="$1"
	if tmux has-session -t "$s" 2>/dev/null; then
		exec tmux attach -t "$s"
	fi
	if sudo tmux has-session -t "$s" 2>/dev/null; then
		exec sudo tmux attach -t "$s"
	fi
	echo "No tmux session: $s" >&2
	exit 1
}

usage() {
	sed -n '2,18p' "$0" | tail -n +2
	exit "${1:-0}"
}

while [[ $# -gt 0 ]]; do
	case "$1" in
		-h | --help) usage 0 ;;
		--attach) ATTACH=true ;;
		--attach-only) ATTACH_ONLY=true ;;
		--as-root) ;; # internal: after sudo re-exec
		--usb)
			USB="${2:?}"
			shift
			;;
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
	tmux_attach_session "$SESSION"
fi

if tmux_has_session "$SESSION"; then
	echo "tmux session already running: $SESSION" >&2
	echo "  tmux attach -t $SESSION   # or: sudo tmux attach -t $SESSION" >&2
	echo "  tmux kill-session -t $SESSION   # or: sudo tmux kill-session -t $SESSION" >&2
	exit 1
fi

DRV="${HIGHASCG_NVIDIA_DRIVER:-}"
if [[ -z "$DRV" && -f /etc/highascg/nvidia-iso-driver ]]; then
	DRV="$(tr -d '[:space:]' </etc/highascg/nvidia-iso-driver)"
fi
DRV="${DRV:-595}"
case "$DRV" in
535 | 580 | 595) ;;
*)
	echo "HIGHASCG_NVIDIA_DRIVER must be 535, 580, or 595 (got: $DRV)" >&2
	exit 1
	;;
esac

BASENAME="${BASENAME:-highascg-nvidia-${DRV}}"
mkdir -p "${REPO}/work"
LOG="${LOG:-${REPO}/work/eggs-clone-flash-$(date +%Y%m%d-%H%M%S).log}"
touch "$LOG"

ROOT_DEV="$(findmnt -n -o SOURCE / 2>/dev/null || true)"
if [[ -n "$ROOT_DEV" ]] && lsblk -no PKNAME "$ROOT_DEV" 2>/dev/null | grep -qxF "${USB#/dev/}"; then
	echo "Refusing ${USB}: it contains the running root filesystem (${ROOT_DEV})." >&2
	exit 1
fi
[[ -b "$USB" ]] || {
	echo "Not a block device: $USB" >&2
	exit 1
}
typ="$(lsblk -ndo TYPE "$USB" 2>/dev/null || true)"
[[ "$typ" == disk ]] || {
	echo "Refusing ${USB} — expected whole disk (TYPE=disk), got TYPE=${typ:-?}" >&2
	exit 1
}

if ! command -v eggs >/dev/null; then
	echo "penguins-eggs not installed. Run: sudo bash work/setup-boot-branding-phase1.sh" >&2
	exit 1
fi

EXCLUDE_FILE="${EGGS_EXCLUDE_LIST:-/etc/penguins-eggs.d/exclude.list}"
if [[ ! -f "$EXCLUDE_FILE" ]]; then
	echo "Note: ${EXCLUDE_FILE} missing — prepare step will install from tools/eggs/live-usb/exclude.list" >&2
fi

[[ -x "$INNER" ]] || chmod 0755 "$INNER"

# Sudo once in THIS terminal — tmux runs as root (no password prompt inside detached pane).
if [[ "$(id -u)" -ne 0 ]]; then
	echo "==> Need root for eggs produce — enter sudo password now (not inside tmux)"
	exec sudo -E env \
		HIGHASCG_NVIDIA_DRIVER="$DRV" \
		BASENAME="$BASENAME" \
		USB_DEVICE="$USB" \
		HIGHASCG_OVERNIGHT="${HIGHASCG_OVERNIGHT:-0}" \
		REPO="$REPO" \
		LOG="$LOG" \
		EXCLUDE_FILE="$EXCLUDE_FILE" \
		TMUX_SESSION="$SESSION" \
		HIGHASCG_ATTACH="${ATTACH}" \
		bash "$0" --as-root "$@"
fi

ATTACH="${HIGHASCG_ATTACH:-$ATTACH}"

tmux new-session -d -s "$SESSION" -n build \
	"env HIGHASCG_NVIDIA_DRIVER='$DRV' BASENAME='$BASENAME' USB_DEVICE='$USB' HIGHASCG_OVERNIGHT='${HIGHASCG_OVERNIGHT:-0}' REPO='$REPO' LOG='$LOG' EXCLUDE_FILE='$EXCLUDE_FILE' bash '$INNER'; rc=\$?; echo; echo 'Runner exited '\$rc' at '\$(date -Is); echo 'Log: $LOG'; if [[ '${HIGHASCG_OVERNIGHT:-0}' != '1' ]]; then read -r -p 'Press Enter… '; fi; exit \$rc"
tmux set-option -t "$SESSION" remain-on-exit on 2>/dev/null || true

echo "Started tmux session: $SESSION (root tmux server)"
echo "  log: $LOG"
echo "  attach:  sudo tmux attach -t $SESSION"
echo "  detach:  Ctrl-b d"
echo "  kill:    sudo tmux kill-session -t $SESSION"
echo "  tail:    tail -f $LOG"
echo
echo "Pipeline:"
echo "  1. prepare-eggs-clone-with-exfat.sh (WO-47 + merge eggs exclude.list)"
echo "  2. eggs produce --nointeractive --clone --max --excludes static"
echo "  3. inject-iso-boot-branding.sh"
echo "  4. dd ISO → ${USB}"
echo "  5. exFAT HIGHASCGEXF on ${USB}3 (finish-operator-stick.sh)"
echo

if "$ATTACH"; then
	exec sudo tmux attach -t "$SESSION"
fi
