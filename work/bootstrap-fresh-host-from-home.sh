#!/usr/bin/env bash
# Fresh Ubuntu + restored ~/highascg home only — bring playout host online.
#
#   cd ~/highascg
#   sudo bash work/bootstrap-fresh-host-from-home.sh
#
# Full step list: scripts/setup/README.md
set -euo pipefail

export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

[[ "$(id -u)" -eq 0 ]] || {
	echo "Run as root: sudo bash $0" >&2
	exit 1
}

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SETUP="${REPO}/scripts/setup"

log() { echo "==> $*"; }

log "Fresh host bootstrap — repo ${REPO}"
log "Kernel now: $(uname -r)"

for need in apt-get systemctl; do
	command -v "$need" >/dev/null || {
		echo "ERROR: missing ${need} — system /usr may be broken; see tools/eggs/live-usb/RECOVER_DESTROYED_USR.md" >&2
		exit 1
	}
done

[[ -f "${REPO}/package.json" ]] || {
	echo "ERROR: ${REPO}/package.json missing — copy home/casparcg from backup first." >&2
	exit 1
}

if [[ "$(uname -r)" != *-117-* ]]; then
	log "Step 1/9: kernel pin 6.8.0-117 (reboot required after)"
	bash "${SETUP}/01-kernel-117.sh"
	echo
	echo "REBOOT NOW: sudo reboot"
	echo "Then: cd ~/highascg && sudo bash work/bootstrap-fresh-host-from-home.sh --after-kernel-reboot"
	exit 0
fi

if [[ "${1:-}" != "--after-kernel-reboot" && "${1:-}" != "--continue" ]]; then
	log "On kernel 117 — run verify then continue"
	bash "${SETUP}/02-verify-kernel-117.sh"
fi

if ! command -v nvidia-smi >/dev/null 2>&1; then
	log "Step 3: NVIDIA open 595 (reboot required after)"
	bash "${SETUP}/03-nvidia-open-595.sh"
	echo
	echo "REBOOT NOW: sudo reboot"
	echo "Then: cd ~/highascg && sudo bash work/bootstrap-fresh-host-from-home.sh --continue"
	exit 0
fi

log "Step 4: NDI"
bash "${SETUP}/04-ndi.sh"

log "Step 5: Caspar deps"
bash "${SETUP}/05-caspar-deps.sh"

if [[ ! -x /usr/bin/DesktopVideoSetup ]]; then
	echo
	echo "MANUAL: DeckLink — see ${SETUP}/06-decklink-manual.md"
	if [[ -d /mnt/fat/Blackmagic_Desktop_Video_Linux_16.0.1 ]]; then
		echo "  Installer found on /mnt/fat — mount backup partition if needed:"
		echo "  sudo mount /dev/nvme0n1p3 /mnt/fat"
	fi
fi

log "Step 7: Node + highascg npm"
bash "${SETUP}/07-node-highascg.sh"

log "Step 8: Caspar CEF scanner"
bash "${SETUP}/08-caspar-cef-scanner.sh"

log "Step 9: Openbox autostart + highascg.service"
bash "${SETUP}/09-openbox-autostart.sh"

log "Optional: boot branding (GRUB + Plymouth)"
echo "  sudo bash ${SETUP}/11-boot-branding.sh && sudo reboot"

log "Start HighAsCG"
systemctl enable --now highascg.service 2>/dev/null || true
systemctl restart highascg.service 2>/dev/null || true

echo
echo "OK: bootstrap complete."
echo "  nvidia-smi"
echo "  systemctl status highascg"
echo "  ss -tln | grep 5250"
echo "Eggs ISO (later): sudo bash work/run-eggs-prepare-safe.sh"
