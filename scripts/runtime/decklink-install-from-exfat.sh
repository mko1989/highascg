#!/usr/bin/env bash
# Install Blackmagic Desktop Video from operator-supplied .deb files on exFAT/bridge.
#
# Search (first match wins by newest version):
#   /home/casparcg/exfat/decklink/desktopvideo_*_amd64.deb
#   /home/casparcg/exfat/decklink/desktopvideo-gui_*_amd64.deb
#   /home/casparcg/bridge/decklink/… (same layout)
#
# Skips dpkg when both packages are already installed at >= vendor version.
#
# Usage:
#   decklink-install-from-exfat.sh [--boot] [--dry-run] [--verbose]
set -euo pipefail

LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=decklink-install-lib.sh
if [[ -f "${LIB_DIR}/decklink-install-lib.sh" ]]; then
	source "${LIB_DIR}/decklink-install-lib.sh"
else
	# shellcheck source=../lib/decklink-install-lib.sh
	source "${LIB_DIR}/../lib/decklink-install-lib.sh"
fi

LOG=/var/log/highascg/decklink-install.log
BOOT=0
DRY_RUN=0
VERBOSE=0

log() {
	local line="[$(date -Iseconds)] $*"
	echo "$line" | tee -a "$LOG" >&2
	logger -t highascg-decklink-install -- "$*" 2>/dev/null || true
}

usage() {
	echo "Usage: $0 [--boot] [--dry-run] [--verbose]" >&2
	exit 2
}

while [[ $# -gt 0 ]]; do
	case "$1" in
		--boot) BOOT=1 ;;
		--dry-run) DRY_RUN=1 ;;
		--verbose) VERBOSE=1 ;;
		-h | --help) usage ;;
		*) echo "Unknown option: $1" >&2; usage ;;
	esac
	shift
done

[[ "$(id -u)" -eq 0 ]] || {
	echo "Run as root" >&2
	exit 1
}

mkdir -p "$(dirname "$LOG")"
touch "$LOG"

reason=""
if ! decklink_needs_install_from_vendor reason; then
	log "skip: ${reason}"
	exit 0
fi

if ! decklink_find_newest_vendor_pair; then
	log "skip: no vendor debs found"
	exit 0
fi

log "vendor: ${DECKLINK_VENDOR_DIR} version=${DECKLINK_VENDOR_VERSION}"
log "  main: $(basename "$DECKLINK_VENDOR_MAIN_DEB")"
if [[ -n "${DECKLINK_VENDOR_GUI_DEB:-}" ]]; then
	log "  gui:  $(basename "$DECKLINK_VENDOR_GUI_DEB")"
else
	log "  gui:  (none — desktopvideo-gui optional; Settings Setup button unavailable)"
fi
log "action: ${reason}"

if [[ "$DRY_RUN" -eq 1 ]]; then
	log "dry-run: would install ${DECKLINK_VENDOR_VERSION}"
	exit 0
fi

if decklink_install_vendor_pair "$DECKLINK_VENDOR_MAIN_DEB" "$DECKLINK_VENDOR_GUI_DEB" "${DECKLINK_EXTRACT_TMPDIR:-}"; then
	log "ok: installed Desktop Video ${DECKLINK_VENDOR_VERSION}"
	exit 0
fi

log "ERROR: dpkg install failed for ${DECKLINK_VENDOR_VERSION}"
exit 1
