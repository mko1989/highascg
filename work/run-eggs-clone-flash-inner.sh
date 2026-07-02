#!/usr/bin/env bash
# Inner pipeline for run-eggs-clone-flash-tmux.sh (must run as root).
set -euo pipefail

export HIGHASCG_NVIDIA_DRIVER="${HIGHASCG_NVIDIA_DRIVER:?}"
export BASENAME="${BASENAME:?}"
export USB_DEVICE="${USB_DEVICE:?}"
export HIGHASCG_OVERNIGHT="${HIGHASCG_OVERNIGHT:-0}"
REPO="${REPO:?}"
LOG="${LOG:?}"
EXCLUDE_FILE="${EXCLUDE_FILE:-/etc/penguins-eggs.d/exclude.list}"

[[ "$(id -u)" -eq 0 ]] || {
	echo "ERROR: run as root (launcher should sudo before tmux)" >&2
	exit 1
}

mkdir -p "$(dirname "$LOG")"
touch "$LOG"
exec > >(tee -a "$LOG") 2>&1

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "HighAsCG eggs clone + flash"
echo "  started:  $(date -Is)"
echo "  host:     $(hostname)"
echo "  driver:   ${HIGHASCG_NVIDIA_DRIVER}"
echo "  basename: ${BASENAME}"
echo "  usb:      ${USB_DEVICE}"
echo "  log:      ${LOG}"
echo "  excludes: ${EXCLUDE_FILE} (merged by prepare-eggs-clone-with-exfat.sh)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo

cd "$REPO"

echo "==> Running as root (uid=$(id -u)) at $(date -Is)"

echo "==> Prepare host for produce (swap off + umount exFAT/bridge)"
bash "$REPO/tools/eggs/live-usb/stop-and-unmount-wo47-for-eggs-produce.sh"
bash "$REPO/tools/eggs/live-usb/strip-host-swap-for-live-iso.sh" prepare

echo "==> Preflight: eggs exclude.list + liveroot safety"
HIGHASCG_EGGS_EXCLUDE_FRAGMENT="$REPO/tools/eggs/live-usb/penguins-eggs-exclude-highascg-embed-server.list" \
	bash "$REPO/tools/eggs/live-usb/merge-penguins-eggs-exclude-highascg.sh" --replace
HIGHASCG_EGGS_EXCLUDE_FRAGMENT="$REPO/tools/eggs/live-usb/penguins-eggs-exclude-decklink.list" \
	bash "$REPO/tools/eggs/live-usb/merge-penguins-eggs-exclude-highascg.sh"
bash "$REPO/tools/eggs/live-usb/audit-eggs-clone-host.sh"

systemctl stop highascg.service 2>/dev/null || true
pkill -u casparcg -f '/home/casparcg/highascg/bin/casparcg' 2>/dev/null || true
sleep 1

echo "==> Phase 1+2: eggs produce --clone + dd + exFAT partition 3 (HIGHASCGEXF)"
set +e
HIGHASCG_NVIDIA_DRIVER="$HIGHASCG_NVIDIA_DRIVER" BASENAME="$BASENAME" \
	bash "$REPO/tools/eggs/live-usb/build-produce-flash-stick.sh" -y --usb "$USB_DEVICE"
build_rc=$?
set -e

echo
if [[ "$build_rc" -ne 0 ]]; then
	echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
	echo "BUILD FAILED (exit $build_rc) at $(date -Is)"
	echo "  log: ${LOG}"
	echo "  fix issues above, then rerun: bash $REPO/work/run-eggs-clone-flash-tmux.sh"
	echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
	if [[ "${HIGHASCG_OVERNIGHT:-0}" != "1" ]]; then
		read -r -p "Press Enter to close this tmux window… "
	fi
	exit "$build_rc"
fi

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Done: $(date -Is)"
echo "Stick layout on ${USB_DEVICE}:"
lsblk -f "$USB_DEVICE" || true
echo "Verify: bash $REPO/tools/eggs/live-usb/verify-config-persistence.sh"
echo "Log: ${LOG}"
if [[ "${HIGHASCG_OVERNIGHT:-0}" != "1" ]]; then
	read -r -p "Press Enter to close this tmux window… "
fi
