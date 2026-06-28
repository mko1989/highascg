#!/usr/bin/env bash
# Clone this running host with penguins-eggs (--clone, HighAsCG exclude.list), then
# dd the ISO to /dev/sda and create exFAT operator data on partition 3 (HIGHASCGEXF).
#
# Runs inside a detached tmux session so you can attach/detach during the long build.
#
# Usage:
#   bash work/run-eggs-clone-flash-tmux.sh              # start detached session
#   bash work/run-eggs-clone-flash-tmux.sh --attach     # start and attach
#   bash work/run-eggs-clone-flash-tmux.sh --attach-only # attach existing session
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
LIVE_USB="${REPO}/tools/eggs/live-usb"
SESSION="${TMUX_SESSION:-highascg-eggs}"
USB="${USB_DEVICE:-/dev/sda}"
ATTACH=false
ATTACH_ONLY=false
LOG=""

usage() {
	sed -n '2,18p' "$0" | tail -n +2
	exit "${1:-0}"
}

while [[ $# -gt 0 ]]; do
	case "$1" in
		-h | --help) usage 0 ;;
		--attach) ATTACH=true ;;
		--attach-only) ATTACH_ONLY=true ;;
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
	exec tmux attach -t "$SESSION"
fi

if tmux has-session -t "$SESSION" 2>/dev/null; then
	echo "tmux session already running: $SESSION" >&2
	echo "  tmux attach -t $SESSION" >&2
	echo "  tmux kill-session -t $SESSION   # to restart" >&2
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
LOG="${REPO}/work/eggs-clone-flash-$(date +%Y%m%d-%H%M%S).log"

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

# Build script runs prepare-eggs-clone-with-exfat.sh (merge exclude.list + WO-47 stubs).
EXCLUDE_FILE="${EGGS_EXCLUDE_LIST:-/etc/penguins-eggs.d/exclude.list}"
if [[ ! -f "$EXCLUDE_FILE" ]]; then
	echo "Note: ${EXCLUDE_FILE} missing — prepare step will install from tools/eggs/live-usb/exclude.list" >&2
fi

RUNNER="$(mktemp)"
trap 'rm -f "$RUNNER"' EXIT
cat >"$RUNNER" <<RUNEOF
#!/usr/bin/env bash
set -euo pipefail
export HIGHASCG_NVIDIA_DRIVER=${DRV}
export BASENAME=${BASENAME}
export USB_DEVICE=${USB}
export HIGHASCG_OVERNIGHT=${HIGHASCG_OVERNIGHT:-0}
REPO=${REPO}
LOG=${LOG}
exec > >(tee -a "\$LOG") 2>&1

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "HighAsCG eggs clone + flash"
echo "  started:  \$(date -Is)"
echo "  host:     \$(hostname)"
echo "  driver:   \${HIGHASCG_NVIDIA_DRIVER}"
echo "  basename: \${BASENAME}"
echo "  usb:      \${USB_DEVICE}"
echo "  log:      \${LOG}"
echo "  excludes: ${EXCLUDE_FILE} (merged by prepare-eggs-clone-with-exfat.sh)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo

cd "\$REPO"

echo "==> Waiting for sudo (run once in any terminal: sudo -v)"
until sudo -n true 2>/dev/null; do
	sleep 10
done
echo "==> sudo credentials cached at \$(date -Is)"

echo "==> Preflight: eggs exclude.list + liveroot safety"
sudo HIGHASCG_EGGS_EXCLUDE_FRAGMENT="\$REPO/tools/eggs/live-usb/penguins-eggs-exclude-highascg-embed-server.list" \
	bash "\$REPO/tools/eggs/live-usb/merge-penguins-eggs-exclude-highascg.sh" --replace
# Refuse if a prior interrupted eggs produce left live /usr bind-mounted under liveroot.
sudo bash "\$REPO/tools/eggs/live-usb/audit-eggs-clone-host.sh"

# Stop stack before umount/clone (build script also stops highascg during squashfs pack).
systemctl stop highascg.service 2>/dev/null || true
pkill -u casparcg -f '/home/casparcg/highascg/bin/casparcg' 2>/dev/null || true
sleep 1

echo "==> Phase 1+2: eggs produce --clone + dd + exFAT partition 3 (HIGHASCGEXF)"
set +e
sudo -E HIGHASCG_NVIDIA_DRIVER="\$HIGHASCG_NVIDIA_DRIVER" BASENAME="\$BASENAME" \
	bash "\$REPO/tools/eggs/live-usb/build-produce-flash-stick.sh" -y --usb "\$USB_DEVICE"
build_rc=\$?
set -e

echo
if [[ "\$build_rc" -ne 0 ]]; then
	echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
	echo "BUILD FAILED (exit \$build_rc) at \$(date -Is)"
	echo "  log: \${LOG}"
	echo "  fix issues above, then rerun: bash \$REPO/work/run-eggs-clone-flash-tmux.sh"
	echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
	if [[ "\${HIGHASCG_OVERNIGHT:-0}" != "1" ]]; then
		read -r -p "Press Enter to close this tmux window… "
	fi
	exit "\$build_rc"
fi

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Done: \$(date -Is)"
echo "Stick layout on \${USB_DEVICE}:"
lsblk -f "\$USB_DEVICE" || true
echo "Verify: bash \$REPO/tools/eggs/live-usb/verify-config-persistence.sh"
echo "Log: \${LOG}"
if [[ "\${HIGHASCG_OVERNIGHT:-0}" != "1" ]]; then
	read -r -p "Press Enter to close this tmux window… "
fi
RUNEOF
chmod 0755 "$RUNNER"

tmux new-session -d -s "$SESSION" -n build "bash '$RUNNER'"

echo "Started tmux session: $SESSION"
echo "  log: $LOG"
echo "  attach:  tmux attach -t $SESSION"
echo "  detach:  Ctrl-b d"
echo "  kill:    tmux kill-session -t $SESSION"
echo
echo "Pipeline:"
echo "  1. prepare-eggs-clone-with-exfat.sh (WO-47 + merge eggs exclude.list)"
echo "  2. eggs produce --nointeractive --clone --max --excludes static"
echo "  3. inject-iso-boot-branding.sh"
echo "  4. dd ISO → ${USB}"
echo "  5. exFAT HIGHASCGEXF on ${USB}3 (finish-operator-stick.sh)"
echo

if "$ATTACH"; then
	exec tmux attach -t "$SESSION"
fi
