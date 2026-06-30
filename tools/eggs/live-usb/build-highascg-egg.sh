#!/usr/bin/env bash
# Build a HighAsCG live ISO with ONE baked NVIDIA driver (535, 580, or 595).
#
#   sudo HIGHASCG_NVIDIA_DRIVER=595 bash tools/eggs/live-usb/build-highascg-egg.sh
#
# Does NOT download multi-branch /opt/nvidia-pool debs.
set -euo pipefail

[[ "$(id -u)" -eq 0 ]] || {
	echo "Run as root: sudo HIGHASCG_NVIDIA_DRIVER=595 $0" >&2
	exit 1
}

BR="${HIGHASCG_NVIDIA_DRIVER:-}"
export HIGHASCG_ISO_FORBID_DECKLINK="${HIGHASCG_ISO_FORBID_DECKLINK:-1}"
case "$BR" in
535 | 580 | 595) ;;
*)
	echo "Set HIGHASCG_NVIDIA_DRIVER to 535, 580, or 595 (one driver per ISO)." >&2
	exit 1
	;;
esac

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "${HERE}/../../.." && pwd)"
export HIGHASCG_NVIDIA_DRIVER="$BR"
BASENAME="${BASENAME:-highascg-nvidia-${BR}}"

mkdir -p /etc/highascg
echo "$BR" > /etc/highascg/nvidia-iso-driver
chmod 0644 /etc/highascg/nvidia-iso-driver
echo "[build-highascg-egg] stamped /etc/highascg/nvidia-iso-driver = $BR"

export HIGHASCG_PURGE_NVIDIA_POOL=1
DISABLE="$REPO_ROOT/scripts/disable-nvidia-multi-driver-boot.sh"
if [[ -f "$DISABLE" ]]; then
	bash "$DISABLE"
fi

echo "==> WO-47 exFAT + empty mount stubs + eggs exclude merge (operator-stick truth baked into clone snapshot)"
HIGHASCG_SKIP_BOOT_BRANDING_IN_PREPARE=1 SKIP_HIGHASCG_SYSTEMD_RESTART=1 bash "${HERE}/prepare-eggs-clone-with-exfat.sh"

if [[ -f /etc/highascg/pinned-kernel ]]; then
	echo "==> Pinned kernel $(cat /etc/highascg/pinned-kernel) — eggs.yaml + purge non-pinned images (no linux-image-generic)"
	HIGHASCG_SKIP_HOST_INITRAMFS=1 bash "${HERE}/sync-eggs-kernel-and-purge-stale.sh"
else
	echo "==> Latest single kernel (apt generic + eggs.yaml + purge older images)"
	echo "WARN: no /etc/highascg/pinned-kernel — this may install a newer HWE kernel" >&2
	HIGHASCG_ENSURE_LATEST_KERNEL=1 HIGHASCG_SKIP_HOST_INITRAMFS=1 bash "${HERE}/sync-eggs-kernel-and-purge-stale.sh"
fi

echo "==> Install network + firmware essentials for live image"
apt-get update
apt-get install -y --no-install-recommends \
	network-manager wpasupplicant isc-dhcp-client \
	iproute2 ethtool pciutils usbutils rfkill wireless-regdb \
	linux-firmware netplan.io

echo "==> Live auto-network without NM (systemd-networkd + netplan)"
mkdir -p /etc/systemd/network /etc/netplan

tee /etc/systemd/network/10-live-wired.network >/dev/null <<'NETEOF'
[Match]
Name=en* eth*

[Network]
DHCP=yes
LinkLocalAddressing=ipv4
MulticastDNS=yes
IPv6AcceptRA=yes
NETEOF

tee /etc/netplan/01-live-networkd.yaml >/dev/null <<'PLANEOF'
network:
  version: 2
  renderer: networkd
PLANEOF

chmod 600 /etc/netplan/01-live-networkd.yaml
chown root:root /etc/netplan/01-live-networkd.yaml

systemctl enable systemd-networkd systemd-resolved || true
ln -sf /run/systemd/resolve/stub-resolv.conf /etc/resolv.conf 2>/dev/null || true

echo "==> Hostname for ISO naming (${BASENAME})"
hostnamectl set-hostname "${BASENAME}" 2>/dev/null || hostname "${BASENAME}"

echo "==> Factory operator config (not eggs build-host JSON / .env)"
bash "${HERE}/reset-iso-operator-config.sh"

echo "==> Clone host audit (swap, nvidia-pool, excludes, branding)"
bash "${HERE}/audit-eggs-clone-host.sh"

echo "==> Third-party license bundle (NVIDIA / NDI / DeckLink notices)"
bash "${REPO_ROOT}/tools/release/collect-third-party-licenses.sh"
if [[ -f "${REPO_ROOT}/licenses/manifest.json" ]]; then
	bash "${REPO_ROOT}/scripts/setup/15-licenses-install.sh"
else
	echo "WARN: licenses/manifest.json missing after collect" >&2
fi

bash "${HERE}/pre-produce-preflight.sh"

echo "==> Finalize GRUB splash + Plymouth initramfs (must run immediately before eggs produce)"
bash "${HERE}/install-storage-drivers-for-iso.sh"
bash "${HERE}/finalize-boot-branding-for-eggs-produce.sh"

sample="$(file -b /usr/share/plymouth/themes/highascg/throbber-0001.png 2>/dev/null || true)"
echo "==> Host Plymouth throbber sample before produce: ${sample:-missing}"
if echo "$sample" | grep -q RGBA; then
	echo "ERROR: host Plymouth frames still RGBA — prepare-branding-assets.sh did not run" >&2
	exit 1
fi

THEME_ABS="$(cd "${HERE}/highascg-eggs-theme" && pwd)"
[[ -f "${THEME_ABS}/theme/livecd/grub.main.cfg" ]] || {
	echo "Missing highascg-eggs-theme — run install-eggs-live-grub-theme.sh first." >&2
	exit 1
}

echo "==> Stop highascg + companion during squashfs (avoid state changing mid-pack; free RAM)"
systemctl stop highascg.service companion.service 2>/dev/null || true

echo "==> Build ISO basename=${BASENAME} theme=${THEME_ABS} (single NVIDIA driver ${BR})"
eggs produce --nointeractive --clone --max --excludes static --basename "${BASENAME}" --theme "${THEME_ABS}"

echo "==> Patch Calamares in squashfs (eggs produce regenerates /etc/calamares after preflight)"
bash "${HERE}/patch-iso-squashfs-calamares.sh"

echo "==> Inject GRUB splash + Plymouth initrd into ISO (eggs makeEfi ordering workaround)"
# Fresh produce already cloned host /usr into squashfs — skip 25 min squashfs rebuild.
HIGHASCG_SKIP_SQUASHFS_REFRESH=1 bash "${HERE}/inject-iso-boot-branding.sh"

echo "==> Verify squashfs excludes (no swap file, nvidia-pool, dev trees)"
bash "${HERE}/verify-iso-squashfs-excludes.sh"

if [[ "${HIGHASCG_SKIP_ISO_BOOT_BRANDING_VERIFY:-0}" == "1" ]]; then
	echo "==> Skip ISO boot branding verify (HIGHASCG_SKIP_ISO_BOOT_BRANDING_VERIFY=1)"
else
	echo "==> Verify ISO boot branding (set HIGHASCG_SKIP_ISO_BOOT_BRANDING_VERIFY=1 or FAST=1 to shorten)"
	HIGHASCG_ISO_BOOT_BRANDING_VERIFY_FAST="${HIGHASCG_ISO_BOOT_BRANDING_VERIFY_FAST:-0}" \
		bash "${HERE}/verify-iso-boot-branding.sh" || {
		echo "ERROR: ISO boot branding check failed — do not flash this ISO." >&2
		exit 1
	}
fi

if [[ "${SKIP_STRIP_HOST_SWAP:-0}" != "1" ]]; then
	bash "${HERE}/strip-host-swap-for-live-iso.sh" restore
fi

echo "==> Remount bridge/USB + config sync (eggs produce umounts volumes for squashfs)"
bash "${HERE}/unmask-exfat-systemd.sh"
systemctl reset-failed highascg-exfat-boot.service 2>/dev/null || true
bash "${REPO_ROOT}/scripts/highascg-exfat-remount-sync.sh" casparcg 2>/dev/null || {
	echo "WARN: remount/sync skipped — run: sudo bash ${REPO_ROOT}/scripts/highascg-exfat-remount-sync.sh" >&2
}

# shellcheck source=flash-stick-common.sh
source "${HERE}/flash-stick-common.sh" 2>/dev/null || true
BUILT_ISO=""
if declare -F find_latest_iso >/dev/null 2>&1; then
	BUILT_ISO="$(find_latest_iso 2>/dev/null || true)"
fi

echo
if [[ -n "$BUILT_ISO" ]]; then
	echo "Done. ISO: ${BUILT_ISO} (nvidia-${BR}, no nvidia-pool)"
else
	echo "Done. ISO is under /home/eggs/ (name starts with ${BASENAME}_, nvidia-${BR})"
fi
echo
echo "Full build + flash /dev/sda:"
echo "  sudo HIGHASCG_NVIDIA_DRIVER=${BR} bash ${HERE}/build-produce-flash-stick.sh -y"
echo
echo "Flash only (this ISO):"
echo "  sudo bash ${HERE}/create-operator-stick-from-dd.sh /dev/sda --iso ${BUILT_ISO:-/home/eggs/${BASENAME}_*.iso}"
echo "  (see tools/eggs/live-usb/FLASH_AND_PERSIST.md)"
