#!/usr/bin/env bash
# Eggs clone + flash stick — plain terminal (no tmux). Safe for build hosts.
#
# Must run from the FULL git clone (tools/eggs/live-usb present). NOT ~/highascg alone.
#
# Usage:
#   cd ~/bridge/casparcg/highascg
#   export USB_DEVICE=/dev/sdc
#   sudo -E bash work/run-eggs-clone-flash.sh
#   sudo -E bash work/run-eggs-clone-flash.sh --flash-only   # ISO already built
#
# Env:
#   HIGHASCG_NVIDIA_DRIVER=595   (default: /etc/highascg/nvidia-iso-driver or 595)
#   USB_DEVICE=/dev/sda
#   BASENAME=highascg-nvidia-595
#
set -euo pipefail

find_build_repo() {
	local here="$1"
	if [[ -x "${here}/tools/eggs/live-usb/build-produce-flash-stick.sh" ]]; then
		echo "$here"
		return 0
	fi
	local alt
	for alt in \
		"/home/casparcg/bridge/casparcg/highascg" \
		"/home/casparcg/highascg"; do
		if [[ -x "${alt}/tools/eggs/live-usb/build-produce-flash-stick.sh" ]]; then
			echo "$alt"
			return 0
		fi
	done
	return 1
}

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if ! REPO="$(find_build_repo "$REPO")"; then
	echo "ERROR: no full HighAsCG clone with tools/eggs/live-usb found." >&2
	echo "  Use: cd ~/bridge/casparcg/highascg && sudo bash work/run-eggs-clone-flash.sh" >&2
	echo "  ~/highascg alone is the playout runtime tree (no eggs build tools)." >&2
	exit 1
fi

LIVE_USB="${REPO}/tools/eggs/live-usb"
USB="${USB_DEVICE:-/dev/sda}"
FLASH_ONLY=false
ASSUME_YES=false
LOG=""

usage() {
	sed -n '2,18p' "$0" | tail -n +2
	exit "${1:-0}"
}

while [[ $# -gt 0 ]]; do
	case "$1" in
		-h | --help) usage 0 ;;
		--flash-only) FLASH_ONLY=true ;;
		-y | --yes) ASSUME_YES=true ;;
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

[[ "$(id -u)" -eq 0 ]] || {
	echo "Run as root: sudo -E bash $0" >&2
	exit 1
}

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

command -v eggs >/dev/null || {
	echo "penguins-eggs not installed." >&2
	exit 1
}

exec > >(tee -a "$LOG") 2>&1

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "HighAsCG eggs clone + flash (no tmux)"
echo "  repo:     ${REPO}"
echo "  driver:   ${DRV}"
echo "  usb:      ${USB}"
echo "  log:      ${LOG}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

DISABLE_UPDATE=/etc/highascg/disable-exfat-server-update
RESTORE_UPDATE=0
if [[ ! -f "$DISABLE_UPDATE" ]]; then
	touch "$DISABLE_UPDATE"
	RESTORE_UPDATE=1
	echo "==> Pausing exFAT drop-update during build (${DISABLE_UPDATE})"
fi
cleanup() {
	if [[ "$RESTORE_UPDATE" -eq 1 ]]; then
		rm -f "$DISABLE_UPDATE"
		echo "==> Re-enabled exFAT drop-update (removed ${DISABLE_UPDATE})"
	fi
}
trap cleanup EXIT

if ! "$FLASH_ONLY"; then
	echo "==> Preflight: merge eggs excludes + audit"
	HIGHASCG_EGGS_EXCLUDE_FRAGMENT="${LIVE_USB}/penguins-eggs-exclude-highascg-embed-server.list" \
		bash "${LIVE_USB}/merge-penguins-eggs-exclude-highascg.sh" --replace
	bash "${LIVE_USB}/audit-eggs-clone-host.sh"

	systemctl stop highascg.service 2>/dev/null || true
	pkill -u casparcg -f '/home/casparcg/highascg/bin/casparcg' 2>/dev/null || true
	sleep 1
fi

BUILD_ARGS=()
"$FLASH_ONLY" && BUILD_ARGS+=(--flash-only)
"$ASSUME_YES" && BUILD_ARGS+=(-y)
BUILD_ARGS+=(--usb "$USB")

echo "==> build-produce-flash-stick.sh ${BUILD_ARGS[*]}"
set +e
HIGHASCG_NVIDIA_DRIVER="$DRV" BASENAME="$BASENAME" \
	bash "${LIVE_USB}/build-produce-flash-stick.sh" "${BUILD_ARGS[@]}"
rc=$?
set -e

echo
if [[ "$rc" -ne 0 ]]; then
	echo "BUILD FAILED (exit $rc) — log: ${LOG}"
	exit "$rc"
fi

echo "Done: $(date -Is)"
lsblk -f "$USB" || true
echo "Verify: bash ${LIVE_USB}/verify-config-persistence.sh"
